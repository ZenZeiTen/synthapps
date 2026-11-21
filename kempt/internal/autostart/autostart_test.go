package autostart

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

func TestCommand(t *testing.T) {
	got := Command(`C:\Apps\Kempt.exe`, `C:\Users\a b\AppData\Local\Kempt`)
	if got != `"C:\Apps\Kempt.exe" desktop --startup --data "C:\Users\a b\AppData\Local\Kempt"` {
		t.Fatal(got)
	}
}

func TestWindows(t *testing.T) {
	state := `{"command":null,"approved":null}`
	var wrote string
	w := &Windows{PS: func(ctx context.Context, script string, v any) error {
		switch {
		case strings.Contains(script, "New-ItemProperty"):
			var d map[string]string
			json.Unmarshal(shell.DecodePSData(script), &d)
			wrote = d["command"]
			if !strings.Contains(script, "Remove-ItemProperty") {
				t.Error("turning on must clear Task Manager's disabled mark")
			}
			return json.Unmarshal([]byte(`{"ok":true}`), v)
		case strings.Contains(script, "ConvertTo-Json"):
			return json.Unmarshal([]byte(state), v)
		default:
			wrote = ""
			return json.Unmarshal([]byte(`{"ok":true}`), v)
		}
	}}
	ctx := context.Background()
	if on, _ := w.Enabled(ctx); on {
		t.Fatal("on without a value")
	}
	if err := w.Set(ctx, true, `"C:\K.exe" desktop --startup`); err != nil || wrote != `"C:\K.exe" desktop --startup` {
		t.Fatalf("set: %v %q", err, wrote)
	}
	state = `{"command":"x","approved":null}`
	if on, _ := w.Enabled(ctx); !on {
		t.Fatal("off with a value")
	}
	state = `{"command":"x","approved":"AwAAAAAAAAAAAAAA"}` // 03...: disabled in Task Manager
	if on, _ := w.Enabled(ctx); on {
		t.Fatal("on although Task Manager disabled it")
	}
	w.Set(ctx, false, "")
	if wrote != "" {
		t.Fatal("off did not run the removal")
	}
}

func TestXDG(t *testing.T) {
	x := &XDG{Dir: filepath.Join(t.TempDir(), "autostart")}
	ctx := context.Background()
	if on, err := x.Enabled(ctx); on || err != nil {
		t.Fatal(on, err)
	}
	if err := x.Set(ctx, true, `"/opt/kempt" desktop --startup --data "/home/a/.config/kempt"`); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(x.file())
	if !strings.Contains(string(b), "Exec=\"/opt/kempt\" desktop --startup") {
		t.Fatalf("file %q", b)
	}
	if on, _ := x.Enabled(ctx); !on {
		t.Fatal("not on")
	}
	os.WriteFile(x.file(), append(b, []byte("Hidden=true\n")...), 0o644)
	if on, _ := x.Enabled(ctx); on {
		t.Fatal("hidden entry counted")
	}
	if err := x.Set(ctx, false, ""); err != nil {
		t.Fatal(err)
	}
	if err := x.Set(ctx, false, ""); err != nil {
		t.Fatal("removing twice must be fine:", err)
	}
	if on, _ := x.Enabled(ctx); on {
		t.Fatal("still on")
	}
}
