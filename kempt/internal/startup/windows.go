package startup

import (
	"context"
	"encoding/base64"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

// rawItem is what the listing script reports for one entry.
type rawItem struct {
	Source   string `json:"source"`
	Name     string `json:"name"`
	Command  string `json:"command"`
	Approved []byte `json:"approved"` // base64 in JSON
}

const listScript = `
function Approved($hive, $sub, $name) {
  try {
    $v = (Get-ItemProperty -LiteralPath "$hive\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\$sub" -Name $name -ErrorAction Stop).$name
    if ($v) { return [Convert]::ToBase64String([byte[]]$v) }
  } catch {}
  return $null
}
$out = New-Object System.Collections.ArrayList
$runs = @(
  @{hive='HKCU:'; key='Software\Microsoft\Windows\CurrentVersion\Run'; source='run-user'; approved='Run'},
  @{hive='HKLM:'; key='Software\Microsoft\Windows\CurrentVersion\Run'; source='run-machine'; approved='Run'},
  @{hive='HKLM:'; key='Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'; source='run-machine32'; approved='Run32'}
)
foreach ($r in $runs) {
  $path = $r.hive + '\' + $r.key
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $k = Get-Item -LiteralPath $path
  foreach ($n in $k.GetValueNames()) {
    if ($n -eq '') { continue }
    [void]$out.Add([pscustomobject]@{ source=$r.source; name=$n; command=[string]$k.GetValue($n); approved=(Approved $r.hive $r.approved $n) })
  }
}
$sh = New-Object -ComObject WScript.Shell
$folders = @(
  @{dir=[Environment]::GetFolderPath('Startup'); source='folder-user'; hive='HKCU:'},
  @{dir=[Environment]::GetFolderPath('CommonStartup'); source='folder-machine'; hive='HKLM:'}
)
foreach ($f in $folders) {
  if (-not $f.dir -or -not (Test-Path -LiteralPath $f.dir)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $f.dir -File -Force) {
    if ($file.Name -eq 'desktop.ini') { continue }
    $cmd = $file.FullName
    if ($file.Extension -eq '.lnk') {
      try { $l = $sh.CreateShortcut($file.FullName); if ($l.TargetPath) { $cmd = ('"' + $l.TargetPath + '" ' + $l.Arguments).Trim() } } catch {}
    }
    [void]$out.Add([pscustomobject]@{ source=$f.source; name=$file.Name; command=$cmd; approved=(Approved $f.hive 'StartupFolder' $file.Name) })
  }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress
`

const infoScript = `
$paths = %s
$r = @{}
foreach ($p in $paths) {
  try {
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      $r[$p] = @{ exists = $true; company = [string](Get-Item -LiteralPath $p).VersionInfo.CompanyName }
    } else { $r[$p] = @{ exists = $false } }
  } catch { $r[$p] = @{ exists = $true } }
}
ConvertTo-Json -InputObject $r -Compress
`

const setScript = `
$d = %s
if (-not (Test-Path -LiteralPath $d.key)) { New-Item -Path $d.key -Force | Out-Null }
New-ItemProperty -LiteralPath $d.key -Name $d.name -PropertyType Binary -Value ([Convert]::FromBase64String($d.value)) -Force | Out-Null
'{"ok":true}'
`

type fileInfo struct {
	Exists  bool   `json:"exists"`
	Company string `json:"company"`
}

// Windows reads and writes startup items through Windows PowerShell.
type Windows struct {
	Elevated bool
	// PS runs a script and decodes its JSON output; tests replace it.
	PS     func(ctx context.Context, script string, v any) error
	Getenv func(string) string
	Now    func() time.Time
}

// NewWindows uses the real PowerShell.
func NewWindows(elevated bool) *Windows {
	return &Windows{Elevated: elevated, PS: shell.PowerShellJSON, Getenv: os.Getenv, Now: time.Now}
}

func approvedKey(source string) (hive, sub string, admin bool) {
	switch source {
	case "run-user":
		return "HKCU:", "Run", false
	case "run-machine":
		return "HKLM:", "Run", true
	case "run-machine32":
		return "HKLM:", "Run32", true
	case "folder-user":
		return "HKCU:", "StartupFolder", false
	case "folder-machine":
		return "HKLM:", "StartupFolder", true
	}
	return "", "", true
}

func itemFromRaw(r rawItem, getenv func(string) string) Item {
	_, _, admin := approvedKey(r.Source)
	name := r.Name
	if strings.HasPrefix(r.Source, "folder-") {
		name = strings.TrimSuffix(strings.TrimSuffix(name, ".lnk"), ".LNK")
	}
	return Item{
		ID: r.Source + ":" + r.Name, Name: name, Command: r.Command,
		Path: ExePath(r.Command, getenv), Source: r.Source, Where: SourceLabel(r.Source),
		Enabled: ApprovedEnabled(r.Approved), Admin: admin,
	}
}

// List reads every startup item, then the publisher of each program.
func (w *Windows) List(ctx context.Context) ([]Item, error) {
	var raw []rawItem
	if err := w.PS(ctx, listScript, &raw); err != nil {
		return nil, err
	}
	items := make([]Item, 0, len(raw))
	var paths []string
	seen := map[string]bool{}
	for _, r := range raw {
		it := itemFromRaw(r, w.Getenv)
		items = append(items, it)
		if it.Path != "" && !seen[it.Path] {
			seen[it.Path] = true
			paths = append(paths, it.Path)
		}
	}
	if len(paths) > 0 {
		info := map[string]fileInfo{}
		if err := w.PS(ctx, sprintf(infoScript, shell.PSData(paths)), &info); err == nil {
			for i := range items {
				if fi, ok := info[items[i].Path]; ok {
					items[i].Publisher = strings.TrimSpace(fi.Company)
					items[i].Missing = !fi.Exists
				}
			}
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name) })
	return items, nil
}

// Set turns an item on or off.
func (w *Windows) Set(ctx context.Context, id string, enabled bool) (Item, error) {
	items, err := w.List(ctx)
	if err != nil {
		return Item{}, err
	}
	for _, it := range items {
		if it.ID != id {
			continue
		}
		hive, sub, admin := approvedKey(it.Source)
		if admin && !w.Elevated {
			return it, ErrNeedsAdmin
		}
		valueName := strings.TrimPrefix(id, it.Source+":")
		data := map[string]string{
			"key":   hive + `\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\` + sub,
			"name":  valueName,
			"value": base64.StdEncoding.EncodeToString(ApprovedValue(enabled, filetime(w.Now()))),
		}
		var ok map[string]bool
		if err := w.PS(ctx, sprintf(setScript, shell.PSData(data)), &ok); err != nil {
			return it, err
		}
		it.Enabled = enabled
		return it, nil
	}
	return Item{}, ErrNotFound
}

// filetime converts to 100-nanosecond intervals since 1 January 1601.
func filetime(t time.Time) uint64 {
	const epochDiff = 116444736000000000
	return uint64(t.UnixNano()/100) + epochDiff
}

func sprintf(format, arg string) string { return strings.Replace(format, "%s", arg, 1) }
