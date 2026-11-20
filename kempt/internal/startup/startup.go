// Package startup lists the programs that start when you sign in and turns
// them on or off with the same switch Windows Task Manager uses (the
// StartupApproved registry values), so a change can always be reversed and
// Task Manager shows the same state. On Linux it uses XDG autostart files.
package startup

import (
	"context"
	"errors"
	"strings"
)

// Item is one program that starts when you sign in.
type Item struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Command   string `json:"command"`
	Path      string `json:"path,omitempty"` // the program the command runs
	Source    string `json:"source"`         // see SourceLabel
	Where     string `json:"where"`          // plain-language location
	Enabled   bool   `json:"enabled"`
	Admin     bool   `json:"admin"` // changing it needs administrator rights
	Publisher string `json:"publisher,omitempty"`
	Missing   bool   `json:"missing,omitempty"` // the program file does not exist
}

// Manager lists and switches startup items.
type Manager interface {
	List(ctx context.Context) ([]Item, error)
	Set(ctx context.Context, id string, enabled bool) (Item, error)
}

// ErrNeedsAdmin means the item belongs to all users of the computer.
var ErrNeedsAdmin = errors.New("this program starts for every user of this computer; restart Kempt as administrator to change it")

// ErrNotFound means no item has that id.
var ErrNotFound = errors.New("that startup item no longer exists")

// SourceLabel describes where an item is registered.
func SourceLabel(source string) string {
	switch source {
	case "run-user":
		return "Registry, your account"
	case "run-machine", "run-machine32":
		return "Registry, all users"
	case "folder-user":
		return "Startup folder, your account"
	case "folder-machine":
		return "Startup folder, all users"
	case "autostart-user":
		return "Autostart, your account"
	case "autostart-system":
		return "Autostart, all users"
	}
	return source
}

// ExePath extracts the program from a command line:
// "C:\Program Files\X\x.exe" --tray, C:\Tools\x.exe /min, %ProgramFiles%\y.exe.
func ExePath(cmd string, getenv func(string) string) string {
	cmd = strings.TrimSpace(expandPercent(cmd, getenv))
	if cmd == "" {
		return ""
	}
	if cmd[0] == '"' {
		if i := strings.IndexByte(cmd[1:], '"'); i >= 0 {
			return cmd[1 : i+1]
		}
		return strings.Trim(cmd, `"`)
	}
	low := strings.ToLower(cmd)
	for _, ext := range []string{".exe", ".com", ".bat", ".cmd", ".lnk"} {
		for start := 0; ; {
			i := strings.Index(low[start:], ext)
			if i < 0 {
				break
			}
			end := start + i + len(ext)
			if end == len(cmd) || cmd[end] == ' ' || cmd[end] == '\t' {
				return cmd[:end]
			}
			start = end
		}
	}
	if i := strings.IndexAny(cmd, " \t"); i > 0 {
		return cmd[:i]
	}
	return cmd
}

// expandPercent replaces %NAME% with the variable's value.
func expandPercent(s string, getenv func(string) string) string {
	var b strings.Builder
	for {
		i := strings.IndexByte(s, '%')
		if i < 0 {
			b.WriteString(s)
			return b.String()
		}
		j := strings.IndexByte(s[i+1:], '%')
		if j < 0 {
			b.WriteString(s)
			return b.String()
		}
		name := s[i+1 : i+1+j]
		if v := getenv(name); v != "" && name != "" {
			b.WriteString(s[:i])
			b.WriteString(v)
		} else {
			b.WriteString(s[:i+2+j])
		}
		s = s[i+2+j:]
	}
}

// ApprovedEnabled decodes a StartupApproved value. Task Manager writes 02
// (or 06) followed by zeros for "enabled" and 03 (or 07) followed by the time
// it was disabled for "disabled": the lowest bit of the first byte is the
// switch. A missing value means enabled.
func ApprovedEnabled(v []byte) bool {
	return len(v) == 0 || v[0]&1 == 0
}

// ApprovedValue encodes the value Task Manager would write. filetime is the
// time in Windows FILETIME units (100 ns since 1601), used when disabling.
func ApprovedValue(enabled bool, filetime uint64) []byte {
	b := make([]byte, 12)
	if enabled {
		b[0] = 2
		return b
	}
	b[0] = 3
	for i := 0; i < 8; i++ {
		b[4+i] = byte(filetime >> (8 * i))
	}
	return b
}
