// Package files finds your largest files and exact duplicates, so you can
// decide what to move to the Recycle Bin. It never deletes anything itself.
package files

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/ZenZeiTen/synthapps/kempt/internal/fsx"
)

// Progress is shared with a job so the window can show it.
type Progress struct {
	Files atomic.Int64
	Bytes atomic.Int64
	Now   atomic.Value // string
}

// skipNames are folders that hold programs, caches or system data, not the
// files a person keeps. They are left out of searches.
var skipNames = map[string]bool{
	"appdata": true, "$recycle.bin": true, "system volume information": true,
	"windows": true, "program files": true, "program files (x86)": true, "programdata": true,
	"node_modules": true, ".git": true, ".cache": true, ".local": true, ".trash": true,
	"onedrivetemp": true, "winsxs": true,
}

// SkipDir reports whether a search leaves this folder out.
func SkipDir(path, name string) bool {
	n := strings.ToLower(name)
	if skipNames[n] {
		return true
	}
	// Hidden folders on Linux and macOS (.config, .mozilla, ...).
	return runtime.GOOS != "windows" && strings.HasPrefix(n, ".")
}

// CheckSearchRoot accepts a folder to search: it must exist and be a real
// folder. Searching is read-only, so a drive root is allowed.
func CheckSearchRoot(root string) error {
	if !filepath.IsAbs(root) {
		return errors.New("give a full folder path")
	}
	fi, err := os.Stat(root)
	if err != nil {
		return errors.New("that folder does not exist")
	}
	if !fi.IsDir() {
		return errors.New("that is a file, not a folder")
	}
	return nil
}

// Largest returns up to limit files of at least minSize bytes, largest first.
func Largest(ctx context.Context, root string, minSize int64, limit int, p *Progress) ([]fsx.Entry, int, error) {
	if err := CheckSearchRoot(root); err != nil {
		return nil, 0, err
	}
	var top []fsx.Entry
	unread, err := fsx.WalkFiles(ctx, root, SkipDir, func(e fsx.Entry) error {
		if p != nil {
			p.Files.Add(1)
			p.Bytes.Add(e.Size)
			p.Now.Store(filepath.Dir(e.Path))
		}
		if e.Size < minSize {
			return nil
		}
		top = append(top, e)
		if len(top) > 4*limit {
			sort.Slice(top, func(i, j int) bool { return top[i].Size > top[j].Size })
			top = top[:limit]
		}
		return nil
	})
	sort.Slice(top, func(i, j int) bool { return top[i].Size > top[j].Size })
	if len(top) > limit {
		top = top[:limit]
	}
	return top, unread, err
}

// Group is a set of files with identical contents.
type Group struct {
	Size  int64       `json:"size"`
	Hash  string      `json:"hash"`
	Files []fsx.Entry `json:"files"` // oldest first: the likely original
	// Wasted is the space the extra copies take.
	Wasted int64 `json:"wasted"`
}

const sample = 64 << 10

// Duplicates finds files of at least minSize bytes with identical contents.
// It compares sizes first, then the first and last 64 KB, and only then the
// whole file, so most files are read only a little.
func Duplicates(ctx context.Context, root string, minSize int64, p *Progress) ([]Group, int, error) {
	if err := CheckSearchRoot(root); err != nil {
		return nil, 0, err
	}
	if minSize < 1 {
		minSize = 1
	}
	bySize := map[int64][]fsx.Entry{}
	unread, err := fsx.WalkFiles(ctx, root, SkipDir, func(e fsx.Entry) error {
		if p != nil {
			p.Files.Add(1)
			p.Now.Store(filepath.Dir(e.Path))
		}
		if e.Size >= minSize {
			bySize[e.Size] = append(bySize[e.Size], e)
		}
		return nil
	})
	if err != nil {
		return nil, unread, err
	}
	var groups []Group
	for size, list := range bySize {
		if len(list) < 2 {
			continue
		}
		for _, quick := range splitBy(ctx, list, func(e fsx.Entry) (string, error) { return quickHash(e.Path, size) }) {
			if len(quick) < 2 {
				continue
			}
			if size > 2*sample {
				// The sample covered only part of the file: compare everything.
				parts := splitBy(ctx, quick, func(e fsx.Entry) (string, error) {
					if p != nil {
						p.Bytes.Add(e.Size)
					}
					return fullHash(e.Path)
				})
				for k, part := range parts {
					if len(part) > 1 {
						groups = append(groups, makeGroup(size, k, part))
					}
				}
				continue
			}
			// The sample was the whole file.
			k, _ := quickHash(quick[0].Path, size)
			groups = append(groups, makeGroup(size, k, quick))
		}
		if ctx.Err() != nil {
			return nil, unread, ctx.Err()
		}
	}
	sort.Slice(groups, func(i, j int) bool {
		if groups[i].Wasted != groups[j].Wasted {
			return groups[i].Wasted > groups[j].Wasted
		}
		return groups[i].Files[0].Path < groups[j].Files[0].Path
	})
	return groups, unread, nil
}

func makeGroup(size int64, key string, list []fsx.Entry) Group {
	sort.Slice(list, func(i, j int) bool {
		if !list[i].ModTime.Equal(list[j].ModTime) {
			return list[i].ModTime.Before(list[j].ModTime)
		}
		return list[i].Path < list[j].Path
	})
	return Group{Size: size, Hash: HexHash(key), Files: list, Wasted: size * int64(len(list)-1)}
}

func splitBy(ctx context.Context, list []fsx.Entry, key func(fsx.Entry) (string, error)) map[string][]fsx.Entry {
	out := map[string][]fsx.Entry{}
	for _, e := range list {
		if ctx.Err() != nil {
			break
		}
		k, err := key(e)
		if err != nil {
			continue // unreadable or changed: leave it out
		}
		out[k] = append(out[k], e)
	}
	return out
}

func quickHash(path string, size int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.CopyN(h, f, min(size, sample)); err != nil {
		return "", err
	}
	if size > 2*sample {
		if _, err := f.Seek(-sample, io.SeekEnd); err != nil {
			return "", err
		}
		if _, err := io.CopyN(h, f, sample); err != nil {
			return "", err
		}
	} else if size > sample {
		if _, err := io.Copy(h, f); err != nil {
			return "", err
		}
	}
	return string(h.Sum(nil)), nil
}

func fullHash(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return string(h.Sum(nil)), nil
}

// HexHash shows a group's hash in short form.
func HexHash(k string) string {
	const digits = "0123456789abcdef"
	var b bytes.Buffer
	for i := 0; i < len(k) && i < 6; i++ {
		b.WriteByte(digits[k[i]>>4])
		b.WriteByte(digits[k[i]&15])
	}
	return b.String()
}
