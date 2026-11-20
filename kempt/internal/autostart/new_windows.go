//go:build windows

package autostart

// New returns the manager for this system.
func New() Manager { return NewWindows() }
