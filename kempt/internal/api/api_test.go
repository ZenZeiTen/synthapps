package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/clean"
	"github.com/ZenZeiTen/synthapps/kempt/internal/health"
	"github.com/ZenZeiTen/synthapps/kempt/internal/jobs"
	"github.com/ZenZeiTen/synthapps/kempt/internal/journal"
	"github.com/ZenZeiTen/synthapps/kempt/internal/startup"
)

const tok = "secret-token"

type rig struct {
	h        http.Handler
	home     string
	recycled []string
	opened   []string
	x        *startup.XDG
}

func newRig(t *testing.T) *rig {
	t.Helper()
	home := t.TempDir()
	data := t.TempDir()
	vars := map[string]string{"XDG_CACHE_HOME": filepath.Join(home, ".cache"), "XDG_CONFIG_HOME": filepath.Join(home, ".config")}
	e := &clean.Engine{
		Env: clean.Env{GOOS: "linux", Home: home, Getenv: func(k string) string { return vars[k] }},
		Now: time.Now, BinSize: func() (int64, int64, error) { return 0, 0, nil }, EmptyBin: func() error { return nil },
	}
	r := &rig{home: home}
	r.x = &startup.XDG{UserDir: filepath.Join(home, ".config", "autostart"), SystemDirs: []string{filepath.Join(home, "sys")}}
	os.MkdirAll(r.x.SystemDirs[0], 0o755)
	os.WriteFile(filepath.Join(r.x.SystemDirs[0], "a.desktop"), []byte("[Desktop Entry]\nName=Applet\nExec=applet\n"), 0o644)
	static, _ := NewStatic(fstest.MapFS{"index.html": {Data: []byte("<html>")}})
	r.h = NewDesktop(Config{
		DataDir: data, Token: tok, Hosts: []string{"127.0.0.1:1"}, Static: static,
		Engine: e, Startup: r.x, Journal: journal.Open(data), Jobs: jobs.New(),
		Recycle: func(p string) error { r.recycled = append(r.recycled, p); return os.Remove(p) },
		Open:    func(target string) error { r.opened = append(r.opened, target); return nil },
		Health:  func(ctx context.Context) health.Report { return health.Report{Findings: []health.Finding{{ID: "x"}}} },
	})
	return r
}

func (r *rig) do(t *testing.T, method, path string, body any, hdr ...string) (int, map[string]any) {
	t.Helper()
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req.Host = "127.0.0.1:1"
	req.Header.Set("Authorization", "Bearer "+tok)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		if hdr[i] == "Host" {
			req.Host = hdr[i+1]
		} else {
			req.Header.Set(hdr[i], hdr[i+1])
		}
	}
	w := httptest.NewRecorder()
	r.h.ServeHTTP(w, req)
	var out map[string]any
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func (r *rig) job(t *testing.T, kind string, body any) map[string]any {
	t.Helper()
	code, out := r.do(t, "POST", "/api/local/jobs/"+kind, body)
	if code != 202 {
		t.Fatalf("start %s: %d %v", kind, code, out)
	}
	for i := 0; i < 300; i++ {
		_, v := r.do(t, "GET", "/api/local/jobs/"+out["id"].(string), nil)
		if v["state"] != "running" {
			if v["state"] != "done" {
				t.Fatalf("%s ended %v", kind, v)
			}
			return v["result"].(map[string]any)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("job did not finish")
	return nil
}

func TestGuards(t *testing.T) {
	r := newRig(t)
	if code, _ := r.do(t, "GET", "/api/local/categories", nil, "Authorization", "Bearer wrong"); code != 401 {
		t.Fatalf("wrong token: %d", code)
	}
	if code, _ := r.do(t, "GET", "/api/local/categories", nil, "Host", "evil.example:1"); code != 421 {
		t.Fatalf("foreign host: %d", code)
	}
	if code, _ := r.do(t, "GET", "/api/local/categories", nil, "Origin", "http://evil.example"); code != 403 {
		t.Fatalf("foreign origin: %d", code)
	}
	if code, out := r.do(t, "GET", "/api/mode", nil); code != 200 || out["mode"] != "desktop" {
		t.Fatalf("mode %d %v", code, out)
	}
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "127.0.0.1:1"
	w := httptest.NewRecorder()
	r.h.ServeHTTP(w, req)
	if w.Header().Get("Content-Security-Policy") == "" {
		t.Fatal("no CSP")
	}
	if code, _ := r.do(t, "POST", "/api/local/action", map[string]string{"id": "open:anything-else"}); code != 403 {
		t.Fatal("unlisted action accepted")
	}
}

func TestCleanAndJournal(t *testing.T) {
	r := newRig(t)
	thumbs := filepath.Join(r.home, ".cache", "thumbnails", "large")
	os.MkdirAll(thumbs, 0o755)
	old := time.Now().Add(-60 * 24 * time.Hour)
	for _, n := range []string{"a.png", "b.png"} {
		p := filepath.Join(thumbs, n)
		os.WriteFile(p, make([]byte, 1000), 0o644)
		os.Chtimes(p, old, old)
	}
	scans := r.job(t, "scan", nil)["scans"].([]any)
	if s := scans[0].(map[string]any); s["id"] != "thumbnails" || s["files"].(float64) != 2 {
		t.Fatalf("scan %v", s)
	}
	res := r.job(t, "clean", map[string]any{"ids": []string{"thumbnails"}})["results"].([]any)
	if c := res[0].(map[string]any); c["removed"].(float64) != 2 {
		t.Fatalf("clean %v", c)
	}
	_, j := r.do(t, "GET", "/api/local/journal", nil)
	if e := j["entries"].([]any)[0].(map[string]any); e["kind"] != "clean" || e["bytes"].(float64) != 2000 {
		t.Fatalf("journal %v", e)
	}
	if code, _ := r.do(t, "POST", "/api/local/jobs/clean", map[string]any{"ids": []string{"../../etc"}}); code != 400 {
		t.Fatal("unknown category accepted")
	}
}

func TestRecycleOnlySearchedFiles(t *testing.T) {
	r := newRig(t)
	docs := filepath.Join(r.home, "Videos")
	os.MkdirAll(docs, 0o755)
	big := filepath.Join(docs, "movie.mkv")
	os.WriteFile(big, make([]byte, 2<<20), 0o644)
	other := filepath.Join(docs, "keep.txt")
	os.WriteFile(other, []byte("x"), 0o644)

	if code, _ := r.do(t, "POST", "/api/local/jobs/recycle", map[string]any{"paths": []string{big}}); code != 403 {
		t.Fatal("recycled a file no search showed")
	}
	found := r.job(t, "large", map[string]any{"root": r.home, "minMB": 1})["files"].([]any)
	if len(found) != 1 || found[0].(map[string]any)["path"] != big {
		t.Fatalf("large %v", found)
	}
	if code, _ := r.do(t, "POST", "/api/local/jobs/recycle", map[string]any{"paths": []string{big, other}}); code != 403 {
		t.Fatal("a file outside the results slipped through")
	}
	res := r.job(t, "recycle", map[string]any{"paths": []string{big}})
	if res["bytes"].(float64) != 2<<20 || len(r.recycled) != 1 {
		t.Fatalf("recycle %v", res)
	}
	if code, _ := r.do(t, "POST", "/api/local/jobs/recycle", map[string]any{"paths": []string{big}}); code != 403 {
		t.Fatal("the same file could be sent twice")
	}
	if code, _ := r.do(t, "POST", "/api/local/jobs/large", map[string]any{"root": "relative"}); code != 400 {
		t.Fatal("relative search root accepted")
	}
}

func TestStartupUndo(t *testing.T) {
	r := newRig(t)
	_, list := r.do(t, "GET", "/api/local/startup", nil)
	if len(list["items"].([]any)) != 1 {
		t.Fatalf("items %v", list)
	}
	if code, out := r.do(t, "POST", "/api/local/startup", map[string]any{"id": "xdg:a.desktop", "enabled": false}); code != 200 || out["enabled"] != false {
		t.Fatalf("set %d %v", code, out)
	}
	_, j := r.do(t, "GET", "/api/local/journal", nil)
	e := j["entries"].([]any)[0].(map[string]any)
	if code, _ := r.do(t, "POST", "/api/local/undo", map[string]any{"id": e["id"]}); code != 200 {
		t.Fatal("undo failed")
	}
	items, _ := r.x.List(context.Background())
	if !items[0].Enabled {
		t.Fatal("undo did not turn it back on")
	}
	if code, _ := r.do(t, "POST", "/api/local/undo", map[string]any{"id": e["id"]}); code != 404 {
		t.Fatal("undone twice")
	}
}

func TestSettingsNeverIncludeBin(t *testing.T) {
	r := newRig(t)
	code, out := r.do(t, "PUT", "/api/local/settings", map[string]any{"careCategories": []string{"thumbnails", "recycle-bin", "nope"}})
	got := out["careCategories"].([]any)
	if code != 200 || len(got) != 1 || got[0] != "thumbnails" {
		t.Fatalf("settings %d %v", code, out)
	}
}
