package privacy

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

func TestReadAndSet(t *testing.T) {
	old := PS
	defer func() { PS = old }()
	var wrote []map[string]any
	PS = func(ctx context.Context, script string, v any) error {
		data := string(shell.DecodePSData(script))
		if strings.Contains(script, "Get-ItemProperty") {
			var refs []ref
			json.Unmarshal([]byte(data), &refs)
			vals := make([]*int, len(refs))
			zero, one := 0, 1
			for k, r := range refs {
				switch r.Name {
				case "Enabled": // advertising ID off
					vals[k] = &zero
				case "HttpAcceptLanguageOptOut": // opted out: private
					vals[k] = &one
				case "SubscribedContent-338388Enabled":
					vals[k] = &zero
				case "SystemPaneSuggestionsEnabled": // one of two still on
					vals[k] = &one
				}
			}
			b, _ := json.Marshal(vals)
			return json.Unmarshal(b, v)
		}
		json.Unmarshal([]byte(data), &wrote)
		return json.Unmarshal([]byte(`{"ok":true}`), v)
	}
	got, err := Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := map[string]bool{}
	for _, s := range got {
		m[s.ID] = s.On
		if s.What == "" || s.Title == "" {
			t.Errorf("%s lacks text", s.ID)
		}
	}
	if m["advertising-id"] || m["language-list"] || !m["tips"] || !m["start-suggestions"] {
		t.Fatalf("states %v", m)
	}
	if _, err := Set(context.Background(), "start-suggestions", false); err != nil {
		t.Fatal(err)
	}
	if len(wrote) != 2 || wrote[0]["value"].(float64) != 0 || wrote[1]["name"] != "SystemPaneSuggestionsEnabled" {
		t.Fatalf("wrote %v", wrote)
	}
	Set(context.Background(), "language-list", true)
	if wrote[0]["value"].(float64) != 0 {
		t.Fatal("language list: On means opt-out value 0")
	}
	if _, err := Set(context.Background(), "nope", true); err == nil {
		t.Fatal("unknown id accepted")
	}
}
