package health

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/sysinfo"
)

const gb = int64(1) << 30

func byID(fs []Finding) map[string]Finding {
	m := map[string]Finding{}
	for _, f := range fs {
		m[f.ID] = f
	}
	return m
}

func TestEvaluateCommon(t *testing.T) {
	f := Facts{
		Drives: []sysinfo.Drive{
			{Path: `C:\`, Total: 256 * gb, Free: 20 * gb},
			{Path: `D:\`, Total: 1000 * gb, Free: 300 * gb},
			{Path: `E:\`, Total: 1000 * gb, Free: 1 * gb},
		},
		Memory: sysinfo.Memory{Total: 8 * gb, Available: gb / 2},
		Uptime: 20 * 24 * time.Hour,
		Procs:  []Proc{{Name: "chrome", Mem: 3 * gb, Count: 24}, {Name: "Teams", Mem: gb}},
	}
	got := Evaluate(f, time.Now())
	m := byID(got)
	if m[`space:C:\`].Status != Attention || m[`space:D:\`].Status != Good || m[`space:E:\`].Status != Problem {
		t.Fatalf("space: %+v", got)
	}
	if mem := m["memory"]; mem.Status != Attention || !strings.Contains(mem.Detail, "chrome ×24 3.0 GB") {
		t.Fatalf("memory %+v", mem)
	}
	if m["uptime"].Status != Attention || m["uptime"].Detail != "20 days." {
		t.Fatalf("uptime %+v", m["uptime"])
	}
	if got[0].Status != Problem {
		t.Fatal("not sorted by seriousness")
	}
	if m[`space:C:\`].Action == nil || m[`space:C:\`].Action.ID != "go:clean" {
		t.Fatal("no action to free space")
	}
}

func TestEvaluateWindows(t *testing.T) {
	raw := `{"os":{"caption":"Microsoft Windows 11 Pro","version":"10.0.26100","build":"26100"},
	"defender":{"av":true,"rtp":true,"sigAge":12,"quickAge":3},
	"av":[{"name":"Windows Defender","state":397568}],
	"firewall":[{"name":"Domain","enabled":true},{"name":"Private","enabled":true},{"name":"Public","enabled":false}],
	"disks":[{"name":"Samsung SSD 980","media":"SSD","health":"Healthy","op":"OK","size":500107862016},
	         {"name":"WDC HDD","media":"HDD","health":"Warning","op":"Predictive Failure","size":1000204886016}],
	"rebootPending":true,"lastUpdate":"2026-08-01T10:00:00Z",
	"battery":{"full":31000,"design":57000},"storageSense":false,"procs":[{"name":"msedge","mem":1073741824,"count":12}]}`
	var w WinFacts
	if err := json.Unmarshal([]byte(raw), &w); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)
	m := byID(Evaluate(Facts{Windows: &w}, now))
	checks := map[string]string{
		"av": Attention, "firewall": Problem, "disk:Samsung SSD 980": Good, "disk:WDC HDD": Problem,
		"reboot": Attention, "updates": Attention, "battery": Attention, "storagesense": Info, "repair": Info,
	}
	for id, want := range checks {
		if m[id].Status != want {
			t.Errorf("%s: status %q, want %q (%+v)", id, m[id].Status, want, m[id])
		}
	}
	if !strings.Contains(m["firewall"].Detail, "Public") {
		t.Error("firewall finding must name the profile")
	}
	if !strings.Contains(m["battery"].Detail, "54%") {
		t.Errorf("battery %q", m["battery"].Detail)
	}

	// Another antivirus that is on counts as protection.
	w.AV = append(w.AV, struct {
		Name  string `json:"name"`
		State int    `json:"state"`
	}{Name: "Bitdefender Antivirus", State: 266240})
	w.Defender.RTP = false
	if f := byID(Evaluate(Facts{Windows: &w}, now))["av"]; f.Status != Good || !strings.Contains(f.Detail, "Bitdefender") {
		t.Fatalf("third-party antivirus %+v", f)
	}
}

func TestGB(t *testing.T) {
	if GB(1536<<20) != "1.5 GB" || GB(300<<20) != "300 MB" || GB(2048) != "2 KB" {
		t.Fatal(GB(1536<<20), GB(300<<20), GB(2048))
	}
}
