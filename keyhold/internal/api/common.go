// Package api serves the Keyhold web app and its two HTTP APIs:
// the desktop API (one vault on this computer, loopback only) and the sync
// server API (accounts that each hold one encrypted vault).
package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// Version is set by main.
var Version = "dev"

const maxBody = 34 << 20 // a vault plus JSON overhead

type staticFile struct {
	body []byte
	etag string
	ctyp string
}

// Static serves the embedded web app with ETags. Unknown paths that look like
// app routes return index.html.
type Static struct {
	files map[string]staticFile
}

// NewStatic reads every file of fsys into memory.
func NewStatic(fsys fs.FS) (*Static, error) {
	s := &Static{files: map[string]staticFile{}}
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		b, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(b)
		ct := mime.TypeByExtension(path.Ext(p))
		switch path.Ext(p) {
		case ".js":
			ct = "text/javascript; charset=utf-8"
		case ".webmanifest":
			ct = "application/manifest+json"
		case ".txt":
			ct = "text/plain; charset=utf-8"
		case ".svg":
			ct = "image/svg+xml"
		}
		if ct == "" {
			ct = "application/octet-stream"
		}
		s.files["/"+p] = staticFile{body: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`, ctyp: ct}
		return nil
	})
	return s, err
}

func (s *Static) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p := r.URL.Path
	if p == "/" {
		p = "/index.html"
	}
	f, ok := s.files[p]
	if !ok {
		if path.Ext(p) != "" || strings.HasPrefix(p, "/api/") {
			http.NotFound(w, r)
			return
		}
		f = s.files["/index.html"]
	}
	w.Header().Set("Content-Type", f.ctyp)
	w.Header().Set("ETag", f.etag)
	w.Header().Set("Cache-Control", "no-cache")
	if p == "/sw.js" {
		w.Header().Set("Service-Worker-Allowed", "/")
	}
	if r.Header.Get("If-None-Match") == f.etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Write(f.body)
}

// securityHeaders adds a strict Content-Security-Policy and related headers.
func securityHeaders(next http.Handler, connectSrc string, https bool) http.Handler {
	csp := "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
		"font-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src " + connectSrc +
		"; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		h.Set("Cross-Origin-Resource-Policy", "same-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
		if https {
			h.Set("Strict-Transport-Security", "max-age=63072000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"error": code, "message": msg})
}

var errBadJSON = errors.New("bad json")

func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		return errBadJSON
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBody)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(v); err != nil {
		return errBadJSON
	}
	if _, err := dec.Token(); err != io.EOF {
		return errBadJSON
	}
	return nil
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}
