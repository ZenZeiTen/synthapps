package shell

import (
	"encoding/base64"
	"encoding/json"
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
	in := []string{"C:\\a'b", "\n'@\nRemove-Item C:\\", "'); Remove-Item C:\\ #"}
	s := PSData(in)
	const pre, post = "([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('", "')) | ConvertFrom-Json)"
	if !strings.HasPrefix(s, pre) || !strings.HasSuffix(s, post) {
		t.Fatalf("unexpected shape: %q", s)
	}
	for _, c := range s[len(pre) : len(s)-len(post)] {
		ok := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '+' || c == '/' || c == '='
		if !ok {
			t.Fatalf("character %q from the data reached the script", c)
		}
	}
	var back []string
	if err := json.Unmarshal(DecodePSData("$d = "+s), &back); err != nil || len(back) != 3 || back[2] != in[2] {
		t.Fatalf("round trip: %v %q", err, back)
	}
}
