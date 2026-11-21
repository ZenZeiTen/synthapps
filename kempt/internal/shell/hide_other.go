//go:build !windows

package shell

import "os/exec"

func hide(*exec.Cmd) {}
