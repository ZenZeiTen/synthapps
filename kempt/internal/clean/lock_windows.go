//go:build windows

package clean

import (
	"os"
	"path/filepath"
)

// inUse reports whether a program holds one of its lock files open. Chromium
// and Firefox keep these open, without sharing, for as long as they run.
func inUse(locks []string) bool {
	for _, pat := range locks {
		matches, _ := filepath.Glob(pat)
		for _, m := range matches {
			f, err := os.OpenFile(m, os.O_RDWR, 0)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return true
			}
			f.Close()
		}
	}
	return false
}
