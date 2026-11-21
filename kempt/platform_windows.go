//go:build windows

package main

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"github.com/ZenZeiTen/synthapps/kempt/internal/api"
	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

const canMinimize = true

const minimizedScript = `
$d = %s
Start-Process -FilePath $d.exe -ArgumentList $d.args -WindowStyle Minimized
'{"ok":true}'
`

// openApp opens the window as a Microsoft Edge app window (no tabs or
// address bar) with its own profile in Kempt's data folder, so it neither
// joins nor locks your own Edge profile. Without Edge, the default browser.
// With minimized, the window starts as a button on the taskbar.
func openApp(url, dataDir string, minimized bool) error {
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
		if base == "" {
			continue
		}
		edge := filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe")
		if _, err := os.Stat(edge); err != nil {
			continue
		}
		args := []string{"--app=" + url, "--new-window",
			"--user-data-dir=" + filepath.Join(dataDir, "window"),
			"--no-first-run", "--no-default-browser-check", "--window-size=1180,820"}
		if minimized && startMinimized(edge, args) == nil {
			return nil
		}
		if exec.Command(edge, args...).Start() == nil {
			return nil
		}
	}
	return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

// startMinimized asks Windows to start the program with its first window
// minimized, which Edge honours for a new profile's first window.
func startMinimized(exe string, args []string) error {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = `"` + a + `"`
	}
	data := map[string]string{"exe": exe, "args": strings.Join(quoted, " ")}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var ok map[string]bool
	return shell.PowerShellJSON(ctx, strings.Replace(minimizedScript, "%s", shell.PSData(data), 1), &ok)
}

func showError(title, msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	box := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(msg)
	const mbIconError = 0x10
	box.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbIconError)
}

func interrupted() <-chan os.Signal {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	return c
}

const repairScript = `Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList @('-NoProfile','-NoExit','-Command','Write-Host ''Kempt: checking Windows system files. This takes 10 to 30 minutes; you can keep working.''; sfc /scannow; DISM /Online /Cleanup-Image /RestoreHealth; Write-Host ''Done. You can close this window.''')
'{"ok":true}'`

// openTarget opens a Settings page or Windows tool from the allowed list.
func openTarget(target string) error {
	switch {
	case target == "repair":
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		var ok map[string]bool
		if err := shell.PowerShellJSON(ctx, repairScript, &ok); err != nil {
			return api.ErrDeclined
		}
		return nil
	case strings.HasSuffix(target, ".exe"):
		return exec.Command(target).Start()
	default:
		return exec.Command("explorer.exe", target).Start()
	}
}

// reveal opens File Explorer with the file selected.
func reveal(path string) error {
	cmd := exec.Command("explorer.exe")
	// explorer.exe wants /select,"path" exactly; Windows paths cannot contain quotes.
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + path + `"`}
	return cmd.Start()
}

const elevateScript = `
$d = %s
Start-Process -FilePath $d.exe -ArgumentList $d.args -Verb RunAs
'{"ok":true}'
`

// elevate starts Kempt again with administrator rights (Windows asks first).
func elevate(exe string, args []string) error {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = `"` + a + `"`
	}
	data := map[string]string{"exe": guiExe(exe), "args": strings.Join(quoted, " ")}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	var ok map[string]bool
	if err := shell.PowerShellJSON(ctx, strings.Replace(elevateScript, "%s", shell.PSData(data), 1), &ok); err != nil {
		return api.ErrDeclined
	}
	return nil
}
