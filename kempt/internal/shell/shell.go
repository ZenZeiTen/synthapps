// Package shell runs other programs for Kempt: Windows PowerShell, winget,
// schtasks and the like. On Windows the child gets no console window.
package shell

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
	"unicode/utf16"
)

// Run starts name with args and returns what it printed on standard output.
// A non-zero exit status is an error that includes the first lines of
// standard error.
func Run(ctx context.Context, name string, args ...string) ([]byte, error) {
	return RunInput(ctx, nil, name, args...)
}

// RunInput is Run with bytes for standard input.
func RunInput(ctx context.Context, stdin []byte, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	hide(cmd)
	var out, errb bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errb
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	err := cmd.Run()
	if err != nil {
		msg := strings.TrimSpace(errb.String())
		if len(msg) > 600 {
			msg = msg[:600] + "..."
		}
		if msg != "" {
			return out.Bytes(), fmt.Errorf("%s: %w: %s", name, err, msg)
		}
		return out.Bytes(), fmt.Errorf("%s: %w", name, err)
	}
	return out.Bytes(), nil
}

// psPrelude makes PowerShell print UTF-8, stay quiet about progress and stop
// on the first error unless a script catches it.
const psPrelude = "$ProgressPreference='SilentlyContinue'\n" +
	"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n" +
	"$ErrorActionPreference='Stop'\n"

// PowerShell runs a Windows PowerShell script and returns its standard
// output. The script is passed with -EncodedCommand, so it needs no quoting.
func PowerShell(ctx context.Context, script string) ([]byte, error) {
	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 2*time.Minute)
		defer cancel()
	}
	return Run(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive",
		"-ExecutionPolicy", "Bypass", "-EncodedCommand", EncodeCommand(psPrelude+script))
}

// PowerShellJSON runs a script that prints one JSON value and decodes it.
func PowerShellJSON(ctx context.Context, script string, v any) error {
	out, err := PowerShell(ctx, script)
	if err != nil {
		return err
	}
	out = bytes.TrimSpace(bytes.TrimPrefix(out, []byte("\xef\xbb\xbf")))
	if len(out) == 0 {
		return errors.New("powershell printed nothing")
	}
	if err := json.Unmarshal(out, v); err != nil {
		return fmt.Errorf("unexpected output from powershell: %w", err)
	}
	return nil
}

// EncodeCommand encodes a script for powershell.exe -EncodedCommand
// (UTF-16 little-endian, then base64).
func EncodeCommand(script string) string {
	u := utf16.Encode([]rune(script))
	b := make([]byte, 2*len(u))
	for i, c := range u {
		b[2*i] = byte(c)
		b[2*i+1] = byte(c >> 8)
	}
	return base64.StdEncoding.EncodeToString(b)
}

// PSData returns a PowerShell expression that evaluates to v. The value is
// marshalled to JSON and embedded base64-encoded, so the script text holds
// only letters, digits, "+", "/" and "=" from it: data from Kempt can never
// end a string or become script.
func PSData(v any) string {
	b, _ := json.Marshal(v)
	return "([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
		base64.StdEncoding.EncodeToString(b) + "')) | ConvertFrom-Json)"
}

// DecodePSData returns the JSON of the first PSData value in a script.
// Tests use it to see what a script was given.
func DecodePSData(script string) []byte {
	const open = "FromBase64String('"
	i := strings.Index(script, open)
	if i < 0 {
		return nil
	}
	rest := script[i+len(open):]
	j := strings.IndexByte(rest, '\'')
	if j < 0 {
		return nil
	}
	b, _ := base64.StdEncoding.DecodeString(rest[:j])
	return b
}
