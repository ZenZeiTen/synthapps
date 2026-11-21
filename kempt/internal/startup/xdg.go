package startup

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// XDG manages autostart entries as described by the freedesktop.org
// Desktop Application Autostart Specification: .desktop files in
// ~/.config/autostart override same-named files in /etc/xdg/autostart, and
// Hidden=true turns an entry off.
type XDG struct {
	UserDir    string
	SystemDirs []string
}

// NewXDG uses the standard folders.
func NewXDG() *XDG {
	cfg := os.Getenv("XDG_CONFIG_HOME")
	if cfg == "" {
		h, _ := os.UserHomeDir()
		cfg = filepath.Join(h, ".config")
	}
	dirs := os.Getenv("XDG_CONFIG_DIRS")
	if dirs == "" {
		dirs = "/etc/xdg"
	}
	x := &XDG{UserDir: filepath.Join(cfg, "autostart")}
	for _, d := range filepath.SplitList(dirs) {
		x.SystemDirs = append(x.SystemDirs, filepath.Join(d, "autostart"))
	}
	return x
}

type desktopFile struct {
	name, path, source string
	content      string
}

func (x *XDG) files() map[string]desktopFile {
	out := map[string]desktopFile{}
	for i := len(x.SystemDirs) - 1; i >= 0; i-- { // earlier dirs take precedence
		x.read(out, x.SystemDirs[i], "autostart-system")
	}
	x.read(out, x.UserDir, "autostart-user")
	return out
}

func (x *XDG) read(out map[string]desktopFile, dir, source string) {
	ents, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range ents {
		if !e.Type().IsRegular() || !strings.HasSuffix(e.Name(), ".desktop") {
			continue
		}
		p := filepath.Join(dir, e.Name())
		b, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		out[e.Name()] = desktopFile{name: e.Name(), path: p, source: source, content: string(b)}
	}
}

// desktopKey reads a key from the [Desktop Entry] group.
func desktopKey(content, key string) (string, bool) {
	in := false
	for _, line := range strings.Split(content, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "[") {
			in = l == "[Desktop Entry]"
			continue
		}
		if !in {
			continue
		}
		if k, v, ok := strings.Cut(l, "="); ok && strings.TrimSpace(k) == key {
			return strings.TrimSpace(v), true
		}
	}
	return "", false
}

// setDesktopKey sets key=value in the [Desktop Entry] group.
func setDesktopKey(content, key, value string) string {
	lines := strings.Split(content, "\n")
	in, header := false, -1
	for i, line := range lines {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "[") {
			if in {
				break
			}
			in = l == "[Desktop Entry]"
			if in {
				header = i
			}
			continue
		}
		if in {
			if k, _, ok := strings.Cut(l, "="); ok && strings.TrimSpace(k) == key {
				lines[i] = key + "=" + value
				return strings.Join(lines, "\n")
			}
		}
	}
	if header < 0 {
		return "[Desktop Entry]\n" + key + "=" + value + "\n" + content
	}
	lines = append(lines[:header+1], append([]string{key + "=" + value}, lines[header+1:]...)...)
	return strings.Join(lines, "\n")
}

func xdgEnabled(content string) bool {
	if v, _ := desktopKey(content, "Hidden"); strings.EqualFold(v, "true") {
		return false
	}
	if v, ok := desktopKey(content, "X-GNOME-Autostart-enabled"); ok && strings.EqualFold(v, "false") {
		return false
	}
	return true
}

func (x *XDG) item(name string, f desktopFile) Item {
	title, _ := desktopKey(f.content, "Name")
	if title == "" {
		title = strings.TrimSuffix(name, ".desktop")
	}
	exec, _ := desktopKey(f.content, "Exec")
	return Item{
		ID: "xdg:" + name, Name: title, Command: exec, Path: ExePath(exec, os.Getenv),
		Source: f.source, Where: SourceLabel(f.source), Enabled: xdgEnabled(f.content),
	}
}

// List reads every autostart entry.
func (x *XDG) List(ctx context.Context) ([]Item, error) {
	var items []Item
	for name, f := range x.files() {
		items = append(items, x.item(name, f))
	}
	sort.Slice(items, func(i, j int) bool { return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name) })
	return items, nil
}

// Set writes a per-user override, as desktop environments do.
func (x *XDG) Set(ctx context.Context, id string, enabled bool) (Item, error) {
	name := strings.TrimPrefix(id, "xdg:")
	if name == id || strings.ContainsAny(name, `/\`) || name == "." || name == ".." {
		return Item{}, ErrNotFound
	}
	f, ok := x.files()[name]
	if !ok {
		return Item{}, ErrNotFound
	}
	val := "false"
	if !enabled {
		val = "true"
	}
	c := setDesktopKey(f.content, "Hidden", val)
	if _, has := desktopKey(c, "X-GNOME-Autostart-enabled"); has {
		c = setDesktopKey(c, "X-GNOME-Autostart-enabled", map[bool]string{true: "true", false: "false"}[enabled])
	}
	if err := os.MkdirAll(x.UserDir, 0o755); err != nil {
		return Item{}, err
	}
	// The override takes the file name the folder listing gave, not the request's text.
	p := filepath.Join(x.UserDir, f.name)
	if err := os.WriteFile(p, []byte(c), 0o644); err != nil {
		return Item{}, err
	}
	return x.item(f.name, desktopFile{name: f.name, path: p, source: "autostart-user", content: c}), nil
}
