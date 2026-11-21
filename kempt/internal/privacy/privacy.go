// Package privacy reads and changes the per-user Windows privacy and
// "suggestions" settings that the Settings app itself writes. Every switch
// says what it does and links to the page in Settings where it lives, so
// nothing is hidden and everything can be put back.
package privacy

import (
	"context"
	"errors"
	"runtime"

	"github.com/ZenZeiTen/synthapps/kempt/internal/i18n"
	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

// Setting is one switch. On is Windows' default behaviour; the private
// choice is usually Off.
type Setting struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	What     string   `json:"what"`
	Settings string   `json:"settings,omitempty"` // ms-settings: page
	Key      string   `json:"-"`
	Names    []string `json:"-"`
	OnValue  int      `json:"-"`
	OffValue int      `json:"-"`
	// MissingOn: when the value does not exist, Windows behaves as On.
	MissingOn bool `json:"-"`
	On        bool `json:"on"`
}

const cdm = `HKCU:\Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager`

// Catalog lists the switches Kempt offers, in English.
func Catalog() []Setting { return CatalogIn("en") }

// CatalogIn lists the switches with their text in a language.
func CatalogIn(lang string) []Setting {
	list := catalog()
	Localize(list, lang)
	return list
}

// Localize sets each switch's title and description in a language.
func Localize(list []Setting, lang string) {
	for i := range list {
		list[i].Title = i18n.T(lang, "priv."+list[i].ID+".title")
		list[i].What = i18n.T(lang, "priv."+list[i].ID+".what")
	}
}

func catalog() []Setting {
	return []Setting{
		{ID: "advertising-id", Settings: "ms-settings:privacy-general",
			Key: `HKCU:\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo`, Names: []string{"Enabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "language-list", Settings: "ms-settings:privacy-general",
			Key: `HKCU:\Control Panel\International\User Profile`, Names: []string{"HttpAcceptLanguageOptOut"},
			OnValue: 0, OffValue: 1, MissingOn: true},
		{ID: "app-launch-tracking", Settings: "ms-settings:privacy-general",
			Key: `HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced`, Names: []string{"Start_TrackProgs"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "tailored", Settings: "ms-settings:privacy-feedback",
			Key: `HKCU:\Software\Microsoft\Windows\CurrentVersion\Privacy`, Names: []string{"TailoredExperiencesWithDiagnosticDataEnabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "settings-suggestions", Settings: "ms-settings:privacy-general",
			Key: cdm, Names: []string{"SubscribedContent-338393Enabled", "SubscribedContent-353694Enabled", "SubscribedContent-353696Enabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "start-suggestions", Settings: "ms-settings:personalization-start",
			Key: cdm, Names: []string{"SubscribedContent-338388Enabled", "SystemPaneSuggestionsEnabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "tips", Settings: "ms-settings:notifications",
			Key: cdm, Names: []string{"SubscribedContent-338389Enabled", "SoftLandingEnabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "welcome", Settings: "ms-settings:notifications",
			Key: cdm, Names: []string{"SubscribedContent-310093Enabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "lockscreen-tips", Settings: "ms-settings:lockscreen",
			Key: cdm, Names: []string{"RotatingLockScreenOverlayEnabled", "SubscribedContent-338387Enabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
		{ID: "silent-installs", Key: cdm, Names: []string{"SilentInstalledAppsEnabled"},
			OnValue: 1, OffValue: 0, MissingOn: true},
	}
}

// Supported reports whether this system has these settings.
func Supported() bool { return runtime.GOOS == "windows" }

// ErrUnsupported means the system is not Windows.
var ErrUnsupported = errors.New("privacy settings are only available on Windows")

type ref struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

const readScript = `
$refs = %s
$out = New-Object System.Collections.ArrayList
foreach ($r in $refs) {
  $v = $null
  try { $v = [int](Get-ItemProperty -LiteralPath $r.key -Name $r.name -ErrorAction Stop).($r.name) } catch {}
  [void]$out.Add($v)
}
ConvertTo-Json -InputObject @($out) -Compress
`

const writeScript = `
$d = %s
foreach ($w in $d) {
  if (-not (Test-Path -LiteralPath $w.key)) { New-Item -Path $w.key -Force | Out-Null }
  New-ItemProperty -LiteralPath $w.key -Name $w.name -PropertyType DWord -Value ([int]$w.value) -Force | Out-Null
}
'{"ok":true}'
`

// PS runs a script and decodes its JSON. Tests replace it.
var PS = shell.PowerShellJSON

func sprintf(f, a string) string {
	for i := 0; i+1 < len(f); i++ {
		if f[i] == '%' && f[i+1] == 's' {
			return f[:i] + a + f[i+2:]
		}
	}
	return f
}

// Read returns every switch with its current state. A switch made of several
// values counts as On if any of them is on.
func Read(ctx context.Context) ([]Setting, error) {
	cat := Catalog()
	var refs []ref
	for _, s := range cat {
		for _, n := range s.Names {
			refs = append(refs, ref{s.Key, n})
		}
	}
	var vals []*int
	if err := PS(ctx, sprintf(readScript, shell.PSData(refs)), &vals); err != nil {
		return nil, err
	}
	i := 0
	for k := range cat {
		on := false
		for range cat[k].Names {
			var v *int
			if i < len(vals) {
				v = vals[i]
			}
			i++
			if (v == nil && cat[k].MissingOn) || (v != nil && *v != cat[k].OffValue) {
				on = true
			}
		}
		cat[k].On = on
	}
	return cat, nil
}

// Set turns one switch on or off.
func Set(ctx context.Context, id string, on bool) (Setting, error) {
	for _, s := range Catalog() {
		if s.ID != id {
			continue
		}
		val := s.OffValue
		if on {
			val = s.OnValue
		}
		var w []map[string]any
		for _, n := range s.Names {
			w = append(w, map[string]any{"key": s.Key, "name": n, "value": val})
		}
		var ok map[string]bool
		if err := PS(ctx, sprintf(writeScript, shell.PSData(w)), &ok); err != nil {
			return s, err
		}
		s.On = on
		return s, nil
	}
	return Setting{}, errors.New("unknown setting")
}
