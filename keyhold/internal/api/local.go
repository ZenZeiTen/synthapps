package api

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/ZenZeiTen/synthapps/keyhold/internal/store"
)

// DesktopConfig configures the loopback-only desktop server.
type DesktopConfig struct {
	Store  *store.Store
	Token  string   // per-launch secret, required on every /api/local call
	Hosts  []string // accepted Host headers, e.g. 127.0.0.1:47811
	Static http.Handler
	// Activity is called on every authenticated request and heartbeat.
	Activity func()
	// Quit is called when the app asks to close.
	Quit func()
}

// NewDesktop returns the handler for desktop (offline) mode.
func NewDesktop(c DesktopConfig) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/mode", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"mode": "desktop", "version": Version})
	})
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			t := bearer(r)
			if t == "" || subtle.ConstantTimeCompare([]byte(t), []byte(c.Token)) != 1 {
				writeErr(w, 401, "unauthorized", "This window is no longer connected. Open Keyhold again from the Start menu or its shortcut.")
				return
			}
			if c.Activity != nil {
				c.Activity()
			}
			h(w, r)
		}
	}
	mux.HandleFunc("GET /api/local/vault", auth(func(w http.ResponseWriter, r *http.Request) {
		rec, err := c.Store.Load()
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, 404, "not_found", "No vault yet.")
			return
		}
		if err != nil {
			writeErr(w, 500, "read_failed", err.Error())
			return
		}
		writeJSON(w, 200, rec)
	}))
	mux.HandleFunc("PUT /api/local/vault", auth(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Rev   int64           `json:"rev"`
			Vault json.RawMessage `json:"vault"`
			Meta  json.RawMessage `json:"meta"`
		}
		if err := readJSON(w, r, &in); err != nil {
			writeErr(w, 400, "bad_request", "Invalid request.")
			return
		}
		rec, err := c.Store.Save(in.Rev, in.Vault, in.Meta)
		var ce *store.ConflictError
		switch {
		case errors.As(err, &ce):
			writeJSON(w, 409, map[string]any{"error": "conflict", "rev": ce.Current})
		case errors.Is(err, store.ErrInvalid):
			writeErr(w, 400, "invalid_vault", "The vault data is not valid.")
		case err != nil:
			writeErr(w, 500, "write_failed", "Could not save: "+err.Error())
		default:
			writeJSON(w, 200, map[string]any{"rev": rec.Rev, "savedAt": rec.SavedAt})
		}
	}))
	mux.HandleFunc("GET /api/local/backups", auth(func(w http.ResponseWriter, r *http.Request) {
		list, err := c.Store.Backups()
		if err != nil {
			writeErr(w, 500, "read_failed", err.Error())
			return
		}
		if list == nil {
			list = []store.BackupInfo{}
		}
		writeJSON(w, 200, map[string]any{"backups": list, "folder": c.Store.Dir()})
	}))
	mux.HandleFunc("GET /api/local/backups/{name}", auth(func(w http.ResponseWriter, r *http.Request) {
		rec, err := c.Store.ReadBackup(r.PathValue("name"))
		if err != nil {
			writeErr(w, 404, "not_found", "Backup not found.")
			return
		}
		writeJSON(w, 200, rec)
	}))
	mux.HandleFunc("POST /api/local/heartbeat", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now().UTC()})
	}))
	mux.HandleFunc("POST /api/local/quit", auth(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true})
		if c.Quit != nil {
			go c.Quit()
		}
	}))
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
	// The desktop page may talk to a sync server over HTTPS, a sync server on this
	// computer, and the breach-check service.
	return securityHeaders(guarded, "'self' https: http://127.0.0.1:* http://localhost:*", false)
}
