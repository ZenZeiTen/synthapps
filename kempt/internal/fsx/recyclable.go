package fsx

import (
	"errors"
	"os"
	"path/filepath"
)

func checkRecyclable(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("not a full path")
	}
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !fi.Mode().IsRegular() {
		return errors.New("not a regular file")
	}
	return nil
}
