//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
)

func opener() string {
	if runtime.GOOS == "darwin" {
		return "open"
	}
	return "xdg-open"
}

func openApp(url, dataDir string) error { return exec.Command(opener(), url).Start() }

func showError(title, msg string) { fmt.Fprintf(os.Stderr, "%s: %s\n", title, msg) }

func interrupted() <-chan os.Signal {
	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt, syscall.SIGTERM)
	return c
}

func openTarget(target string) error {
	if filepath.IsAbs(target) {
		return exec.Command(opener(), target).Start()
	}
	return errors.New("this is only available on Windows")
}

// reveal opens the folder that holds the file.
func reveal(path string) error { return exec.Command(opener(), filepath.Dir(path)).Start() }

func elevate(exe string, args []string) error {
	return errors.New("run Kempt with sudo to clean folders that belong to the system")
}
