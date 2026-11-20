//go:build windows

package health

import (
	"context"
	"time"

	"github.com/ZenZeiTen/synthapps/kempt/internal/shell"
)

const script = `
$r = [ordered]@{}
try { $os = Get-CimInstance Win32_OperatingSystem; $r.os = @{ caption = [string]$os.Caption; version = [string]$os.Version; build = [string]$os.BuildNumber } } catch {}
try { $m = Get-MpComputerStatus; $r.defender = @{ av = [bool]$m.AntivirusEnabled; rtp = [bool]$m.RealTimeProtectionEnabled; sigAge = [int]$m.AntivirusSignatureAge; quickAge = [int]$m.QuickScanAge } } catch {}
try { $r.av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction Stop | ForEach-Object { @{ name = [string]$_.displayName; state = [int]$_.productState } }) } catch {}
try { $r.firewall = @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { @{ name = [string]$_.Name; enabled = ([string]$_.Enabled -eq 'True') } }) } catch {}
try { $r.disks = @(Get-PhysicalDisk -ErrorAction Stop | ForEach-Object { @{ name = [string]$_.FriendlyName; media = [string]$_.MediaType; health = [string]$_.HealthStatus; op = [string]($_.OperationalStatus -join ', '); size = [int64]$_.Size } }) } catch {}
$r.rebootPending = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
try {
  $hf = Get-HotFix -ErrorAction Stop | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
  if ($hf) { $r.lastUpdate = ([datetime]$hf.InstalledOn).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
} catch {}
try {
  $full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction Stop | Select-Object -First 1).FullChargedCapacity
  $design = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData -ErrorAction Stop | Select-Object -First 1).DesignedCapacity
  if ($full -and $design) { $r.battery = @{ full = [int64]$full; design = [int64]$design } }
} catch {}
try { $v = (Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy' -Name '01' -ErrorAction Stop).'01'; $r.storageSense = ([int]$v -eq 1) } catch { $r.storageSense = $false }
try {
  $r.procs = @(Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; mem = [int64](($_.Group | Measure-Object WorkingSet64 -Sum).Sum); count = [int]$_.Count } } | Sort-Object mem -Descending | Select-Object -First 8)
} catch {}
ConvertTo-Json -InputObject $r -Depth 4 -Compress
`

func gather(ctx context.Context, f *Facts) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var w WinFacts
	if err := shell.PowerShellJSON(ctx, script, &w); err != nil {
		return
	}
	f.Windows = &w
	f.Procs = w.Procs
}
