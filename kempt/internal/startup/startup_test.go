package startup

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func env(k string) string {
	return map[string]string{"ProgramFiles": `C:\Program Files`, "LOCALAPPDATA": `C:\Users\a\AppData\Local`}[k]
}

func TestExePath(t *testing.T) {
	cases := map[string]string{
		`"C:\Program Files\Steam\steam.exe" -silent`:                   `C:\Program Files\Steam\steam.exe`,
		`C:\Program Files\Tool\tool.exe /min`:                          `C:\Program Files\Tool\tool.exe`,
		`%ProgramFiles%\Thing\thing.exe --tray`:                        `C:\Program Files\Thing\thing.exe`,
		`%LOCALAPPDATA%\Discord\Update.exe --processStart Discord.exe`: `C:\Users\a\AppData\Local\Discord\Update.exe`,
		`rundll32.exe C:\x\y.dll,Start`:                                `rundll32.exe`,
		`C:\a.exe.config\b.exe`:                                        `C:\a.exe.config\b.exe`,
		`%UNKNOWN%\z.exe`:                                              `%UNKNOWN%\z.exe`,
		`/usr/bin/nm-applet --indicator`:                               `/usr/bin/nm-applet`,
		``:                                                             ``,
	}
	for in, want := range cases {
		if got := ExePath(in, env); got != want {
			t.Errorf("ExePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestApprovedValue(t *testing.T) {
	if !ApprovedEnabled(nil) || !ApprovedEnabled([]byte{2, 0, 0}) || !ApprovedEnabled([]byte{6, 0}) {
		t.Fatal("enabled values")
	}
	if ApprovedEnabled([]byte{3, 0}) || ApprovedEnabled([]byte{7, 0}) {
		t.Fatal("disabled values")
	}
	on := ApprovedValue(true, 0)
	if len(on) != 12 || on[0] != 2 || !ApprovedEnabled(on) {
		t.Fatalf("on %x", on)
	}
	ft := filetime(time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC))
	off := ApprovedValue(false, ft)
	if off[0] != 3 || ApprovedEnabled(off) {
		t.Fatalf("off %x", off)
	}
	var back uint64
	for i := 0; i < 8; i++ {
		back |= uint64(off[4+i]) << (8 * i)
	}
	if back != ft || ft != 134117966450000000 {
		t.Fatalf("filetime %d", back)
	}
}

// fakePS answers the three scripts the Windows manager runs.
type fakePS struct {
	raw  []rawItem
	sets []map[string]string
}

func (f *fakePS) run(ctx context.Context, script string, v any) error {
	switch {
	case strings.Contains(script, "GetValueNames"):
		b, _ := json.Marshal(f.raw)
		return json.Unmarshal(b, v)
	case strings.Contains(script, "VersionInfo"):
		return json.Unmarshal([]byte(`{"C:\\Program Files\\Steam\\steam.exe":{"exists":true,"company":"Valve"},"C:\\gone\\old.exe":{"exists":false}}`), v)
	case strings.Contains(script, "New-ItemProperty"):
		i := strings.Index(script, "(@'\n")
		j := strings.Index(script, "\n'@")
		var d map[string]string
		json.Unmarshal([]byte(script[i+4:j]), &d)
		f.sets = append(f.sets, d)
		return json.Unmarshal([]byte(`{"ok":true}`), v)
	}
	return nil
}

func TestWindowsManager(t *testing.T) {
	f := &fakePS{raw: []rawItem{
		{Source: "run-user", Name: "Steam", Command: `"C:\Program Files\Steam\steam.exe" -silent`},
		{Source: "run-machine", Name: "Old", Command: `C:\gone\old.exe`, Approved: []byte{3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8}},
		{Source: "folder-user", Name: "Notes.lnk", Command: `"C:\Notes\notes.exe"`},
	}}
	w := &Windows{PS: f.run, Getenv: env, Now: time.Now}
	items, err := w.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 3 || items[0].Name != "Notes" || items[2].Name != "Steam" {
		t.Fatalf("items %+v", items)
	}
	steam, old := items[2], items[1]
	if !steam.Enabled || steam.Publisher != "Valve" || steam.Admin || steam.Missing {
		t.Fatalf("steam %+v", steam)
	}
	if old.Enabled || !old.Admin || !old.Missing {
		t.Fatalf("old %+v", old)
	}
	if _, err := w.Set(context.Background(), old.ID, true); err != ErrNeedsAdmin {
		t.Fatalf("machine item changed without admin: %v", err)
	}
	it, err := w.Set(context.Background(), steam.ID, false)
	if err != nil || it.Enabled {
		t.Fatalf("set: %v %+v", err, it)
	}
	d := f.sets[0]
	if d["key"] != `HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run` || d["name"] != "Steam" {
		t.Fatalf("wrote %v", d)
	}
	if b, _ := base64.StdEncoding.DecodeString(d["value"]); len(b) != 12 || b[0] != 3 {
		t.Fatalf("value %x", b)
	}
	w.Set(context.Background(), "folder-user:Notes.lnk", false)
	if f.sets[1]["key"] != `HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder` || f.sets[1]["name"] != "Notes.lnk" {
		t.Fatalf("folder item wrote %v", f.sets[1])
	}
	if _, err := w.Set(context.Background(), "run-user:Nope", false); err != ErrNotFound {
		t.Fatal("unknown id accepted")
	}
}

func TestXDG(t *testing.T) {
	root := t.TempDir()
	x := &XDG{UserDir: filepath.Join(root, "user"), SystemDirs: []string{filepath.Join(root, "sys")}}
	os.MkdirAll(x.SystemDirs[0], 0o755)
	os.MkdirAll(x.UserDir, 0o755)
	os.WriteFile(filepath.Join(x.SystemDirs[0], "applet.desktop"), []byte("[Desktop Entry]\nName=Network Applet\nExec=/usr/bin/nm-applet --indicator\n\n[Desktop Action X]\nHidden=true\n"), 0o644)
	os.WriteFile(filepath.Join(x.SystemDirs[0], "gnome.desktop"), []byte("[Desktop Entry]\nName=Thing\nExec=thing\nX-GNOME-Autostart-enabled=false\n"), 0o644)
	os.WriteFile(filepath.Join(x.UserDir, "mine.desktop"), []byte("[Desktop Entry]\nName=Mine\nExec=mine\nHidden=true\n"), 0o644)
	items, _ := x.List(context.Background())
	if len(items) != 3 {
		t.Fatalf("items %+v", items)
	}
	byID := map[string]Item{}
	for _, it := range items {
		byID[it.ID] = it
	}
	if a := byID["xdg:applet.desktop"]; !a.Enabled || a.Path != "/usr/bin/nm-applet" || a.Source != "autostart-system" {
		t.Fatalf("applet %+v (Hidden in another group must not count)", a)
	}
	if byID["xdg:gnome.desktop"].Enabled || byID["xdg:mine.desktop"].Enabled {
		t.Fatal("disabled entries read as enabled")
	}
	it, err := x.Set(context.Background(), "xdg:applet.desktop", false)
	if err != nil || it.Enabled || it.Source != "autostart-user" {
		t.Fatalf("set %v %+v", err, it)
	}
	if b, _ := os.ReadFile(filepath.Join(x.SystemDirs[0], "applet.desktop")); strings.Contains(string(b), "Hidden=true\nExec") {
		t.Fatal("system file changed")
	}
	if it, _ := x.Set(context.Background(), "xdg:gnome.desktop", true); !it.Enabled {
		t.Fatal("could not enable a GNOME-disabled entry")
	}
	if _, err := x.Set(context.Background(), "xdg:../../etc/passwd", true); err != ErrNotFound {
		t.Fatal("path in id accepted")
	}
	items, _ = x.List(context.Background())
	for _, it := range items {
		if it.ID == "xdg:applet.desktop" && it.Enabled {
			t.Fatal("override not read back")
		}
	}
}
