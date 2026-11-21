package fsx

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
)

func write(t *testing.T, p string, n int) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, make([]byte, n), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestCheckRoot(t *testing.T) {
	home := t.TempDir()
	if CheckRoot(home, home) == nil {
		t.Error("home itself must be refused")
	}
	if CheckRoot("relative/path", home) == nil {
		t.Error("relative path must be refused")
	}
	top := string(filepath.Separator)
	if runtime.GOOS == "windows" {
		top = `C:\`
	}
	if CheckRoot(top, home) == nil || CheckRoot(filepath.Join(top, "Users"), home) == nil {
		t.Error("drive root and top-level folders must be refused")
	}
	if err := CheckRoot(filepath.Join(home, "cache", "x"), home); err != nil {
		t.Errorf("deep folder refused: %v", err)
	}
}

func TestWithin(t *testing.T) {
	root := filepath.Join(t.TempDir(), "a")
	cases := map[string]bool{
		root:                            true,
		filepath.Join(root, "b", "c"):   true,
		filepath.Join(root, "..", "a2"): false,
		filepath.Join(root+"b", "x"):    false,
		filepath.Dir(root):              false,
	}
	for p, want := range cases {
		if got := Within(p, root); got != want {
			t.Errorf("Within(%q) = %v, want %v", p, got, want)
		}
	}
}

func TestWalkFilesSkipsLinksAndDirs(t *testing.T) {
	root := t.TempDir()
	write(t, filepath.Join(root, "a.txt"), 10)
	write(t, filepath.Join(root, "sub", "b.txt"), 20)
	write(t, filepath.Join(root, "skip", "c.txt"), 30)
	outside := t.TempDir()
	write(t, filepath.Join(outside, "secret.txt"), 40)
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skip("symlinks not available:", err)
	}
	os.Symlink(filepath.Join(outside, "secret.txt"), filepath.Join(root, "filelink"))
	var got []string
	_, err := WalkFiles(context.Background(), root, func(p, name string) bool { return name == "skip" }, func(e Entry) error {
		rel, _ := filepath.Rel(root, e.Path)
		got = append(got, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	if len(got) != 2 || got[0] != "a.txt" || got[1] != "sub/b.txt" {
		t.Fatalf("walked %v", got)
	}
}

func TestRemoveFileRefusesLinks(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "t.txt")
	write(t, target, 1)
	link := filepath.Join(dir, "l")
	if os.Symlink(target, link) != nil {
		t.Skip("no symlinks")
	}
	if RemoveFile(link) == nil {
		t.Fatal("removed a link")
	}
	if RemoveFile(target) != nil {
		t.Fatal("did not remove a file")
	}
}

func TestRemoveEmptyDirsKeepsRootAndFiles(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "e1", "e2"), 0o755)
	write(t, filepath.Join(root, "full", "x"), 1)
	RemoveEmptyDirs(root)
	if _, err := os.Stat(filepath.Join(root, "e1")); !os.IsNotExist(err) {
		t.Error("empty folders remain")
	}
	if _, err := os.Stat(filepath.Join(root, "full", "x")); err != nil {
		t.Error("removed a folder with a file")
	}
	if _, err := os.Stat(root); err != nil {
		t.Error("removed the root")
	}
}
