//go:build !windows

package clean

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// inUse reports whether a browser is running. Chromium's SingletonLock and
// Firefox's lock are links whose target ends in the process id
// ("host-1234", "127.0.1.1:+1234"); a lock left behind by a crash names a
// process that no longer exists and does not count.
func inUse(locks []string) bool {
	for _, pat := range locks {
		matches, _ := filepath.Glob(pat)
		for _, m := range matches {
			target, err := os.Readlink(m)
			if err != nil {
				if _, serr := os.Lstat(m); serr == nil {
					return true // exists but is not a link: assume running
				}
				continue
			}
			if pid := lockPID(target); pid <= 0 || alive(pid) {
				return true
			}
		}
	}
	return false
}

func lockPID(target string) int {
	i := strings.LastIndexAny(target, "-+")
	if i < 0 {
		return 0
	}
	n, err := strconv.Atoi(target[i+1:])
	if err != nil {
		return 0
	}
	return n
}

func alive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
