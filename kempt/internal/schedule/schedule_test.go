package schedule

import (
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	good := []Plan{{Enabled: false}, {Enabled: true, Frequency: "daily", Time: "09:30"}, {Enabled: true, Frequency: "weekly", Day: "Sunday", Time: "23:59"}}
	for _, p := range good {
		if err := p.Validate(); err != nil {
			t.Errorf("%+v: %v", p, err)
		}
	}
	bad := []Plan{{Enabled: true, Frequency: "hourly", Time: "09:00"}, {Enabled: true, Frequency: "weekly", Day: "Sun", Time: "09:00"},
		{Enabled: true, Frequency: "daily", Time: "24:00"}, {Enabled: true, Frequency: "daily", Time: "9:00"}}
	for _, p := range bad {
		if p.Validate() == nil {
			t.Errorf("%+v accepted", p)
		}
	}
}

func TestRegisterScriptHasOnePlaceholder(t *testing.T) {
	f := registerScriptFmt()
	if strings.Count(f, "%s") != 1 {
		t.Fatal("placeholder count")
	}
}
