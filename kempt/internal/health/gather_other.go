//go:build !windows

package health

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// gather reads memory use per program from /proc (Linux).
func gather(ctx context.Context, f *Facts) {
	dirs, _ := filepath.Glob("/proc/[0-9]*/status")
	by := map[string]*Proc{}
	for _, p := range dirs {
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		var name string
		var rss int64
		for _, line := range strings.Split(string(b), "\n") {
			if v, ok := strings.CutPrefix(line, "Name:"); ok {
				name = strings.TrimSpace(v)
			} else if v, ok := strings.CutPrefix(line, "VmRSS:"); ok {
				fs := strings.Fields(v)
				if len(fs) > 0 {
					kb, _ := strconv.ParseInt(fs[0], 10, 64)
					rss = kb * 1024
				}
			}
		}
		if name == "" || rss == 0 {
			continue
		}
		if by[name] == nil {
			by[name] = &Proc{Name: name}
		}
		by[name].Mem += rss
		by[name].Count++
	}
	for _, p := range by {
		f.Procs = append(f.Procs, *p)
	}
	sort.Slice(f.Procs, func(i, j int) bool { return f.Procs[i].Mem > f.Procs[j].Mem })
	if len(f.Procs) > 8 {
		f.Procs = f.Procs[:8]
	}
}
