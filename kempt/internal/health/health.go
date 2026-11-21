// Package health checks the things that really decide whether a computer
// is in good shape: free disk space, drive health, security protection,
// updates, a pending restart, battery wear and memory pressure. Each finding
// says what was measured, what it means, and what to do.
package health

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/i18n"
	"github.com/ZenZeiTen/synthapps/kempt/internal/sysinfo"
)

// Status of a finding.
const (
	Good      = "good"
	Attention = "attention"
	Problem   = "problem"
	Info      = "info"
)

// Finding is one result of a checkup.
type Finding struct {
	ID     string  `json:"id"`
	Area   string  `json:"area"`
	Title  string  `json:"title"`
	Status string  `json:"status"`
	Detail string  `json:"detail"`
	Advice string  `json:"advice,omitempty"`
	Action *Action `json:"action,omitempty"`
}

// Action is a button next to a finding. ID is one of the actions the
// desktop API allows (see api.actions).
type Action struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

// Proc is memory use summed over processes with the same name.
type Proc struct {
	Name  string `json:"name"`
	Mem   int64  `json:"mem"`
	Count int    `json:"count"`
}

// Facts are the raw measurements.
type Facts struct {
	Drives  []sysinfo.Drive `json:"drives"`
	Memory  sysinfo.Memory  `json:"memory"`
	Uptime  time.Duration   `json:"uptime"`
	Procs   []Proc          `json:"procs"`
	Windows *WinFacts       `json:"windows,omitempty"`
}

// WinFacts come from Windows PowerShell; a missing part is nil.
type WinFacts struct {
	OS *struct {
		Caption string `json:"caption"`
		Version string `json:"version"`
		Build   string `json:"build"`
	} `json:"os"`
	Defender *struct {
		AV       bool `json:"av"`
		RTP      bool `json:"rtp"`
		SigAge   int  `json:"sigAge"`
		QuickAge int  `json:"quickAge"`
	} `json:"defender"`
	AV []struct {
		Name  string `json:"name"`
		State int    `json:"state"`
	} `json:"av"`
	Firewall []struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	} `json:"firewall"`
	Disks []struct {
		Name   string `json:"name"`
		Media  string `json:"media"`
		Health string `json:"health"`
		Op     string `json:"op"`
		Size   int64  `json:"size"`
	} `json:"disks"`
	RebootPending bool   `json:"rebootPending"`
	LastUpdate    string `json:"lastUpdate"`
	Battery       *struct {
		Full   int64 `json:"full"`
		Design int64 `json:"design"`
	} `json:"battery"`
	StorageSense *bool  `json:"storageSense"`
	Procs        []Proc `json:"procs"`
}

// Report is a full checkup.
type Report struct {
	Facts    Facts     `json:"facts"`
	Findings []Finding `json:"findings"`
	Took     string    `json:"took"`
}

// Check measures this computer and evaluates it, with text in lang.
func Check(ctx context.Context, lang string) Report {
	start := time.Now()
	f := Facts{Drives: sysinfo.Drives(), Memory: sysinfo.Mem(), Uptime: sysinfo.Uptime()}
	gather(ctx, &f)
	return Report{Facts: f, Findings: Evaluate(f, time.Now(), lang), Took: time.Since(start).Round(100 * time.Millisecond).String()}
}

// GB formats bytes for people, in English (the command line).
func GB(b int64) string { return i18n.Bytes("en", b) }

// Evaluate turns measurements into findings, most serious first.
func Evaluate(f Facts, now time.Time, lang string) []Finding {
	t := func(key string, vars ...any) string { return i18n.T(lang, key, vars...) }
	size := func(b int64) string { return i18n.Bytes(lang, b) }
	var out []Finding
	add := func(x Finding) { out = append(out, x) }

	for _, d := range f.Drives {
		if d.Total <= 0 {
			continue
		}
		pct := float64(d.Free) / float64(d.Total) * 100
		x := Finding{ID: "space:" + d.Path, Area: t("health.area.storage"), Title: t("health.space.title", "drive", d.Path),
			Detail: t("health.space.detail", "free", size(d.Free), "total", size(d.Total), "percent", i18n.Percent(pct)), Status: Good}
		switch {
		case pct < 5 || d.Free < 2<<30:
			x.Status = Problem
			x.Advice = t("health.space.advice.problem")
			x.Action = &Action{ID: "go:clean", Label: t("health.action.freeSpace")}
		case pct < 12 || d.Free < 10<<30:
			x.Status = Attention
			x.Advice = t("health.space.advice.attention")
			x.Action = &Action{ID: "go:clean", Label: t("health.action.freeSpace")}
		}
		add(x)
	}

	if f.Memory.Total > 0 {
		used := f.Memory.Total - f.Memory.Available
		pct := float64(used) / float64(f.Memory.Total) * 100
		x := Finding{ID: "memory", Area: t("health.area.performance"), Title: t("health.memory.title"), Status: Info,
			Detail: t("health.memory.detail", "used", size(used), "total", size(f.Memory.Total), "percent", i18n.Percent(pct))}
		if top := topNames(lang, f.Procs, 3); top != "" {
			x.Detail += " " + t("health.memory.largest", "list", top)
		}
		if pct >= 90 {
			x.Status = Attention
			x.Advice = t("health.memory.advice")
			x.Action = &Action{ID: "go:startup", Label: t("health.action.reviewStartup")}
		}
		add(x)
	}

	if f.Uptime > 0 {
		x := Finding{ID: "uptime", Area: t("health.area.updates"), Title: t("health.uptime.title"), Status: Good,
			Detail: t("health.uptime.detail", "duration", human(lang, f.Uptime))}
		if f.Uptime.Hours()/24 >= 14 {
			x.Status = Attention
			x.Advice = t("health.uptime.advice")
		}
		add(x)
	}

	if w := f.Windows; w != nil {
		evaluateWindows(w, now, lang, add)
	}

	rank := map[string]int{Problem: 0, Attention: 1, Info: 2, Good: 3}
	sort.SliceStable(out, func(i, j int) bool { return rank[out[i].Status] < rank[out[j].Status] })
	return out
}

func evaluateWindows(w *WinFacts, now time.Time, lang string, add func(Finding)) {
	t := func(key string, vars ...any) string { return i18n.T(lang, key, vars...) }
	security := t("health.area.security")
	openSecurity := &Action{ID: "open:security", Label: t("health.action.openSecurity")}

	// Protection: Microsoft Defender, or another antivirus Windows knows about.
	other := ""
	for _, a := range w.AV {
		// productState bits 12-13 (0x1000) mean "on"; Defender is reported separately.
		n := strings.ToLower(a.Name)
		if a.State&0x1000 != 0 && !strings.Contains(n, "windows defender") && !strings.Contains(n, "microsoft defender") {
			other = a.Name
		}
	}
	av := Finding{ID: "av", Area: security, Title: t("health.av.title")}
	switch d := w.Defender; {
	case other != "":
		av.Status, av.Detail = Good, t("health.av.other", "product", other)
	case d == nil:
		av.Status, av.Detail, av.Action = Info, t("health.av.unknown"), openSecurity
	case !d.AV || !d.RTP:
		av.Status, av.Detail, av.Advice, av.Action = Problem, t("health.av.off"), t("health.av.off.advice"), openSecurity
	case d.SigAge > 7:
		av.Status, av.Action = Attention, openSecurity
		av.Detail = i18n.N(lang, "health.av.stale", int64(d.SigAge))
		av.Advice = t("health.av.stale.advice")
	default:
		av.Status = Good
		av.Detail = t("health.av.ok", "age", i18n.N(lang, "unit.day", int64(d.SigAge)))
	}
	add(av)

	if len(w.Firewall) > 0 {
		var off []string
		for _, p := range w.Firewall {
			if !p.Enabled {
				off = append(off, firewallProfile(lang, p.Name))
			}
		}
		x := Finding{ID: "firewall", Area: security, Title: t("health.firewall.title"), Status: Good, Detail: t("health.firewall.ok")}
		if len(off) > 0 {
			x.Status = Problem
			x.Detail = t("health.firewall.off", "profiles", i18n.List(lang, off))
			x.Advice = t("health.firewall.advice")
			x.Action = &Action{ID: "open:firewall", Label: t("health.action.openFirewall")}
		}
		add(x)
	}

	for _, d := range w.Disks {
		state := strings.ToLower(d.Health)
		stateText := state
		if k := "health.disk.state." + state; i18n.Has(k) {
			stateText = t(k)
		}
		media := strings.TrimSpace(d.Media)
		if media == "" || strings.EqualFold(media, "Unspecified") {
			media = t("health.disk.media.unknown")
		}
		x := Finding{ID: "disk:" + d.Name, Area: t("health.area.storage"), Title: t("health.disk.title", "name", d.Name), Status: Good,
			Detail: t("health.disk.detail", "size", i18n.Bytes(lang, d.Size), "media", media, "state", stateText)}
		backup := &Action{ID: "open:backup", Label: t("health.action.openBackup")}
		switch state {
		case "healthy":
		case "warning":
			x.Status, x.Action = Problem, backup
			x.Advice = t("health.disk.warning", "status", d.Op)
		case "unhealthy":
			x.Status, x.Action = Problem, backup
			x.Advice = t("health.disk.unhealthy", "status", d.Op)
		default:
			x.Status = Info
		}
		add(x)
	}

	if w.RebootPending {
		add(Finding{ID: "reboot", Area: t("health.area.updates"), Title: t("health.reboot.title"), Status: Attention,
			Detail: t("health.reboot.detail"), Advice: t("health.reboot.advice")})
	}

	if ts, err := time.Parse(time.RFC3339, w.LastUpdate); err == nil {
		age := now.Sub(ts)
		x := Finding{ID: "updates", Area: t("health.area.updates"), Title: t("health.updates.title"), Status: Good,
			Detail: t("health.updates.detail", "duration", human(lang, age))}
		if age > 60*24*time.Hour {
			x.Status = Attention
			x.Advice = t("health.updates.advice")
			x.Action = &Action{ID: "open:windowsupdate", Label: t("health.action.openWindowsUpdate")}
		}
		add(x)
	}

	if b := w.Battery; b != nil && b.Design > 0 && b.Full > 0 {
		pct := math.Min(100, float64(b.Full)/float64(b.Design)*100)
		x := Finding{ID: "battery", Area: t("health.area.hardware"), Title: t("health.battery.title"), Status: Good,
			Detail: t("health.battery.detail", "percent", i18n.Percent(pct))}
		if pct < 60 {
			x.Status = Attention
			x.Advice = t("health.battery.advice")
		}
		add(x)
	}

	if s := w.StorageSense; s != nil && !*s {
		add(Finding{ID: "storagesense", Area: t("health.area.storage"), Title: t("health.storagesense.title"), Status: Info,
			Detail: t("health.storagesense.detail"), Advice: t("health.storagesense.advice"),
			Action: &Action{ID: "open:storagesense", Label: t("health.action.openStorageSense")}})
	}

	add(Finding{ID: "repair", Area: t("health.area.repair"), Title: t("health.repair.title"), Status: Info,
		Detail: t("health.repair.detail"), Advice: t("health.repair.advice"),
		Action: &Action{ID: "run:repair", Label: t("health.action.repair")}})
}

// firewallProfile names a firewall profile (Domain, Private, Public).
func firewallProfile(lang, name string) string {
	if k := "health.firewall.profile." + strings.ToLower(name); i18n.Has(k) {
		return i18n.T(lang, k)
	}
	return name
}

func topNames(lang string, ps []Proc, n int) string {
	var parts []string
	for i, p := range ps {
		if i == n {
			break
		}
		name := p.Name
		if p.Count > 1 {
			name += " ×" + i18n.Number(lang, int64(p.Count))
		}
		parts = append(parts, name+" "+i18n.Bytes(lang, p.Mem))
	}
	return strings.Join(parts, ", ")
}

// human says how long a duration is: "3 days", "5 hours", "20 minutes".
func human(lang string, d time.Duration) string {
	switch h := d.Hours(); {
	case h >= 48:
		return i18n.N(lang, "unit.day", int64(h/24))
	case h >= 2:
		return i18n.N(lang, "unit.hour", int64(h))
	default:
		return i18n.N(lang, "unit.minute", int64(d.Minutes()))
	}
}
