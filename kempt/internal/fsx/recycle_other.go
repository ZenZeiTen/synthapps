//go:build !windows

package fsx

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// TrashDir is the freedesktop.org trash in the home folder. Tests change it.
var TrashDir = func() string {
	if d := os.Getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, "Trash")
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".local", "share", "Trash")
}

// Recycle moves one file to the desktop trash, following the freedesktop.org
// Trash specification, so the file manager can restore it.
func Recycle(path string) error {
	if err := checkRecyclable(path); err != nil {
		return err
	}
	trash := TrashDir()
	files, info := filepath.Join(trash, "files"), filepath.Join(trash, "info")
	if err := os.MkdirAll(files, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(info, 0o700); err != nil {
		return err
	}
	base := filepath.Base(path)
	name := base
	for i := 2; ; i++ {
		f, err := os.OpenFile(filepath.Join(info, name+".trashinfo"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			esc := (&url.URL{Path: path}).EscapedPath()
			fmt.Fprintf(f, "[Trash Info]\nPath=%s\nDeletionDate=%s\n", esc, time.Now().Format("2006-01-02T15:04:05"))
			f.Close()
			break
		}
		if !os.IsExist(err) {
			return err
		}
		ext := filepath.Ext(base)
		name = strings.TrimSuffix(base, ext) + "." + strconv.Itoa(i) + ext
	}
	if err := os.Rename(path, filepath.Join(files, name)); err != nil {
		os.Remove(filepath.Join(info, name+".trashinfo"))
		return fmt.Errorf("could not move it to the trash: %w", err)
	}
	return nil
}

// RecycleBinSize returns the bytes and items in the trash.
func RecycleBinSize() (bytes int64, items int64, err error) {
	ents, err := os.ReadDir(filepath.Join(TrashDir(), "files"))
	if os.IsNotExist(err) {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	for _, e := range ents {
		items++
		filepath.WalkDir(filepath.Join(TrashDir(), "files", e.Name()), func(p string, d os.DirEntry, err error) error {
			if err == nil && d.Type().IsRegular() {
				if fi, err := d.Info(); err == nil {
					bytes += fi.Size()
				}
			}
			return nil
		})
	}
	return bytes, items, nil
}

// EmptyRecycleBin deletes everything in the trash.
func EmptyRecycleBin() error {
	for _, sub := range []string{"files", "info", "expunged"} {
		d := filepath.Join(TrashDir(), sub)
		ents, err := os.ReadDir(d)
		if err != nil {
			continue
		}
		for _, e := range ents {
			if err := os.RemoveAll(filepath.Join(d, e.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
