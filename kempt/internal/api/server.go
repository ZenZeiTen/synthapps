package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/ZenZeiTen/synthapps/kempt/internal/apps"
	"github.com/ZenZeiTen/synthapps/kempt/internal/autostart"
	"github.com/ZenZeiTen/synthapps/kempt/internal/clean"
	"github.com/ZenZeiTen/synthapps/kempt/internal/files"
	"github.com/ZenZeiTen/synthapps/kempt/internal/fsx"
	"github.com/ZenZeiTen/synthapps/kempt/internal/health"
	"github.com/ZenZeiTen/synthapps/kempt/internal/i18n"
	"github.com/ZenZeiTen/synthapps/kempt/internal/jobs"
	"github.com/ZenZeiTen/synthapps/kempt/internal/journal"
	"github.com/ZenZeiTen/synthapps/kempt/internal/privacy"
	"github.com/ZenZeiTen/synthapps/kempt/internal/schedule"
	"github.com/ZenZeiTen/synthapps/kempt/internal/startup"
)

// Config wires the desktop server to the rest of Kempt. Functions that touch
// the system are fields so tests can replace them.
type Config struct {
	DataDir  string
	Token    string   // per-launch secret, required on every /api/local call
	Hosts    []string // accepted Host headers, e.g. 127.0.0.1:47831
	Static   http.Handler
	Elevated bool
	Exe      string // Kempt's own program, for automatic care

	Engine  *clean.Engine
	Startup startup.Manager
	Journal *journal.Journal
	Jobs    *jobs.Manager
	// Autostart makes Kempt start when you sign in; nil where unsupported.
	Autostart autostart.Manager
	// CanMinimize: the window can be opened minimized on this system.
	CanMinimize bool

	Activity func()                    // called on every authenticated request
	Quit     func()                    // the window asked Kempt to close
	Elevate  func() error              // start Kempt again as administrator
	Open     func(target string) error // open a settings page or program (see actions)
	Reveal   func(path string) error   // show a file in its folder
	Recycle  func(path string) error
	Health   func(ctx context.Context, lang string) health.Report
}

type server struct {
	Config
	mu    sync.Mutex
	found map[string]bool // files a search showed: the only ones that may be recycled
}

// NewDesktop returns the handler for the desktop window.
func NewDesktop(c Config) http.Handler {
	if c.Recycle == nil {
		c.Recycle = fsx.Recycle
	}
	if c.Health == nil {
		c.Health = health.Check
	}
	s := &server{Config: c, found: map[string]bool{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/mode", s.mode)
	mux.HandleFunc("GET /api/i18n/{lang}", func(w http.ResponseWriter, r *http.Request) {
		b, ok := i18n.Catalog(r.PathValue("lang"))
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Write(b)
	})
	a := s.auth
	mux.HandleFunc("POST /api/local/heartbeat", a(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
	}))
	mux.HandleFunc("POST /api/local/quit", a(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
		if s.Quit != nil {
			go s.Quit()
		}
	}))
	mux.HandleFunc("POST /api/local/elevate", a(s.elevate))
	mux.HandleFunc("GET /api/local/categories", a(s.categories))
	mux.HandleFunc("GET /api/local/settings", a(s.getSettings))
	mux.HandleFunc("PUT /api/local/settings", a(s.putSettings))
	mux.HandleFunc("GET /api/local/app", a(s.getApp))
	mux.HandleFunc("PUT /api/local/app", a(s.putApp))
	mux.HandleFunc("POST /api/local/jobs/{kind}", a(s.startJob))
	mux.HandleFunc("GET /api/local/jobs/{id}", a(s.getJob))
	mux.HandleFunc("DELETE /api/local/jobs/{id}", a(s.cancelJob))
	mux.HandleFunc("GET /api/local/startup", a(s.listStartup))
	mux.HandleFunc("POST /api/local/startup", a(s.setStartup))
	mux.HandleFunc("GET /api/local/privacy", a(s.listPrivacy))
	mux.HandleFunc("POST /api/local/privacy", a(s.setPrivacy))
	mux.HandleFunc("GET /api/local/schedule", a(s.getSchedule))
	mux.HandleFunc("PUT /api/local/schedule", a(s.putSchedule))
	mux.HandleFunc("GET /api/local/journal", a(s.listJournal))
	mux.HandleFunc("POST /api/local/undo", a(s.undo))
	mux.HandleFunc("POST /api/local/action", a(s.action))
	mux.HandleFunc("GET /api/local/folders", a(s.folders))
	mux.Handle("/", c.Static)

	hosts := map[string]bool{}
	for _, h := range c.Hosts {
		hosts[strings.ToLower(h)] = true
	}
	guarded := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Refuse other host names: blocks DNS-rebinding pages from reaching the API.
		if !hosts[strings.ToLower(r.Host)] {
			http.Error(w, "unknown host", http.StatusMisdirectedRequest)
			return
		}
		// Refuse cross-site requests to the API outright.
		if strings.HasPrefix(r.URL.Path, "/api/") {
			if o := r.Header.Get("Origin"); o != "" && !hosts[strings.ToLower(strings.TrimPrefix(o, "http://"))] {
				http.Error(w, "cross-origin request refused", http.StatusForbidden)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
	return securityHeaders(guarded)
}

// ErrDeclined: the person said no to the administrator prompt.
var ErrDeclined = errors.New("the administrator prompt was declined")

// ErrNoElevation: this system cannot restart Kempt with more rights.
var ErrNoElevation = errors.New("run Kempt with sudo to clean folders that belong to the system")

// lang is the language for a request: the window's choice (X-Kempt-Lang),
// then the saved setting, then the browser's language.
func (s *server) lang(r *http.Request) string {
	if l := r.Header.Get("X-Kempt-Lang"); l != "" {
		return i18n.Normalize(l)
	}
	return s.savedLang(r)
}

// savedLang is the language the window should start in: the saved setting,
// else the language Windows and the browser use. /api/mode answers with it,
// so it ignores the header the window sends before it knows the answer.
func (s *server) savedLang(r *http.Request) string {
	if l := LoadSettings(s.DataDir).Lang; l != "" {
		return i18n.Normalize(l)
	}
	return i18n.FromAcceptLanguage(r.Header.Get("Accept-Language"))
}

// fail answers with a translated message; raw (from Windows or a tool,
// not translatable) follows it when given.
func (s *server) fail(w http.ResponseWriter, r *http.Request, status int, code, key string, raw error, vars ...any) {
	msg := i18n.T(s.lang(r), key, vars...)
	if raw != nil {
		msg += " " + raw.Error()
	}
	writeErr(w, status, code, msg)
}

// errKey maps the errors Kempt's own packages return to catalog keys.
func errKey(err error) (string, bool) {
	for e, k := range map[error]string{
		startup.ErrNeedsAdmin:   "err.startup.needsAdmin",
		startup.ErrNotFound:     "err.startup.notFound",
		privacy.ErrUnsupported:  "err.privacy.unsupported",
		schedule.ErrUnsupported: "err.schedule.unsupported",
		schedule.ErrFrequency:   "err.schedule.frequency",
		schedule.ErrDay:         "err.schedule.day",
		schedule.ErrTime:        "err.schedule.time",
		files.ErrNotAbsolute:    "err.folder.notAbsolute",
		files.ErrNoFolder:       "err.folder.missing",
		files.ErrIsFile:         "err.folder.isFile",
		apps.ErrNoWinget:        "err.winget.missing",
		ErrDeclined:             "err.declined",
		ErrNoElevation:          "err.elevate.unsupported",
		errUnsupportedHere:      "err.windowsOnly",
	} {
		if errors.Is(err, e) {
			return k, true
		}
	}
	return "", false
}

// failErr answers with the translation of a known error, or a translated
// prefix (key) followed by the raw error.
func (s *server) failErr(w http.ResponseWriter, r *http.Request, status int, code, key string, err error) {
	if k, ok := errKey(err); ok {
		s.fail(w, r, status, code, k, nil)
		return
	}
	s.fail(w, r, status, code, key, err)
}

func (s *server) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t := bearer(r)
		if t == "" || subtle.ConstantTimeCompare([]byte(t), []byte(s.Token)) != 1 {
			s.fail(w, r, 401, "unauthorized", "err.unauthorized", nil)
			return
		}
		if s.Activity != nil {
			s.Activity()
		}
		h(w, r)
	}
}

func (s *server) mode(w http.ResponseWriter, r *http.Request) {
	win := runtime.GOOS == "windows"
	writeJSON(w, 200, map[string]any{
		"mode": "desktop", "version": Version, "os": runtime.GOOS, "elevated": s.Elevated,
		"lang": s.savedLang(r), "languages": i18n.Languages,
		"features": map[string]bool{
			"privacy": privacy.Supported(), "schedule": schedule.Supported(),
			"updates": win, "winget": apps.Available(), "repair": win, "elevate": win && !s.Elevated,
			"autostart": s.Autostart != nil, "minimize": s.CanMinimize,
		},
	})
}

func (s *server) elevate(w http.ResponseWriter, r *http.Request) {
	if s.Elevate == nil || s.Elevated {
		s.fail(w, r, 400, "unsupported", "err.elevate.already", nil)
		return
	}
	if err := s.Elevate(); err != nil {
		s.failErr(w, r, 409, "elevate_failed", "err.elevate.failed", err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
	if s.Quit != nil {
		go s.Quit()
	}
}

// ---- cleaning ----

func (s *server) categories(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"categories": s.Engine.CatalogIn(s.lang(r)), "care": s.careIDs()})
}

// Settings are the user's choices, kept in settings.json.
type Settings struct {
	CareCategories []string `json:"careCategories"`
	// StartMinimized: when Kempt starts with the computer, open its window
	// minimized on the taskbar.
	StartMinimized bool `json:"startMinimized"`
	// Lang is the window's language: "", "en" or "id". Empty follows Windows.
	Lang string `json:"lang,omitempty"`
}

// SaveSettings writes settings.json.
func SaveSettings(dir string, st Settings) error {
	b, _ := json.MarshalIndent(st, "", "  ")
	return os.WriteFile(filepath.Join(dir, "settings.json"), b, 0o600)
}

// LoadSettings reads settings.json; a missing file gives the defaults.
func LoadSettings(dir string) Settings {
	var st Settings
	if b, err := os.ReadFile(filepath.Join(dir, "settings.json")); err == nil {
		json.Unmarshal(b, &st)
	}
	return st
}

func (s *server) careIDs() []string { return CareIDs(s.Engine, LoadSettings(s.DataDir)) }

// CareIDs are the categories one-click and automatic care clean.
func CareIDs(e *clean.Engine, st Settings) []string {
	if st.CareCategories == nil {
		return e.DefaultIDs()
	}
	var ids []string
	for _, id := range st.CareCategories {
		if c, ok := e.Find(id); ok && c.Kind != "bin" {
			ids = append(ids, id)
		}
	}
	return ids
}

func (s *server) getSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"careCategories": s.careIDs()})
}

func (s *server) putSettings(w http.ResponseWriter, r *http.Request) {
	var in Settings
	if readJSON(w, r, &in) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	if in.CareCategories == nil {
		in.CareCategories = []string{}
	}
	st := LoadSettings(s.DataDir) // keep the other settings
	st.CareCategories = CareIDs(s.Engine, in)
	if st.CareCategories == nil {
		st.CareCategories = []string{}
	}
	if err := SaveSettings(s.DataDir, st); err != nil {
		s.fail(w, r, 500, "write_failed", "err.settings.save", err)
		return
	}
	writeJSON(w, 200, map[string]any{"careCategories": st.CareCategories})
}

// ---- how Kempt itself starts ----

func (s *server) appState(r *http.Request) (map[string]any, error) {
	on := false
	if s.Autostart != nil {
		var err error
		if on, err = s.Autostart.Enabled(r.Context()); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"startup": on, "minimized": LoadSettings(s.DataDir).StartMinimized,
		"startupSupported": s.Autostart != nil, "minimizedSupported": s.CanMinimize,
		"lang": LoadSettings(s.DataDir).Lang,
	}, nil
}

func (s *server) getApp(w http.ResponseWriter, r *http.Request) {
	st, err := s.appState(r)
	if err != nil {
		s.fail(w, r, 500, "read_failed", "err.app.read", err)
		return
	}
	writeJSON(w, 200, st)
}

func (s *server) putApp(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Startup   *bool   `json:"startup"`
		Minimized *bool   `json:"minimized"`
		Lang      *string `json:"lang"`
	}
	if readJSON(w, r, &in) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	if in.Startup != nil {
		if s.Autostart == nil {
			s.fail(w, r, 501, "unsupported", "err.autostart.unsupported", nil)
			return
		}
		if err := s.Autostart.Set(r.Context(), *in.Startup, autostart.Command(s.Exe, s.DataDir)); err != nil {
			s.fail(w, r, 500, "write_failed", "err.change", err)
			return
		}
		key := "journal.autostart.off"
		if *in.Startup {
			key = "journal.autostart.on"
		}
		s.Journal.Add(journal.Entry{Kind: "settings", Msg: msg(i18n.M(key))})
	}
	if in.Minimized != nil {
		if *in.Minimized && !s.CanMinimize {
			s.fail(w, r, 501, "unsupported", "err.minimize.unsupported", nil)
			return
		}
		st := LoadSettings(s.DataDir)
		st.StartMinimized = *in.Minimized
		if err := SaveSettings(s.DataDir, st); err != nil {
			s.fail(w, r, 500, "write_failed", "err.settings.save", err)
			return
		}
		key := "journal.minimized.off"
		if *in.Minimized {
			key = "journal.minimized.on"
		}
		s.Journal.Add(journal.Entry{Kind: "settings", Msg: msg(i18n.M(key))})
	}
	if in.Lang != nil {
		l := *in.Lang
		if l != "" {
			l = i18n.Normalize(l)
		}
		st := LoadSettings(s.DataDir)
		st.Lang = l
		if err := SaveSettings(s.DataDir, st); err != nil {
			s.fail(w, r, 500, "write_failed", "err.settings.save", err)
			return
		}
	}
	st, err := s.appState(r)
	if err != nil {
		s.fail(w, r, 500, "read_failed", "err.app.read", err)
		return
	}
	writeJSON(w, 200, st)
}

// Clean removes the chosen categories and records it in the journal.
func Clean(ctx context.Context, e *clean.Engine, j *journal.Journal, ids []string, auto bool, p *clean.Progress) ([]clean.Result, error) {
	res, err := e.Clean(ctx, ids, p)
	var freed int64
	var files int
	var lines []i18n.Msg
	for _, r := range res {
		c, _ := e.Find(r.ID)
		freed += r.Freed
		name := i18n.Ref(catKey(c) + ".name")
		switch {
		case r.Removed > 0:
			files += r.Removed
			lines = append(lines, i18n.MN("journal.clean.line", int64(r.Removed), "name", name, "size", i18n.SizeArg(r.Freed), "browser", c.App))
		case r.Status == "in-use":
			lines = append(lines, i18n.M("journal.clean.inUse", "name", name, "app", c.App, "browser", c.App))
		case r.Status == "admin":
			lines = append(lines, i18n.M("journal.clean.admin", "name", name, "browser", c.App))
		}
	}
	if j != nil && (files > 0 || !auto) {
		m := i18n.MN("journal.clean.freed", int64(files), "size", i18n.SizeArg(freed))
		if files == 0 {
			m = i18n.M("journal.clean.nothing")
		}
		j.Add(journal.Entry{Kind: "clean", Msg: &m, Bytes: freed, Auto: auto, Lines: lines})
	}
	return res, err
}

// catKey is the catalog key stem of a category (cat.<stem>).
func catKey(c clean.Category) string { return "cat." + clean.TextKey(c) }

func msg(m i18n.Msg) *i18n.Msg { return &m }

// ---- background jobs ----

type progressView struct {
	Files int64  `json:"files"`
	Bytes int64  `json:"bytes"`
	Now   string `json:"now,omitempty"`
}

func (s *server) startJob(w http.ResponseWriter, r *http.Request) {
	kind := r.PathValue("kind")
	var in struct {
		IDs   []string `json:"ids"`
		Root  string   `json:"root"`
		MinMB int64    `json:"minMB"`
		MinKB int64    `json:"minKB"`
		Paths []string `json:"paths"`
	}
	if r.ContentLength != 0 && readJSON(w, r, &in) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	var cp clean.Progress
	var fp files.Progress
	cprog := func() any { n, _ := cp.Now.Load().(string); return progressView{cp.Files.Load(), cp.Bytes.Load(), n} }
	fprog := func() any { n, _ := fp.Now.Load().(string); return progressView{fp.Files.Load(), fp.Bytes.Load(), n} }
	var id string
	switch kind {
	case "scan":
		id = s.Jobs.Start(kind, cprog, func(ctx context.Context) (any, error) {
			return map[string]any{"scans": s.Engine.ScanAll(ctx, &cp)}, nil
		})
	case "clean":
		if len(in.IDs) == 0 {
			in.IDs = s.careIDs()
		}
		for _, cid := range in.IDs {
			if _, ok := s.Engine.Find(cid); !ok {
				s.fail(w, r, 400, "bad_request", "err.category.unknown", nil, "id", cid)
				return
			}
		}
		id = s.Jobs.Start(kind, cprog, func(ctx context.Context) (any, error) {
			res, err := Clean(ctx, s.Engine, s.Journal, in.IDs, false, &cp)
			return map[string]any{"results": res}, err
		})
	case "large", "dupes":
		root := strings.TrimSpace(in.Root)
		if err := files.CheckSearchRoot(root); err != nil {
			s.failErr(w, r, 400, "bad_folder", "err.folder.missing", err)
			return
		}
		id = s.Jobs.Start(kind, fprog, func(ctx context.Context) (any, error) {
			if kind == "large" {
				min := in.MinMB << 20
				if min <= 0 {
					min = 100 << 20
				}
				list, unread, err := files.Largest(ctx, root, min, 200, &fp)
				s.allow(entries(list)...)
				return map[string]any{"files": list, "unreadable": unread, "searched": fp.Files.Load()}, err
			}
			min := in.MinKB << 10
			if min <= 0 {
				min = 1 << 20
			}
			groups, unread, err := files.Duplicates(ctx, root, min, &fp)
			if len(groups) > 500 {
				groups = groups[:500]
			}
			for _, g := range groups {
				s.allow(entries(g.Files)...)
			}
			return map[string]any{"groups": groups, "unreadable": unread, "searched": fp.Files.Load()}, err
		})
	case "recycle":
		if len(in.Paths) == 0 {
			s.fail(w, r, 400, "bad_request", "err.recycle.none", nil)
			return
		}
		for _, p := range in.Paths {
			if !s.allowed(p) {
				s.fail(w, r, 403, "not_found_by_search", "err.recycle.notSearched", nil)
				return
			}
		}
		paths := append([]string(nil), in.Paths...)
		id = s.Jobs.Start(kind, fprog, func(ctx context.Context) (any, error) { return s.recycle(ctx, paths, &fp), nil })
	case "health":
		lang := s.lang(r)
		id = s.Jobs.Start(kind, nil, func(ctx context.Context) (any, error) { return s.Health(ctx, lang), nil })
	case "updates":
		lang := s.lang(r)
		id = s.Jobs.Start(kind, nil, func(ctx context.Context) (any, error) {
			list, err := apps.List(ctx)
			if errors.Is(err, apps.ErrNoWinget) {
				err = errors.New(i18n.T(lang, "err.winget.missing"))
			}
			return map[string]any{"updates": list}, err
		})
	case "upgrade":
		for _, pid := range in.IDs {
			if !apps.ValidID(pid) {
				s.fail(w, r, 400, "bad_request", "err.package.invalid", nil, "id", pid)
				return
			}
		}
		ids := append([]string(nil), in.IDs...)
		id = s.Jobs.Start(kind, fprog, func(ctx context.Context) (any, error) { return s.upgrade(ctx, ids, &fp), nil })
	default:
		s.fail(w, r, 404, "not_found", "err.job.unknown", nil)
		return
	}
	writeJSON(w, 202, map[string]any{"id": id})
}

func entries(es []fsx.Entry) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.Path
	}
	return out
}

func (s *server) allow(paths ...string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, p := range paths {
		s.found[p] = true
	}
}

func (s *server) allowed(p string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.found[p]
}

type itemResult struct {
	Path    string `json:"path,omitempty"`
	ID      string `json:"id,omitempty"`
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

func (s *server) recycle(ctx context.Context, paths []string, p *files.Progress) map[string]any {
	var out []itemResult
	var bytes int64
	var moved []string
	for _, path := range paths {
		if ctx.Err() != nil {
			break
		}
		var size int64
		if fi, err := os.Lstat(path); err == nil {
			size = fi.Size()
		}
		err := s.Recycle(path)
		res := itemResult{Path: path, OK: err == nil}
		if err != nil {
			res.Message = err.Error()
		} else {
			bytes += size
			moved = append(moved, path)
			p.Files.Add(1)
			p.Bytes.Add(size)
			s.mu.Lock()
			delete(s.found, path)
			s.mu.Unlock()
		}
		out = append(out, res)
	}
	if len(moved) > 0 && s.Journal != nil {
		s.Journal.Add(journal.Entry{Kind: "recycle", Bytes: bytes, Details: moved,
			Msg: msg(i18n.MN("journal.recycle", int64(len(moved)), "size", i18n.SizeArg(bytes), "bin", i18n.Ref(binKey())))})
	}
	return map[string]any{"results": out, "bytes": bytes}
}

func (s *server) upgrade(ctx context.Context, ids []string, p *files.Progress) map[string]any {
	var out []itemResult
	var done []string
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		p.Now.Store(id)
		msg, err := apps.Upgrade(ctx, id)
		res := itemResult{ID: id, OK: err == nil, Message: msg}
		if err != nil {
			res.Message = strings.TrimSpace(msg + "\n" + err.Error())
		} else {
			done = append(done, id)
		}
		p.Files.Add(1)
		out = append(out, res)
	}
	if len(done) > 0 && s.Journal != nil {
		s.Journal.Add(journal.Entry{Kind: "update", Details: done, Msg: msg(i18n.MN("journal.update", int64(len(done))))})
	}
	return map[string]any{"results": out}
}

func (s *server) getJob(w http.ResponseWriter, r *http.Request) {
	v, ok := s.Jobs.Get(r.PathValue("id"))
	if !ok {
		s.fail(w, r, 404, "not_found", "err.job.ended", nil)
		return
	}
	writeJSON(w, 200, v)
}

func (s *server) cancelJob(w http.ResponseWriter, r *http.Request) {
	if err := s.Jobs.Cancel(r.PathValue("id")); err != nil {
		s.fail(w, r, 404, "not_found", "err.job.ended", nil)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---- startup ----

func (s *server) listStartup(w http.ResponseWriter, r *http.Request) {
	items, err := s.Startup.List(r.Context())
	if err != nil {
		s.fail(w, r, 500, "read_failed", "err.startup.read", err)
		return
	}
	if items == nil {
		items = []startup.Item{}
	}
	lang := s.lang(r)
	for i := range items {
		items[i].Where = startup.SourceLabelIn(lang, items[i].Source)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *server) setStartup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if readJSON(w, r, &in) != nil || in.ID == "" {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	it, err := s.Startup.Set(r.Context(), in.ID, in.Enabled)
	switch {
	case errors.Is(err, startup.ErrNeedsAdmin):
		s.fail(w, r, 403, "needs_admin", "err.startup.needsAdmin", nil)
		return
	case errors.Is(err, startup.ErrNotFound):
		s.fail(w, r, 404, "not_found", "err.startup.notFound", nil)
		return
	case err != nil:
		s.fail(w, r, 500, "write_failed", "err.change", err)
		return
	}
	it.Where = startup.SourceLabelIn(s.lang(r), it.Source)
	key := map[bool]string{true: "journal.startup.on", false: "journal.startup.off"}[in.Enabled]
	s.Journal.Add(journal.Entry{Kind: "startup", Msg: msg(i18n.M(key, "name", it.Name)),
		Undo: &journal.Undo{Kind: "startup", ID: in.ID, Value: !in.Enabled}})
	writeJSON(w, 200, it)
}

// ---- privacy ----

func (s *server) listPrivacy(w http.ResponseWriter, r *http.Request) {
	if !privacy.Supported() {
		s.fail(w, r, 501, "unsupported", "err.privacy.unsupported", nil)
		return
	}
	list, err := privacy.Read(r.Context())
	if err != nil {
		s.fail(w, r, 500, "read_failed", "err.privacy.read", err)
		return
	}
	privacy.Localize(list, s.lang(r))
	writeJSON(w, 200, map[string]any{"settings": list})
}

func (s *server) setPrivacy(w http.ResponseWriter, r *http.Request) {
	if !privacy.Supported() {
		s.fail(w, r, 501, "unsupported", "err.privacy.unsupported", nil)
		return
	}
	var in struct {
		ID string `json:"id"`
		On bool   `json:"on"`
	}
	if readJSON(w, r, &in) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	st, err := privacy.Set(r.Context(), in.ID, in.On)
	if err != nil {
		s.fail(w, r, 500, "write_failed", "err.change", err)
		return
	}
	privacy.Localize([]privacy.Setting{st}, s.lang(r))
	st.Title = i18n.T(s.lang(r), "priv."+st.ID+".title")
	key := map[bool]string{true: "journal.privacy.on", false: "journal.privacy.off"}[in.On]
	s.Journal.Add(journal.Entry{Kind: "privacy", Msg: msg(i18n.M(key, "setting", i18n.Ref("priv."+st.ID+".title"))),
		Undo: &journal.Undo{Kind: "privacy", ID: in.ID, Value: !in.On}})
	writeJSON(w, 200, st)
}

// ---- automatic care ----

func (s *server) getSchedule(w http.ResponseWriter, r *http.Request) {
	if !schedule.Supported() {
		s.fail(w, r, 501, "unsupported", "err.schedule.unsupported", nil)
		return
	}
	p, err := schedule.Get(r.Context())
	if err != nil {
		s.fail(w, r, 500, "read_failed", "err.schedule.read", err)
		return
	}
	writeJSON(w, 200, p)
}

func (s *server) putSchedule(w http.ResponseWriter, r *http.Request) {
	if !schedule.Supported() {
		s.fail(w, r, 501, "unsupported", "err.schedule.unsupported", nil)
		return
	}
	var p schedule.Plan
	if readJSON(w, r, &p) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	if err := p.Validate(); err != nil {
		s.failErr(w, r, 400, "bad_plan", "err.badRequest", err)
		return
	}
	got, err := schedule.Apply(r.Context(), p, s.Exe, `care --data "`+s.DataDir+`"`)
	if err != nil {
		s.fail(w, r, 500, "write_failed", "err.schedule.write", err)
		return
	}
	m := i18n.M("journal.schedule.off")
	if p.Enabled {
		m = i18n.M("journal.schedule.daily", "time", p.Time)
		if p.Frequency == "weekly" {
			m = i18n.M("journal.schedule.weekly", "day", i18n.Ref("day."+strings.ToLower(p.Day)), "time", p.Time)
		}
	}
	s.Journal.Add(journal.Entry{Kind: "schedule", Msg: &m})
	writeJSON(w, 200, got)
}

// ---- journal ----

func (s *server) listJournal(w http.ResponseWriter, r *http.Request) {
	list, err := s.Journal.ListIn(300, s.lang(r))
	if err != nil {
		s.fail(w, r, 500, "read_failed", "err.journal.read", err)
		return
	}
	writeJSON(w, 200, map[string]any{"entries": list})
}

func (s *server) undo(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	if readJSON(w, r, &in) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	e, ok := s.Journal.Find(in.ID)
	if !ok || e.Undo == nil || e.Undone {
		s.fail(w, r, 404, "not_found", "err.undo.none", nil)
		return
	}
	var err error
	switch e.Undo.Kind {
	case "startup":
		_, err = s.Startup.Set(r.Context(), e.Undo.ID, e.Undo.Value)
	case "privacy":
		if !privacy.Supported() {
			err = privacy.ErrUnsupported
		} else {
			_, err = privacy.Set(r.Context(), e.Undo.ID, e.Undo.Value)
		}
	default:
		err = errors.New("unknown change")
	}
	if err != nil {
		s.failErr(w, r, 409, "undo_failed", "err.undo.failed", err)
		return
	}
	// Find reads in English, so the stored fallback text is English too.
	u, _ := s.Journal.Add(journal.Entry{Kind: "undo", Summary: "Undid: " + e.Summary, Undoes: e.ID})
	if l, err := s.Journal.ListIn(1, s.lang(r)); err == nil && len(l) == 1 {
		u.Summary = l[0].Summary
	}
	writeJSON(w, 200, u)
}

// ---- actions ----

// actions are the only things the window may ask Kempt to open or run.
var actions = map[string]string{
	"open:security":      "windowsdefender:",
	"open:firewall":      "windowsdefender://network",
	"open:windowsupdate": "ms-settings:windowsupdate",
	"open:storagesense":  "ms-settings:storagesense",
	"open:backup":        "ms-settings:backup",
	"open:startupapps":   "ms-settings:startupapps",
	"open:apps":          "ms-settings:appsfeatures",
	"open:diskcleanup":   "cleanmgr.exe",
	"run:repair":         "repair",
}

func (s *server) action(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID   string `json:"id"`
		Path string `json:"path"`
	}
	if readJSON(w, r, &in) != nil {
		s.fail(w, r, 400, "bad_request", "err.badRequest", nil)
		return
	}
	var err error
	switch {
	case in.ID == "reveal":
		if !s.allowed(in.Path) && !s.inScan(in.Path) {
			s.fail(w, r, 403, "refused", "err.reveal.refused", nil)
			return
		}
		if s.Reveal == nil {
			err = errors.New("not available")
		} else {
			err = s.Reveal(in.Path)
		}
	case strings.HasPrefix(in.ID, "settings:"):
		// A Settings page named by a privacy switch.
		uri := strings.TrimPrefix(in.ID, "settings:")
		ok := false
		for _, st := range privacy.Catalog() {
			ok = ok || (st.Settings != "" && st.Settings == uri)
		}
		if !ok {
			s.fail(w, r, 403, "refused", "err.action.unknownPage", nil)
			return
		}
		err = s.open(uri)
	default:
		target, ok := actions[in.ID]
		if !ok {
			s.fail(w, r, 403, "refused", "err.action.unknown", nil)
			return
		}
		err = s.open(target)
		if err == nil && in.ID == "run:repair" {
			s.Journal.Add(journal.Entry{Kind: "repair", Msg: msg(i18n.M("journal.repair"))})
		}
	}
	if err != nil {
		s.failErr(w, r, 409, "action_failed", "err.action.failed", err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *server) open(target string) error {
	if s.Open == nil || runtime.GOOS != "windows" && !strings.HasPrefix(target, "/") {
		return errUnsupportedHere
	}
	return s.Open(target)
}

// inScan reports whether p is one of the largest files a cleaning scan
// listed, by checking it lies inside a category's folders.
func (s *server) inScan(p string) bool {
	if !filepath.IsAbs(p) {
		return false
	}
	for _, c := range s.Engine.Catalog() {
		for _, pat := range c.Roots {
			if m, _ := filepath.Glob(pat); len(m) > 0 {
				for _, root := range m {
					if fsx.Within(p, root) {
						return true
					}
				}
			}
		}
	}
	return false
}

// folders suggests where to search for large files and duplicates.
func (s *server) folders(w http.ResponseWriter, r *http.Request) {
	home, _ := os.UserHomeDir()
	var list []map[string]string
	add := func(label, p string) {
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			list = append(list, map[string]string{"label": label, "path": p})
		}
	}
	add("Your files", home)
	for _, n := range []string{"Downloads", "Desktop", "Documents", "Pictures", "Videos", "Music"} {
		add(n, filepath.Join(home, n))
	}
	for _, d := range driveRoots() {
		add("Drive "+d, d)
	}
	writeJSON(w, 200, map[string]any{"folders": list, "home": home})
}

func driveRoots() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	var out []string
	for c := 'C'; c <= 'Z'; c++ {
		d := string(c) + `:\`
		if _, err := os.Stat(d); err == nil {
			out = append(out, d)
		}
	}
	return out
}

// binKey is the catalog key for the Recycle Bin, or the trash on Linux.
func binKey() string {
	if runtime.GOOS == "windows" {
		return "word.recycleBin"
	}
	return "word.trash"
}

var errUnsupportedHere = errors.New("this is only available on Windows")
