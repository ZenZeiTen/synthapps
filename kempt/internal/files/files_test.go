package files

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func put(t *testing.T, p string, data []byte, age time.Duration) {
	t.Helper()
	os.MkdirAll(filepath.Dir(p), 0o755)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	mt := time.Now().Add(-age)
	os.Chtimes(p, mt, mt)
}

func filled(n int, b byte) []byte {
	d := make([]byte, n)
	for i := range d {
		d[i] = b
	}
	return d
}

func TestLargest(t *testing.T) {
	root := t.TempDir()
	put(t, filepath.Join(root, "a.bin"), filled(300, 1), 0)
	put(t, filepath.Join(root, "sub", "b.bin"), filled(500, 1), 0)
	put(t, filepath.Join(root, "small.txt"), filled(10, 1), 0)
	put(t, filepath.Join(root, "AppData", "huge.bin"), filled(9000, 1), 0)
	got, _, err := Largest(context.Background(), root, 100, 10, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Size != 500 || got[1].Size != 300 {
		t.Fatalf("got %+v (AppData must be skipped)", got)
	}
	if _, _, err := Largest(context.Background(), "relative", 1, 1, nil); err == nil {
		t.Fatal("relative root accepted")
	}
}

func TestDuplicates(t *testing.T) {
	root := t.TempDir()
	big := filled(3*sample+5, 7)
	bigDiffEnd := append(filled(3*sample, 7), 1, 2, 3, 4, 5)
	bigDiffMiddle := filled(3*sample+5, 7)
	bigDiffMiddle[sample+100] = 9 // same first and last 64 KB, different middle

	put(t, filepath.Join(root, "orig.dat"), big, 48*time.Hour)
	put(t, filepath.Join(root, "copy", "orig (1).dat"), big, time.Hour)
	put(t, filepath.Join(root, "end.dat"), bigDiffEnd, 0)
	put(t, filepath.Join(root, "middle.dat"), bigDiffMiddle, 0)
	put(t, filepath.Join(root, "s1.txt"), []byte("hello world"), 2*time.Hour)
	put(t, filepath.Join(root, "s2.txt"), []byte("hello world"), time.Hour)
	put(t, filepath.Join(root, "s3.txt"), []byte("hello WORLD"), 0)

	groups, _, err := Duplicates(context.Background(), root, 1, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 2 {
		for _, g := range groups {
			t.Logf("group %d: %v", g.Size, g.Files)
		}
		t.Fatalf("want 2 groups, got %d", len(groups))
	}
	g := groups[0]
	if len(g.Files) != 2 || filepath.Base(g.Files[0].Path) != "orig.dat" || g.Wasted != int64(len(big)) {
		t.Fatalf("big group %+v", g)
	}
	if s := groups[1]; len(s.Files) != 2 || filepath.Base(s.Files[0].Path) != "s1.txt" {
		t.Fatalf("small group %+v", s)
	}
	if groups2, _, _ := Duplicates(context.Background(), root, 1000, nil); len(groups2) != 1 {
		t.Fatalf("min size not applied: %d groups", len(groups2))
	}
}
