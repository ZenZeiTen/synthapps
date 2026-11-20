// Package health checks the things that really decide whether a computer
// is in good shape: free disk space, drive health, security protection,
// updates, a pending restart, battery wear and memory pressure. Each finding
// says what was measured, what it means, and what to do.
package health

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

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

// Check measures this computer and evaluates it.
func Check(ctx context.Context) Report {
	start := time.Now()
	f := Facts{Drives: sysinfo.Drives(), Memory: sysinfo.Mem(), Uptime: sysinfo.Uptime()}
	gather(ctx, &f)
	return Report{Facts: f, Findings: Evaluate(f, time.Now()), Took: time.Since(start).Round(100 * time.Millisecond).String()}
}

// GB formats bytes for people.
func GB(b int64) string {
	switch {
	case b >= 1<<30:
		return fmt.Sprintf("%.1f GB", float64(b)/(1<<30))
	case b >= 1<<20:
		return fmt.Sprintf("%.0f MB", float64(b)/(1<<20))
	default:
		return fmt.Sprintf("%.0f KB", float64(b)/(1<<10))
	}
}

// Evaluate turns measurements into findings, most serious first.
func Evaluate(f Facts, now time.Time) []Finding {
	var out []Finding
	add := func(x Finding) { out = append(out, x) }

	for _, d := range f.Drives {
		if d.Total <= 0 {
			continue
		}
		pct := float64(d.Free) / float64(d.Total) * 100
		x := Finding{ID: "space:" + d.Path, Area: "Storage", Title: "Free space on " + d.Path,
			Detail: fmt.Sprintf("%s free of %s (%.0f%%).", GB(d.Free), GB(d.Total), pct), Status: Good}
		switch {
		case pct < 5 || d.Free < 2<<30:
			x.Status = Problem
			x.Advice = "Windows needs free space for updates, the page file and temporary files. Clean caches, then look at your largest files."
			x.Action = &Action{ID: "go:clean", Label: "Free up space"}
		case pct < 12 || d.Free < 10<<30:
			x.Status = Attention
			x.Advice = "Getting low. Cleaning caches and old downloads usually gives back several gigabytes."
			x.Action = &Action{ID: "go:clean", Label: "Free up space"}
		}
		add(x)
	}

	if f.Memory.Total > 0 {
		used := f.Memory.Total - f.Memory.Available
		pct := float64(used) / float64(f.Memory.Total) * 100
		x := Finding{ID: "memory", Area: "Performance", Title: "Memory in use", Status: Info,
			Detail: fmt.Sprintf("%s of %s in use (%.0f%%).", GB(used), GB(f.Memory.Total), pct)}
		if top := topNames(f.Procs, 3); top != "" {
			x.Detail += " Largest: " + top + "."
		}
		if pct >= 90 {
			x.Status = Attention
			x.Advice = "Memory is nearly full, so Windows is moving data to disk, which feels slow. Close programs you are not using, or turn off startup programs you do not need. Tools that \"free RAM\" only empty Windows' own cache, which makes things slower afterwards."
			x.Action = &Action{ID: "go:startup", Label: "Review startup programs"}
		}
		add(x)
	}

	if f.Uptime > 0 {
		days := f.Uptime.Hours() / 24
		x := Finding{ID: "uptime", Area: "Updates", Title: "Time since last restart", Status: Good,
			Detail: fmt.Sprintf("%s.", human(f.Uptime))}
		if days >= 14 {
			x.Status = Attention
			x.Advice = "Restarting finishes installing updates and clears programs that slowly use more memory. With Fast Startup on, shutting down is not a restart: choose Restart."
		}
		add(x)
	}

	if w := f.Windows; w != nil {
		evaluateWindows(w, now, add)
	}

	rank := map[string]int{Problem: 0, Attention: 1, Info: 2, Good: 3}
	sort.SliceStable(out, func(i, j int) bool { return rank[out[i].Status] < rank[out[j].Status] })
	return out
}

func evaluateWindows(w *WinFacts, now time.Time, add func(Finding)) {
	// Protection: Microsoft Defender, or another antivirus Windows knows about.
	other := ""
	for _, a := range w.AV {
		// productState bits 12-13 (0x1000) mean "on"; Defender is reported separately.
		n := strings.ToLower(a.Name)
		if a.State&0x1000 != 0 && !strings.Contains(n, "windows defender") && !strings.Contains(n, "microsoft defender") {
			other = a.Name
		}
	}
	switch d := w.Defender; {
	case other != "":
		add(Finding{ID: "av", Area: "Security", Title: "Virus protection", Status: Good,
			Detail: other + " is protecting this computer."})
	case d == nil:
		add(Finding{ID: "av", Area: "Security", Title: "Virus protection", Status: Info,
			Detail: "Kempt could not read the protection status.", Action: &Action{ID: "open:security", Label: "Open Windows Security"}})
	case !d.AV || !d.RTP:
		add(Finding{ID: "av", Area: "Security", Title: "Virus protection", Status: Problem,
			Detail: "Real-time protection is off.", Advice: "Turn it back on in Windows Security. It is free and built in; no extra antivirus is needed.",
			Action: &Action{ID: "open:security", Label: "Open Windows Security"}})
	case d.SigAge > 7:
		add(Finding{ID: "av", Area: "Security", Title: "Virus protection", Status: Attention,
			Detail: fmt.Sprintf("Microsoft Defender is on, but its virus definitions are %d days old.", d.SigAge),
			Advice: "Connect to the internet and run Windows Update; definitions normally update every day.",
			Action: &Action{ID: "open:security", Label: "Open Windows Security"}})
	default:
		add(Finding{ID: "av", Area: "Security", Title: "Virus protection", Status: Good,
			Detail: fmt.Sprintf("Microsoft Defender is on; definitions are %s old.", plural(d.SigAge, "day"))})
	}

	if len(w.Firewall) > 0 {
		var off []string
		for _, p := range w.Firewall {
			if !p.Enabled {
				off = append(off, p.Name)
			}
		}
		x := Finding{ID: "firewall", Area: "Security", Title: "Firewall", Status: Good, Detail: "On for every network type."}
		if len(off) > 0 {
			x.Status = Problem
			x.Detail = "Off for: " + strings.Join(off, ", ") + "."
			x.Advice = "The Windows firewall blocks unwanted incoming connections. Turn it on unless another firewall replaces it."
			x.Action = &Action{ID: "open:firewall", Label: "Open firewall settings"}
		}
		add(x)
	}

	for _, d := range w.Disks {
		x := Finding{ID: "disk:" + d.Name, Area: "Storage", Title: "Drive health: " + d.Name, Status: Good,
			Detail: fmt.Sprintf("%s %s, reported %s.", GB(d.Size), strings.TrimSpace(d.Media), strings.ToLower(d.Health))}
		switch strings.ToLower(d.Health) {
		case "healthy":
		case "warning":
			x.Status = Problem
			x.Advice = "The drive reports early signs of failure (" + d.Op + "). Back up your files now, then plan to replace it."
			x.Action = &Action{ID: "open:backup", Label: "Open backup settings"}
		case "unhealthy":
			x.Status = Problem
			x.Advice = "The drive reports that it is failing (" + d.Op + "). Copy your important files somewhere else today."
			x.Action = &Action{ID: "open:backup", Label: "Open backup settings"}
		default:
			x.Status = Info
		}
		add(x)
	}

	if w.RebootPending {
		add(Finding{ID: "reboot", Area: "Updates", Title: "Restart needed", Status: Attention,
			Detail: "Windows has installed updates that finish on the next restart.",
			Advice: "Save your work and restart when convenient."})
	}

	if t, err := time.Parse(time.RFC3339, w.LastUpdate); err == nil {
		age := now.Sub(t)
		x := Finding{ID: "updates", Area: "Updates", Title: "Windows updates", Status: Good,
			Detail: "Last update installed " + human(age) + " ago."}
		if age > 60*24*time.Hour {
			x.Status = Attention
			x.Advice = "Windows normally installs security updates every month. Check Windows Update for anything stuck or paused."
			x.Action = &Action{ID: "open:windowsupdate", Label: "Open Windows Update"}
		}
		add(x)
	}

	if b := w.Battery; b != nil && b.Design > 0 && b.Full > 0 {
		pct := math.Min(100, float64(b.Full)/float64(b.Design)*100)
		x := Finding{ID: "battery", Area: "Hardware", Title: "Battery wear", Status: Good,
			Detail: fmt.Sprintf("The battery holds %.0f%% of its original charge.", pct)}
		if pct < 60 {
			x.Status = Attention
			x.Advice = "A battery below about 60% of its design capacity runs out much sooner. Replacing it restores the running time; software cannot."
		}
		add(x)
	}

	if s := w.StorageSense; s != nil && !*s {
		add(Finding{ID: "storagesense", Area: "Storage", Title: "Storage Sense", Status: Info,
			Detail: "Off. Storage Sense is Windows' own automatic cleanup of temporary files and the Recycle Bin.",
			Advice: "Turning it on is a good, free complement to Kempt.", Action: &Action{ID: "open:storagesense", Label: "Open Storage Sense"}})
	}

	add(Finding{ID: "repair", Area: "Repair", Title: "System file check", Status: Info,
		Detail: "If Windows itself misbehaves (settings that will not open, crashes in Windows components), its own repair tools check every system file against a known-good copy.",
		Advice: "This runs System File Checker and DISM in a window you can watch. It takes 10 to 30 minutes and needs administrator rights.",
		Action: &Action{ID: "run:repair", Label: "Check and repair Windows"}})
}

func topNames(ps []Proc, n int) string {
	var parts []string
	for i, p := range ps {
		if i == n {
			break
		}
		name := p.Name
		if p.Count > 1 {
			name += fmt.Sprintf(" ×%d", p.Count)
		}
		parts = append(parts, fmt.Sprintf("%s %s", name, GB(p.Mem)))
	}
	return strings.Join(parts, ", ")
}

func plural(n int, unit string) string {
	if n == 1 {
		return "1 " + unit
	}
	return fmt.Sprintf("%d %ss", n, unit)
}

func human(d time.Duration) string {
	switch h := d.Hours(); {
	case h >= 48:
		return plural(int(h/24), "day")
	case h >= 2:
		return plural(int(h), "hour")
	default:
		return plural(int(d.Minutes()), "minute")
	}
}
