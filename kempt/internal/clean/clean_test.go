package clean

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func file(t *testing.T, p string, n int, age time.Duration) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, make([]byte, n), 0o644); err != nil {
		t.Fatal(err)
	}
	mt := time.Now().Add(-age)
	os.Chtimes(p, mt, mt)
}

func winEngine(t *testing.T, elevated bool) (*Engine, string) {
	home := t.TempDir()
	local := filepath.Join(home, "AppData", "Local")
	vars := map[string]string{
		"LOCALAPPDATA": local, "TEMP": filepath.Join(local, "Temp"),
		"SystemRoot": filepath.Join(home, "Win"), "ProgramData": filepath.Join(home, "PD"),
		"APPDATA": filepath.Join(home, "AppData", "Roaming"),
	}
	var binEmptied bool
	e := &Engine{
		Env:      Env{GOOS: "windows", Home: home, Getenv: func(k string) string { return vars[k] }},
		Elevated: elevated, Now: time.Now,
		BinSize: func() (int64, int64, error) {
			if binEmptied {
				return 0, 0, nil
			}
			return 500, 2, nil
		},
		EmptyBin: func() error { binEmptied = true; return nil },
	}
	return e, local
}

func find(ss []Scan, id string) Scan {
	for _, s := range ss {
		if s.ID == id {
			return s
		}
	}
	return Scan{}
}

func TestScanAndCleanRespectAge(t *testing.T) {
	e, local := winEngine(t, false)
	tmp := filepath.Join(local, "Temp")
	file(t, filepath.Join(tmp, "old.tmp"), 100, 3*day)
	file(t, filepath.Join(tmp, "deep", "old2.tmp"), 50, 10*day)
	file(t, filepath.Join(tmp, "new.tmp"), 1000, time.Hour)

	ss := e.ScanAll(context.Background(), nil)
	s := find(ss, "user-temp")
	if s.Status != "ready" || s.Files != 2 || s.Bytes != 150 {
		t.Fatalf("scan %+v", s)
	}
	if s.Largest[0].Size != 100 {
		t.Fatalf("largest %+v", s.Largest)
	}
	if find(ss, "windows-temp").Status != "admin" {
		t.Fatal("windows temp must need admin")
	}
	if find(ss, "chrome").Status != "missing" {
		t.Fatal("chrome is not installed here")
	}
	if b := find(ss, "recycle-bin"); b.Bytes != 500 || b.Status != "ready" {
		t.Fatalf("bin %+v", b)
	}

	rs, err := e.Clean(context.Background(), []string{"user-temp", "windows-temp"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rs[0].Freed != 150 || rs[0].Removed != 2 || rs[0].Status != "done" {
		t.Fatalf("clean %+v", rs[0])
	}
	if rs[1].Status != "admin" || rs[1].Removed != 0 {
		t.Fatalf("admin category was cleaned: %+v", rs[1])
	}
	if _, err := os.Stat(filepath.Join(tmp, "new.tmp")); err != nil {
		t.Fatal("recent file removed")
	}
	if _, err := os.Stat(filepath.Join(tmp, "deep")); !os.IsNotExist(err) {
		t.Fatal("empty folder left behind")
	}
	if _, err := os.Stat(tmp); err != nil {
		t.Fatal("the Temp folder itself was removed")
	}
	if _, err := e.Clean(context.Background(), []string{"nope"}, nil); err == nil {
		t.Fatal("unknown category accepted")
	}
}

func TestMatchAndBrowserProfiles(t *testing.T) {
	e, local := winEngine(t, false)
	exp := filepath.Join(local, "Microsoft", "Windows", "Explorer")
	file(t, filepath.Join(exp, "thumbcache_256.db"), 70, 0)
	file(t, filepath.Join(exp, "ExplorerStartupLog.etl"), 999, 0)
	ud := filepath.Join(local, "Google", "Chrome", "User Data")
	file(t, filepath.Join(ud, "Default", "Cache", "Cache_Data", "f_000001"), 10, 0)
	file(t, filepath.Join(ud, "Profile 2", "Code Cache", "js", "abc"), 20, 0)
	file(t, filepath.Join(ud, "Default", "Cookies"), 5000, 0)
	ss := e.ScanAll(context.Background(), nil)
	if th := find(ss, "thumbnails"); th.Files != 1 || th.Bytes != 70 {
		t.Fatalf("thumbnails %+v", th)
	}
	if c := find(ss, "chrome"); c.Files != 2 || c.Bytes != 30 {
		t.Fatalf("chrome %+v (cookies must never count)", c)
	}
	e.Clean(context.Background(), []string{"chrome", "recycle-bin"}, nil)
	if _, err := os.Stat(filepath.Join(ud, "Default", "Cookies")); err != nil {
		t.Fatal("cookies were deleted")
	}
	if b := find(e.ScanAll(context.Background(), nil), "recycle-bin"); b.Status != "empty" {
		t.Fatalf("bin after emptying %+v", b)
	}
}

func TestUnsafeRootsAreIgnored(t *testing.T) {
	e, _ := winEngine(t, true)
	c := Category{ID: "bad", Roots: []string{e.Env.Home, "relative"}, Kind: "files"}
	if r := e.roots(c); len(r) != 0 {
		t.Fatalf("unsafe roots accepted: %v", r)
	}
}

func TestCatalogExplainsEveryCategory(t *testing.T) {
	for _, goos := range []string{"windows", "linux"} {
		e, _ := winEngine(t, false)
		e.Env.GOOS = goos
		ids := map[string]bool{}
		for _, c := range e.Catalog() {
			if c.What == "" || c.Safe == "" || c.Name == "" {
				t.Errorf("%s/%s lacks an explanation", goos, c.ID)
			}
			if ids[c.ID] {
				t.Errorf("%s: duplicate id %s", goos, c.ID)
			}
			ids[c.ID] = true
			if c.Kind == "bin" && c.Default {
				t.Errorf("%s: the bin must never be emptied automatically", goos)
			}
		}
	}
}
