package shell

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestEncodeCommand(t *testing.T) {
	// "dir" in UTF-16LE is 64 00 69 00 72 00.
	got := EncodeCommand("dir")
	b, _ := base64.StdEncoding.DecodeString(got)
	if string(b) != "d\x00i\x00r\x00" {
		t.Fatalf("got %q", b)
	}
	// Characters outside the BMP become surrogate pairs.
	if b, _ := base64.StdEncoding.DecodeString(EncodeCommand("😀")); len(b) != 4 {
		t.Fatalf("emoji: %d bytes", len(b))
	}
}

func TestPSDataKeepsDataOutOfScript(t *testing.T) {
	s := PSData([]string{"C:\\a'b", "\n'@\nRemove-Item C:\\"})
	lines := strings.Split(s, "\n")
	if len(lines) != 3 || lines[0] != "(@'" || lines[2] != "'@ | ConvertFrom-Json)" {
		t.Fatalf("unexpected shape: %q", s)
	}
	if strings.HasPrefix(lines[1], "'@") {
		t.Fatal("data line could end the here-string")
	}
}
