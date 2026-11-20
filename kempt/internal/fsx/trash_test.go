//go:build !windows

package fsx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRecycleToTrash(t *testing.T) {
	trash := t.TempDir()
	old := TrashDir
	TrashDir = func() string { return trash }
	defer func() { TrashDir = old }()
	dir := t.TempDir()
	for i := 0; i < 2; i++ {
		p := filepath.Join(dir, "same name.txt")
		write(t, p, 5)
		if err := Recycle(p); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatal("file still there")
		}
	}
	b, n, err := RecycleBinSize()
	if err != nil || b != 10 || n != 2 {
		t.Fatalf("trash size %d bytes %d items %v", b, n, err)
	}
	info, _ := os.ReadFile(filepath.Join(trash, "info", "same name.txt.trashinfo"))
	if want := "Path=" + filepath.ToSlash(dir) + "/same%20name.txt"; !strings.Contains(string(info), want) {
		t.Fatalf("trashinfo %q lacks %q", info, want)
	}
	if Recycle("relative.txt") == nil {
		t.Fatal("relative path accepted")
	}
	if err := EmptyRecycleBin(); err != nil {
		t.Fatal(err)
	}
	if b, n, _ := RecycleBinSize(); b != 0 || n != 0 {
		t.Fatal("trash not empty")
	}
}
