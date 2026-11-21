// Package apps finds outdated programs and updates them with winget, the
// package manager Microsoft ships with Windows (App Installer). Kempt does
// not keep its own list of software or download installers itself.
package apps

import (
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

// Update is one program with a newer version available.
type Update struct {
	Name      string `json:"name"`
	ID        string `json:"id"`
	Version   string `json:"version"`
	Available string `json:"available"`
	Source    string `json:"source"`
	// Truncated means winget shortened the id, so it cannot be updated by id.
	Truncated bool `json:"truncated,omitempty"`
}

// ErrNoWinget means App Installer is missing.
var ErrNoWinget = errors.New("winget is not installed. Install \"App Installer\" from the Microsoft Store to check for updates")

// Available reports whether winget can be found.
func Available() bool {
	_, err := exec.LookPath("winget")
	return err == nil
}

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}$`)

// ValidID reports whether s looks like a winget package id.
func ValidID(s string) bool { return idPattern.MatchString(s) }

// List asks winget which installed programs have updates.
func List(ctx context.Context) ([]Update, error) {
	if !Available() {
		return nil, ErrNoWinget
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	out, err := shell.Run(ctx, "winget", "upgrade", "--accept-source-agreements", "--disable-interactivity")
	// winget exits non-zero when nothing is found on some versions; trust the table.
	ups := Parse(string(out))
	if err != nil && len(ups) == 0 && !strings.Contains(string(out), "----") {
		return nil, err
	}
	return ups, nil
}

// Upgrade updates one program silently.
func Upgrade(ctx context.Context, id string) (string, error) {
	if !ValidID(id) {
		return "", errors.New("not a package id")
	}
	if !Available() {
		return "", ErrNoWinget
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	out, err := shell.Run(ctx, "winget", "upgrade", "--id", id, "--exact", "--silent",
		"--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity")
	return lastLines(string(out), 3), err
}

// Parse reads the first table of `winget upgrade` output. Column positions
// come from the header line above the row of dashes, measured in display
// cells, so it works in any language winget is set to.
func Parse(out string) []Update {
	lines := cleanLines(out)
	dash := -1
	for i, l := range lines {
		t := strings.TrimSpace(l)
		if len(t) >= 10 && strings.Trim(t, "-") == "" && i > 0 {
			dash = i
			break
		}
	}
	if dash < 0 {
		return nil
	}
	cols := columnStarts(lines[dash-1])
	if len(cols) < 4 {
		return nil
	}
	var ups []Update
	for _, l := range lines[dash+1:] {
		if strings.TrimSpace(l) == "" {
			break
		}
		f := cut(l, cols)
		if len(f) < 4 || f[1] == "" || f[3] == "" {
			break // "3 upgrades available." and similar
		}
		u := Update{Name: f[0], ID: f[1], Version: f[2], Available: f[3]}
		if len(f) > 4 {
			u.Source = f[4]
		}
		if strings.HasSuffix(u.ID, "…") || !ValidID(u.ID) {
			u.Truncated = true
		}
		ups = append(ups, u)
	}
	return ups
}

// cleanLines splits output into lines, keeping only what follows the last
// carriage return (winget draws a spinner with \r).
func cleanLines(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if i := strings.LastIndexByte(strings.TrimRight(l, "\r"), '\r'); i >= 0 {
			l = l[i+1:]
		}
		out = append(out, strings.TrimRight(l, "\r"))
	}
	return out
}

// columnStarts returns the display column where each header word begins.
func columnStarts(header string) []int {
	var starts []int
	col, prevSpace := 0, true
	for _, r := range header {
		space := r == ' '
		if !space && prevSpace {
			starts = append(starts, col)
		}
		prevSpace = space
		col += width(r)
	}
	return starts
}

// cut splits a row at the given display columns.
func cut(row string, starts []int) []string {
	fields := make([]strings.Builder, len(starts))
	col, idx := 0, 0
	for _, r := range row {
		for idx+1 < len(starts) && col >= starts[idx+1] {
			idx++
		}
		fields[idx].WriteRune(r)
		col += width(r)
	}
	out := make([]string, len(fields))
	for i := range fields {
		out[i] = strings.TrimSpace(fields[i].String())
	}
	return out
}

// width is the number of terminal cells a character takes.
func width(r rune) int {
	switch {
	case r >= 0x1100 && r <= 0x115F, r >= 0x2E80 && r <= 0xA4CF, r >= 0xAC00 && r <= 0xD7A3,
		r >= 0xF900 && r <= 0xFAFF, r >= 0xFE30 && r <= 0xFE4F, r >= 0xFF00 && r <= 0xFF60,
		r >= 0xFFE0 && r <= 0xFFE6, r >= 0x20000 && r <= 0x3FFFD:
		return 2
	}
	return 1
}

func lastLines(s string, n int) string {
	var keep []string
	for _, l := range cleanLines(s) {
		if t := strings.TrimSpace(l); t != "" && strings.Trim(t, `-\|/ █▒`) != "" {
			keep = append(keep, t)
		}
	}
	if len(keep) > n {
		keep = keep[len(keep)-n:]
	}
	return strings.Join(keep, "\n")
}
