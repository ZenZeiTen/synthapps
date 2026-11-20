// Package schedule runs automatic care with Windows Task Scheduler: a task
// for the signed-in user that starts "Kempt.exe care" daily or weekly. It
// needs no administrator rights and no background program of Kempt's own.
package schedule

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"runtime"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

// TaskName is the name in Task Scheduler's library.
const TaskName = "Kempt automatic care"

// Plan is when automatic care runs.
type Plan struct {
	Enabled   bool   `json:"enabled"`
	Frequency string `json:"frequency"` // "daily" or "weekly"
	Day       string `json:"day"`       // Monday ... Sunday, for weekly
	Time      string `json:"time"`      // HH:MM, 24-hour
	NextRun   string `json:"nextRun,omitempty"`
	LastRun   string `json:"lastRun,omitempty"`
	Command   string `json:"command,omitempty"`
}

// ErrUnsupported means there is no Task Scheduler.
var ErrUnsupported = errors.New("automatic care uses Windows Task Scheduler and is only available on Windows")

// Supported reports whether this system has Task Scheduler.
func Supported() bool { return runtime.GOOS == "windows" }

var (
	timeRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
	days   = map[string]bool{"Monday": true, "Tuesday": true, "Wednesday": true, "Thursday": true, "Friday": true, "Saturday": true, "Sunday": true}
)

// Validate checks a plan from the window.
func (p Plan) Validate() error {
	if !p.Enabled {
		return nil
	}
	if p.Frequency != "daily" && p.Frequency != "weekly" {
		return errors.New("choose daily or weekly")
	}
	if p.Frequency == "weekly" && !days[p.Day] {
		return errors.New("choose a day of the week")
	}
	if !timeRe.MatchString(p.Time) {
		return errors.New("give the time as HH:MM")
	}
	return nil
}

const queryScript = `
$t = Get-ScheduledTask -TaskName '` + TaskName + `' -ErrorAction SilentlyContinue
if (-not $t) { '{"enabled":false}'; return }
$i = $t | Get-ScheduledTaskInfo
$tr = $t.Triggers | Select-Object -First 1
$freq = 'daily'; $day = ''
if ($tr.CimClass.CimClassName -eq 'MSFT_TaskWeeklyTrigger') { $freq = 'weekly'; $day = [string]([System.DayOfWeek]([Math]::Log($tr.DaysOfWeek, 2))) }
$time = ''; if ($tr.StartBoundary) { $time = ([datetime]$tr.StartBoundary).ToString('HH:mm') }
$next = ''; if ($i.NextRunTime) { $next = $i.NextRunTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
$last = ''; if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $last = $i.LastRunTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
$cmd = ($t.Actions | Select-Object -First 1)
ConvertTo-Json -Compress -InputObject @{ enabled = ($t.State -ne 'Disabled'); frequency = $freq; day = $day; time = $time; nextRun = $next; lastRun = $last; command = ([string]$cmd.Execute + ' ' + [string]$cmd.Arguments).Trim() }
`

const registerScript = `
$d = %s
$a = New-ScheduledTaskAction -Execute $d.exe -Argument $d.args
$at = [datetime]::ParseExact($d.time, 'HH:mm', $null)
if ($d.frequency -eq 'weekly') { $tr = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $d.day -At $at } else { $tr = New-ScheduledTaskTrigger -Daily -At $at }
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName '` + TaskName + `' -Action $a -Trigger $tr -Settings $s -Description 'Removes caches and leftovers with Kempt. Delete this task, or turn automatic care off in Kempt, to stop it.' -Force | Out-Null
'{"ok":true}'
`

const deleteScript = `
Unregister-ScheduledTask -TaskName '` + TaskName + `' -Confirm:$false -ErrorAction SilentlyContinue
'{"ok":true}'
`

// PS runs a script and decodes its JSON. Tests replace it.
var PS = shell.PowerShellJSON

// Get reads the task, if there is one.
func Get(ctx context.Context) (Plan, error) {
	if !Supported() {
		return Plan{}, ErrUnsupported
	}
	var p Plan
	err := PS(ctx, queryScript, &p)
	return p, err
}

// Apply creates, replaces or removes the task. exe is Kempt's own program
// and args what it is started with, e.g. care --data "C:\...".
func Apply(ctx context.Context, p Plan, exe, args string) (Plan, error) {
	if !Supported() {
		return Plan{}, ErrUnsupported
	}
	if err := p.Validate(); err != nil {
		return p, err
	}
	var ok map[string]bool
	if !p.Enabled {
		if err := PS(ctx, deleteScript, &ok); err != nil {
			return p, err
		}
		return Plan{Enabled: false}, nil
	}
	data := map[string]string{"exe": exe, "args": args, "time": p.Time, "frequency": p.Frequency, "day": p.Day}
	if err := PS(ctx, fmt.Sprintf(registerScriptFmt(), shell.PSData(data)), &ok); err != nil {
		return p, err
	}
	return Get(ctx)
}

// registerScriptFmt escapes the script's own percent signs for Sprintf.
func registerScriptFmt() string {
	out := make([]byte, 0, len(registerScript))
	for i := 0; i < len(registerScript); i++ {
		c := registerScript[i]
		if c == '%' && !(i+1 < len(registerScript) && registerScript[i+1] == 's') {
			out = append(out, '%', '%')
			continue
		}
		out = append(out, c)
	}
	return string(out)
}
