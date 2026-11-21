// Package fsx holds the file-system rules every Kempt feature follows:
// walk without following links, junctions or cloud placeholders; refuse to
// work on folders that are too broad; delete only regular files; and send
// a person's own files to the Recycle Bin rather than deleting them.
package fsx

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Entry is one regular file.
type Entry struct {
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"modified"`
}

// ErrUnsafeRoot means a folder is too broad to clean or scan.
var ErrUnsafeRoot = errors.New("folder is too broad to work on")

// CheckRoot refuses folders whose contents Kempt must never delete as a
// whole: a drive root, a top-level folder such as C:\Users or /home, a home
// folder itself, or a relative path.
func CheckRoot(root, home string) error {
	if !filepath.IsAbs(root) {
		return ErrUnsafeRoot
	}
	c := filepath.Clean(root)
	if home != "" && samePath(c, filepath.Clean(home)) {
		return ErrUnsafeRoot
	}
	if depth(c) < 2 {
		return ErrUnsafeRoot
	}
	return nil
}

// depth counts path components below the volume: C:\ is 0, C:\Users is 1.
func depth(p string) int {
	rest := strings.TrimPrefix(p, filepath.VolumeName(p))
	n := 0
	for _, s := range strings.Split(filepath.ToSlash(rest), "/") {
		if s != "" {
			n++
		}
	}
	return n
}

func samePath(a, b string) bool {
	if runtime.GOOS == "windows" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

// Within reports whether p is root or inside it.
func Within(p, root string) bool {
	rel, err := filepath.Rel(root, p)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" && !strings.EqualFold(filepath.VolumeName(p), filepath.VolumeName(root)) {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// Plain reports whether a directory entry is a regular file or a real
// directory. Links, Windows junctions and other reparse points (OneDrive
// placeholders among them) are not: Kempt never follows or deletes them.
func Plain(d fs.DirEntry) bool {
	t := d.Type()
	return t.IsRegular() || t == fs.ModeDir
}

// WalkFiles calls fn for every regular file under root. It skips links,
// junctions and directories for which skipDir returns true. Errors on single
// entries are counted, not returned. It stops when ctx is done.
func WalkFiles(ctx context.Context, root string, skipDir func(path, name string) bool, fn func(e Entry) error) (unreadable int, err error) {
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, werr error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if werr != nil {
			unreadable++
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if !Plain(d) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if p != root && skipDir != nil && skipDir(p, d.Name()) {
				return fs.SkipDir
			}
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			unreadable++
			return nil
		}
		return fn(Entry{Path: p, Size: info.Size(), ModTime: info.ModTime()})
	})
	if errors.Is(err, fs.ErrNotExist) {
		err = nil
	}
	return unreadable, err
}

// RemoveFile deletes path only if it is still a regular file.
func RemoveFile(path string) error {
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() {
		return errors.New("not a regular file")
	}
	return os.Remove(path)
}

// RemoveEmptyDirs removes empty directories below root (never root itself),
// deepest first. Links and junctions are left alone.
func RemoveEmptyDirs(root string) {
	var dirs []string
	filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() && !Plain(d) {
			return fs.SkipDir
		}
		if d.IsDir() && p != root {
			dirs = append(dirs, p)
		}
		return nil
	})
	for i := len(dirs) - 1; i >= 0; i-- {
		os.Remove(dirs[i]) // fails, harmlessly, if the folder is not empty
	}
}
