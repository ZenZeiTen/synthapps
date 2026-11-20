//go:build !windows

package sysinfo

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// Drives lists the root file system and the home folder's, if different.
func Drives() []Drive {
	var out []Drive
	seen := map[uint64]bool{}
	home, _ := os.UserHomeDir()
	for _, p := range []string{"/", home} {
		if p == "" {
			continue
		}
		var s syscall.Statfs_t
		if syscall.Statfs(p, &s) != nil {
			continue
		}
		var st syscall.Stat_t
		if syscall.Stat(p, &st) == nil {
			if seen[uint64(st.Dev)] {
				continue
			}
			seen[uint64(st.Dev)] = true
		}
		bs := int64(s.Bsize)
		out = append(out, Drive{Path: p, Total: int64(s.Blocks) * bs, Free: int64(s.Bavail) * bs})
	}
	return out
}

// Uptime is the time since the computer started.
func Uptime() time.Duration {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	f := strings.Fields(string(b))
	if len(f) == 0 {
		return 0
	}
	s, _ := strconv.ParseFloat(f[0], 64)
	return time.Duration(s * float64(time.Second))
}

// Mem reads physical memory from /proc/meminfo.
func Mem() Memory {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return Memory{}
	}
	defer f.Close()
	var m Memory
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		fs := strings.Fields(sc.Text())
		if len(fs) < 2 {
			continue
		}
		kb, _ := strconv.ParseInt(fs[1], 10, 64)
		switch fs[0] {
		case "MemTotal:":
			m.Total = kb * 1024
		case "MemAvailable:":
			m.Available = kb * 1024
		}
	}
	return m
}

// Elevated reports whether Kempt runs as root.
func Elevated() bool { return os.Geteuid() == 0 }
