// Package autostart makes Kempt itself start when you sign in, if you ask
// for that. On Windows it writes one value under your account's Run key,
// the place Task Manager's Startup list shows; on Linux an XDG autostart
// file. Turning it off removes the entry again.
package autostart

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
	"github.com/ZenZeiTen/synthapps/kempt/internal/startup"
)

// Name is the entry's name in the Run key and in Task Manager.
const Name = "Kempt"

// Manager turns starting with the computer on and off.
type Manager interface {
	// Enabled reports whether Kempt starts when you sign in.
	Enabled(ctx context.Context) (bool, error)
	// Set adds or removes the entry. command is the full command line.
	Set(ctx context.Context, on bool, command string) error
}

// Command is the command line the entry runs: Kempt, told that Windows
// started it, with the same data folder.
func Command(exe, dataDir string) string {
	return `"` + exe + `" desktop --startup --data "` + dataDir + `"`
}

// ---- Windows ----

const runKey = `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run`
const approvedKey = `HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`

const readScript = `
$cmd = $null; $ap = $null
try { $cmd = [string](Get-ItemProperty -LiteralPath '` + runKey + `' -Name '` + Name + `' -ErrorAction Stop).'` + Name + `' } catch {}
try { $v = (Get-ItemProperty -LiteralPath '` + approvedKey + `' -Name '` + Name + `' -ErrorAction Stop).'` + Name + `'; if ($v) { $ap = [Convert]::ToBase64String([byte[]]$v) } } catch {}
ConvertTo-Json -Compress -InputObject @{ command = $cmd; approved = $ap }
`

// onScript writes the Run value and clears a "disabled" mark left by Task
// Manager, so the entry really starts.
const onScript = `
$d = %s
if (-not (Test-Path -LiteralPath '` + runKey + `')) { New-Item -Path '` + runKey + `' -Force | Out-Null }
New-ItemProperty -LiteralPath '` + runKey + `' -Name '` + Name + `' -PropertyType String -Value $d.command -Force | Out-Null
Remove-ItemProperty -LiteralPath '` + approvedKey + `' -Name '` + Name + `' -ErrorAction SilentlyContinue
'{"ok":true}'
`

const offScript = `
Remove-ItemProperty -LiteralPath '` + runKey + `' -Name '` + Name + `' -ErrorAction SilentlyContinue
Remove-ItemProperty -LiteralPath '` + approvedKey + `' -Name '` + Name + `' -ErrorAction SilentlyContinue
'{"ok":true}'
`

// Windows uses the Run key of the signed-in user.
type Windows struct {
	// PS runs a script and decodes its JSON output; tests replace it.
	PS func(ctx context.Context, script string, v any) error
}

// NewWindows uses the real PowerShell.
func NewWindows() *Windows { return &Windows{PS: shell.PowerShellJSON} }

// Enabled is true when the value exists and Task Manager has not disabled it.
func (w *Windows) Enabled(ctx context.Context) (bool, error) {
	var r struct {
		Command  string `json:"command"`
		Approved []byte `json:"approved"`
	}
	if err := w.PS(ctx, readScript, &r); err != nil {
		return false, err
	}
	return r.Command != "" && startup.ApprovedEnabled(r.Approved), nil
}

// Set writes or removes the value.
func (w *Windows) Set(ctx context.Context, on bool, command string) error {
	var ok map[string]bool
	if !on {
		return w.PS(ctx, offScript, &ok)
	}
	return w.PS(ctx, strings.Replace(onScript, "%s", shell.PSData(map[string]string{"command": command}), 1), &ok)
}

// ---- Linux and other XDG desktops ----

// XDG uses ~/.config/autostart/kempt.desktop.
type XDG struct{ Dir string }

// NewXDG uses the standard folder.
func NewXDG() *XDG {
	cfg := os.Getenv("XDG_CONFIG_HOME")
	if cfg == "" {
		h, _ := os.UserHomeDir()
		cfg = filepath.Join(h, ".config")
	}
	return &XDG{Dir: filepath.Join(cfg, "autostart")}
}

func (x *XDG) file() string { return filepath.Join(x.Dir, "kempt.desktop") }

// Enabled is true when the file exists and is not hidden.
func (x *XDG) Enabled(ctx context.Context) (bool, error) {
	b, err := os.ReadFile(x.file())
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	for _, l := range strings.Split(string(b), "\n") {
		if strings.EqualFold(strings.ReplaceAll(strings.TrimSpace(l), " ", ""), "Hidden=true") {
			return false, nil
		}
	}
	return true, nil
}

// Set writes or removes the file.
func (x *XDG) Set(ctx context.Context, on bool, command string) error {
	if !on {
		err := os.Remove(x.file())
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if err := os.MkdirAll(x.Dir, 0o755); err != nil {
		return err
	}
	body := "[Desktop Entry]\nType=Application\nName=Kempt\nComment=Honest PC care\nExec=" + command + "\nTerminal=false\n"
	return os.WriteFile(x.file(), []byte(body), 0o644)
}
