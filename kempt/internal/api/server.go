package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/ZenZeiTen/synthapps/kempt/internal/apps"
	"github.com/ZenZeiTen/synthapps/kempt/internal/clean"
	"github.com/ZenZeiTen/synthapps/kempt/internal/files"
	"github.com/ZenZeiTen/synthapps/kempt/internal/fsx"
	"github.com/ZenZeiTen/synthapps/kempt/internal/health"
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

	Activity func()                    // called on every authenticated request
	Quit     func()                    // the window asked Kempt to close
	Elevate  func() error              // start Kempt again as administrator
	Open     func(target string) error // open a settings page or program (see actions)
	Reveal   func(path string) error   // show a file in its folder
	Recycle  func(path string) error
	Health   func(ctx context.Context) health.Report
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

func (s *server) auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t := bearer(r)
		if t == "" || subtle.ConstantTimeCompare([]byte(t), []byte(s.Token)) != 1 {
			writeErr(w, 401, "unauthorized", "This window is no longer connected to Kempt. Open Kempt again.")
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
		"features": map[string]bool{
			"privacy": privacy.Supported(), "schedule": schedule.Supported(),
			"updates": win, "winget": apps.Available(), "repair": win, "elevate": win && !s.Elevated,
		},
	})
}

func (s *server) elevate(w http.ResponseWriter, r *http.Request) {
	if s.Elevate == nil || s.Elevated {
		writeErr(w, 400, "unsupported", "Kempt is already running with the rights it can have.")
		return
	}
	if err := s.Elevate(); err != nil {
		writeErr(w, 409, "elevate_failed", "Kempt was not restarted: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
	if s.Quit != nil {
		go s.Quit()
	}
}

// ---- cleaning ----

func (s *server) categories(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"categories": s.Engine.Catalog(), "care": s.careIDs()})
}

// Settings are the user's choices, kept in settings.json.
type Settings struct {
	CareCategories []string `json:"careCategories"`
}

func (s *server) settingsPath() string { return filepath.Join(s.DataDir, "settings.json") }

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
		writeErr(w, 400, "bad_request", "Invalid request.")
		return
	}
	if in.CareCategories == nil {
		in.CareCategories = []string{}
	}
	in.CareCategories = CareIDs(s.Engine, in)
	b, _ := json.MarshalIndent(in, "", "  ")
	if err := os.WriteFile(s.settingsPath(), b, 0o600); err != nil {
		writeErr(w, 500, "write_failed", "Could not save the settings: "+err.Error())
		return
	}
	writeJSON(w, 200, in)
}

// Clean removes the chosen categories and records it in the journal.
func Clean(ctx context.Context, e *clean.Engine, j *journal.Journal, ids []string, auto bool, p *clean.Progress) ([]clean.Result, error) {
	res, err := e.Clean(ctx, ids, p)
	var freed int64
	var files int
	var details []string
	for _, r := range res {
		c, _ := e.Find(r.ID)
		freed += r.Freed
		files += r.Removed
		switch {
		case r.Removed > 0:
			details = append(details, fmt.Sprintf("%s: %s, %s", c.Name, health.GB(r.Freed), plural(r.Removed, "file")))
		case r.Status == "in-use":
			details = append(details, c.Name+": skipped, "+c.App+" was open")
		case r.Status == "admin":
			details = append(details, c.Name+": skipped, needs administrator")
		}
	}
	if j != nil && (files > 0 || !auto) {
		sum := fmt.Sprintf("Freed %s (%s)", health.GB(freed), plural(files, "file"))
		if files == 0 {
			sum = "Nothing to remove"
		}
		j.Add(journal.Entry{Kind: "clean", Summary: sum, Bytes: freed, Auto: auto, Details: details})
	}
	return res, err
}

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
		writeErr(w, 400, "bad_request", "Invalid request.")
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
				writeErr(w, 400, "bad_request", "Unknown category "+cid+".")
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
			writeErr(w, 400, "bad_folder", err.Error())
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
			writeErr(w, 400, "bad_request", "No files chosen.")
			return
		}
		for _, p := range in.Paths {
			if !s.allowed(p) {
				writeErr(w, 403, "not_found_by_search", "Kempt only moves files it showed you in a search.")
				return
			}
		}
		paths := append([]string(nil), in.Paths...)
		id = s.Jobs.Start(kind, fprog, func(ctx context.Context) (any, error) { return s.recycle(ctx, paths, &fp), nil })
	case "health":
		id = s.Jobs.Start(kind, nil, func(ctx context.Context) (any, error) { return s.Health(ctx), nil })
	case "updates":
		id = s.Jobs.Start(kind, nil, func(ctx context.Context) (any, error) {
			list, err := apps.List(ctx)
			return map[string]any{"updates": list}, err
		})
	case "upgrade":
		for _, pid := range in.IDs {
			if !apps.ValidID(pid) {
				writeErr(w, 400, "bad_request", "Not a package id: "+pid)
				return
			}
		}
		ids := append([]string(nil), in.IDs...)
		id = s.Jobs.Start(kind, fprog, func(ctx context.Context) (any, error) { return s.upgrade(ctx, ids, &fp), nil })
	default:
		writeErr(w, 404, "not_found", "Unknown job.")
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
			Summary: fmt.Sprintf("Moved %s (%s) to the %s", plural(len(moved), "file"), health.GB(bytes), binName())})
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
		s.Journal.Add(journal.Entry{Kind: "update", Details: done, Summary: "Updated " + plural(len(done), "program")})
	}
	return map[string]any{"results": out}
}

func (s *server) getJob(w http.ResponseWriter, r *http.Request) {
	v, ok := s.Jobs.Get(r.PathValue("id"))
	if !ok {
		writeErr(w, 404, "not_found", "That task has ended.")
		return
	}
	writeJSON(w, 200, v)
}

func (s *server) cancelJob(w http.ResponseWriter, r *http.Request) {
	if err := s.Jobs.Cancel(r.PathValue("id")); err != nil {
		writeErr(w, 404, "not_found", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---- startup ----

func (s *server) listStartup(w http.ResponseWriter, r *http.Request) {
	items, err := s.Startup.List(r.Context())
	if err != nil {
		writeErr(w, 500, "read_failed", "Could not read the startup programs: "+err.Error())
		return
	}
	if items == nil {
		items = []startup.Item{}
	}
	writeJSON(w, 200, map[string]any{"items": items})
}

func (s *server) setStartup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID      string `json:"id"`
		Enabled bool   `json:"enabled"`
	}
	if readJSON(w, r, &in) != nil || in.ID == "" {
		writeErr(w, 400, "bad_request", "Invalid request.")
		return
	}
	it, err := s.Startup.Set(r.Context(), in.ID, in.Enabled)
	switch {
	case errors.Is(err, startup.ErrNeedsAdmin):
		writeErr(w, 403, "needs_admin", err.Error())
		return
	case errors.Is(err, startup.ErrNotFound):
		writeErr(w, 404, "not_found", err.Error())
		return
	case err != nil:
		writeErr(w, 500, "write_failed", "Could not change it: "+err.Error())
		return
	}
	verb := map[bool]string{true: "Turned on", false: "Turned off"}[in.Enabled]
	s.Journal.Add(journal.Entry{Kind: "startup", Summary: verb + " " + it.Name + " at startup",
		Undo: &journal.Undo{Kind: "startup", ID: in.ID, Value: !in.Enabled}})
	writeJSON(w, 200, it)
}

// ---- privacy ----

func (s *server) listPrivacy(w http.ResponseWriter, r *http.Request) {
	if !privacy.Supported() {
		writeErr(w, 501, "unsupported", privacy.ErrUnsupported.Error())
		return
	}
	list, err := privacy.Read(r.Context())
	if err != nil {
		writeErr(w, 500, "read_failed", "Could not read the settings: "+err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"settings": list})
}

func (s *server) setPrivacy(w http.ResponseWriter, r *http.Request) {
	if !privacy.Supported() {
		writeErr(w, 501, "unsupported", privacy.ErrUnsupported.Error())
		return
	}
	var in struct {
		ID string `json:"id"`
		On bool   `json:"on"`
	}
	if readJSON(w, r, &in) != nil {
		writeErr(w, 400, "bad_request", "Invalid request.")
		return
	}
	st, err := privacy.Set(r.Context(), in.ID, in.On)
	if err != nil {
		writeErr(w, 500, "write_failed", "Could not change it: "+err.Error())
		return
	}
	verb := map[bool]string{true: "Turned on", false: "Turned off"}[in.On]
	s.Journal.Add(journal.Entry{Kind: "privacy", Summary: verb + ": " + st.Title,
		Undo: &journal.Undo{Kind: "privacy", ID: in.ID, Value: !in.On}})
	writeJSON(w, 200, st)
}

// ---- automatic care ----

func (s *server) getSchedule(w http.ResponseWriter, r *http.Request) {
	if !schedule.Supported() {
		writeErr(w, 501, "unsupported", schedule.ErrUnsupported.Error())
		return
	}
	p, err := schedule.Get(r.Context())
	if err != nil {
		writeErr(w, 500, "read_failed", "Could not read Task Scheduler: "+err.Error())
		return
	}
	writeJSON(w, 200, p)
}

func (s *server) putSchedule(w http.ResponseWriter, r *http.Request) {
	if !schedule.Supported() {
		writeErr(w, 501, "unsupported", schedule.ErrUnsupported.Error())
		return
	}
	var p schedule.Plan
	if readJSON(w, r, &p) != nil {
		writeErr(w, 400, "bad_request", "Invalid request.")
		return
	}
	if err := p.Validate(); err != nil {
		writeErr(w, 400, "bad_plan", err.Error())
		return
	}
	got, err := schedule.Apply(r.Context(), p, s.Exe, `care --data "`+s.DataDir+`"`)
	if err != nil {
		writeErr(w, 500, "write_failed", "Task Scheduler refused the change: "+err.Error())
		return
	}
	sum := "Turned off automatic care"
	if p.Enabled {
		sum = "Automatic care: " + p.Frequency + " at " + p.Time
		if p.Frequency == "weekly" {
			sum = "Automatic care: every " + p.Day + " at " + p.Time
		}
	}
	s.Journal.Add(journal.Entry{Kind: "schedule", Summary: sum})
	writeJSON(w, 200, got)
}

// ---- journal ----

func (s *server) listJournal(w http.ResponseWriter, r *http.Request) {
	list, err := s.Journal.List(300)
	if err != nil {
		writeErr(w, 500, "read_failed", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"entries": list})
}

func (s *server) undo(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID string `json:"id"`
	}
	if readJSON(w, r, &in) != nil {
		writeErr(w, 400, "bad_request", "Invalid request.")
		return
	}
	e, ok := s.Journal.Find(in.ID)
	if !ok || e.Undo == nil || e.Undone {
		writeErr(w, 404, "not_found", "That change cannot be undone.")
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
		writeErr(w, 409, "undo_failed", "Could not undo it: "+err.Error())
		return
	}
	u, _ := s.Journal.Add(journal.Entry{Kind: "undo", Summary: "Undid: " + e.Summary, Undoes: e.ID})
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
		writeErr(w, 400, "bad_request", "Invalid request.")
		return
	}
	var err error
	switch {
	case in.ID == "reveal":
		if !s.allowed(in.Path) && !s.inScan(in.Path) {
			writeErr(w, 403, "refused", "Kempt only opens folders of files it showed you.")
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
			writeErr(w, 403, "refused", "Unknown page.")
			return
		}
		err = s.open(uri)
	default:
		target, ok := actions[in.ID]
		if !ok {
			writeErr(w, 403, "refused", "Unknown action.")
			return
		}
		err = s.open(target)
		if err == nil && in.ID == "run:repair" {
			s.Journal.Add(journal.Entry{Kind: "repair", Summary: "Started System File Checker and DISM"})
		}
	}
	if err != nil {
		writeErr(w, 409, "action_failed", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *server) open(target string) error {
	if s.Open == nil || runtime.GOOS != "windows" && !strings.HasPrefix(target, "/") {
		return errors.New("this is only available on Windows")
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

func plural(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func binName() string {
	if runtime.GOOS == "windows" {
		return "Recycle Bin"
	}
	return "trash"
}
