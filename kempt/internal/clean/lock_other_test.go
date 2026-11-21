//go:build !windows

package clean

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInUseFollowsPID(t *testing.T) {
	dir := t.TempDir()
	lock := filepath.Join(dir, "SingletonLock")
	os.Symlink("myhost-999999999", lock)
	if inUse([]string{lock}) {
		t.Fatal("a stale lock counted as running")
	}
	os.Remove(lock)
	os.Symlink("myhost-"+itoa(os.Getpid()), lock)
	if !inUse([]string{lock}) {
		t.Fatal("a live lock was missed")
	}
	if inUse([]string{filepath.Join(dir, "none")}) {
		t.Fatal("missing lock counted")
	}
	if lockPID("127.0.1.1:+4321") != 4321 {
		t.Fatal("firefox lock format")
	}
}

func itoa(n int) string {
	s := ""
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}
