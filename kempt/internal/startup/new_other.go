//go:build !windows

package startup

// New returns the manager for this system.
func New(elevated bool) Manager { return NewXDG() }
