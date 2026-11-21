package clean

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/fsx"
)

// Scan is what one category holds right now.
type Scan struct {
	ID    string `json:"id"`
	Bytes int64  `json:"bytes"`
	Files int    `json:"files"`
	// Status: "ready", "empty", "in-use" (close App first), "admin"
	// (needs administrator), "missing" (program not installed).
	Status string `json:"status"`
	// Largest files, so a person can see what would go.
	Largest []fsx.Entry `json:"largest,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// Result is what cleaning one category did.
type Result struct {
	ID      string   `json:"id"`
	Freed   int64    `json:"freed"`
	Removed int      `json:"removed"`
	Skipped int      `json:"skipped"` // in use, changed meanwhile, or no permission
	Status  string   `json:"status"`
	Errors  []string `json:"errors,omitempty"`
}

// Progress is shared with a job so the window can show it.
type Progress struct {
	Files atomic.Int64
	Bytes atomic.Int64
	Now   atomic.Value // string: the category being worked on
}

// Engine scans and cleans. Its fields are replaced in tests.
type Engine struct {
	Env      Env
	Elevated bool
	Now      func() time.Time
	// The Recycle Bin, so tests need not touch the real one.
	BinSize  func() (int64, int64, error)
	EmptyBin func() error
}

// NewEngine uses the real system.
func NewEngine(elevated bool) *Engine {
	return &Engine{Env: SystemEnv(), Elevated: elevated, Now: time.Now,
		BinSize: fsx.RecycleBinSize, EmptyBin: fsx.EmptyRecycleBin}
}

// Catalog lists the categories for this system, in English.
func (e *Engine) Catalog() []Category { return Catalog(e.Env) }

// CatalogIn lists the categories with their text in a language.
func (e *Engine) CatalogIn(lang string) []Category { return CatalogIn(e.Env, lang) }

// Find returns the category with this id.
func (e *Engine) Find(id string) (Category, bool) {
	for _, c := range e.Catalog() {
		if c.ID == id {
			return c, true
		}
	}
	return Category{}, false
}

// roots expands the category's patterns into folders that exist and are
// safe to clean.
func (e *Engine) roots(c Category) []string {
	var out []string
	seen := map[string]bool{}
	for _, pat := range c.Roots {
		matches, _ := filepath.Glob(pat)
		for _, m := range matches {
			fi, err := os.Lstat(m)
			if err != nil || !fi.IsDir() || fi.Mode()&os.ModeSymlink != 0 {
				continue
			}
			if fsx.CheckRoot(m, e.Env.Home) != nil || seen[m] {
				continue
			}
			seen[m] = true
			out = append(out, m)
		}
	}
	return out
}

func (e *Engine) eligible(c Category, ent fsx.Entry, now time.Time) bool {
	if c.MinAge > 0 && now.Sub(ent.ModTime) < c.MinAge {
		return false
	}
	if len(c.Match) == 0 {
		return true
	}
	base := strings.ToLower(filepath.Base(ent.Path))
	for _, m := range c.Match {
		if ok, _ := filepath.Match(strings.ToLower(m), base); ok {
			return true
		}
	}
	return false
}

// status says whether a category can be cleaned now.
func (e *Engine) status(c Category, roots []string) string {
	if c.Admin && !e.Elevated {
		return "admin"
	}
	if len(roots) == 0 {
		return "missing"
	}
	if inUse(c.Locks) {
		return "in-use"
	}
	return "ready"
}

// ScanOne measures one category.
func (e *Engine) ScanOne(ctx context.Context, c Category, p *Progress) Scan {
	s := Scan{ID: c.ID}
	if p != nil {
		p.Now.Store(c.Name)
	}
	if c.Kind == "bin" {
		b, n, err := e.BinSize()
		s.Bytes, s.Files = b, int(n)
		s.Status = "ready"
		if err != nil {
			s.Error = err.Error()
		}
		if s.Bytes == 0 && s.Files == 0 {
			s.Status = "empty"
		}
		return s
	}
	roots := e.roots(c)
	s.Status = e.status(c, roots)
	if s.Status == "missing" {
		return s
	}
	now := e.Now()
	var top []fsx.Entry
	for _, r := range roots {
		_, err := fsx.WalkFiles(ctx, r, nil, func(ent fsx.Entry) error {
			if !e.eligible(c, ent, now) {
				return nil
			}
			s.Bytes += ent.Size
			s.Files++
			if p != nil {
				p.Files.Add(1)
				p.Bytes.Add(ent.Size)
			}
			top = keepLargest(top, ent, 8)
			return nil
		})
		if err != nil && ctx.Err() == nil && s.Error == "" {
			s.Error = err.Error()
		}
	}
	s.Largest = top
	if s.Files == 0 && s.Status == "ready" {
		s.Status = "empty"
	}
	return s
}

// ScanAll measures every category.
func (e *Engine) ScanAll(ctx context.Context, p *Progress) []Scan {
	var out []Scan
	for _, c := range e.Catalog() {
		if ctx.Err() != nil {
			break
		}
		out = append(out, e.ScanOne(ctx, c, p))
	}
	return out
}

// CleanOne removes the eligible files of one category. A category that is
// in use or needs administrator rights is left alone and says so.
func (e *Engine) CleanOne(ctx context.Context, c Category, p *Progress) Result {
	r := Result{ID: c.ID}
	if p != nil {
		p.Now.Store(c.Name)
	}
	if c.Kind == "bin" {
		b, n, _ := e.BinSize()
		if err := e.EmptyBin(); err != nil {
			r.Status, r.Errors = "failed", []string{err.Error()}
			return r
		}
		r.Freed, r.Removed, r.Status = b, int(n), "done"
		return r
	}
	roots := e.roots(c)
	r.Status = e.status(c, roots)
	if r.Status != "ready" {
		return r
	}
	now := e.Now()
	for _, root := range roots {
		_, err := fsx.WalkFiles(ctx, root, nil, func(ent fsx.Entry) error {
			if !e.eligible(c, ent, now) {
				return nil
			}
			// A second look right before deleting: still a file, still old.
			if fi, err := os.Lstat(ent.Path); err != nil || !fi.Mode().IsRegular() ||
				(c.MinAge > 0 && now.Sub(fi.ModTime()) < c.MinAge) {
				r.Skipped++
				return nil
			}
			if err := fsx.RemoveFile(ent.Path); err != nil {
				r.Skipped++
				if len(r.Errors) < 3 && !os.IsPermission(err) {
					r.Errors = append(r.Errors, err.Error())
				}
				return nil
			}
			r.Freed += ent.Size
			r.Removed++
			if p != nil {
				p.Files.Add(1)
				p.Bytes.Add(ent.Size)
			}
			return nil
		})
		if ctx.Err() == nil && err != nil && len(r.Errors) < 3 {
			r.Errors = append(r.Errors, err.Error())
		}
		fsx.RemoveEmptyDirs(root)
	}
	r.Status = "done"
	if ctx.Err() != nil {
		r.Status = "stopped"
	}
	return r
}

// Clean cleans the categories with these ids, in catalog order.
func (e *Engine) Clean(ctx context.Context, ids []string, p *Progress) ([]Result, error) {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	var out []Result
	for _, c := range e.Catalog() {
		if !want[c.ID] {
			continue
		}
		delete(want, c.ID)
		if ctx.Err() != nil {
			break
		}
		out = append(out, e.CleanOne(ctx, c, p))
	}
	for id := range want {
		return out, fmt.Errorf("unknown category %q", id)
	}
	return out, nil
}

// DefaultIDs are the categories one-click and automatic care include.
func (e *Engine) DefaultIDs() []string {
	var ids []string
	for _, c := range e.Catalog() {
		if c.Default {
			ids = append(ids, c.ID)
		}
	}
	return ids
}

func keepLargest(top []fsx.Entry, e fsx.Entry, n int) []fsx.Entry {
	if len(top) < n {
		top = append(top, e)
	} else if e.Size > top[len(top)-1].Size {
		top[len(top)-1] = e
	} else {
		return top
	}
	sort.Slice(top, func(i, j int) bool { return top[i].Size > top[j].Size })
	return top
}
