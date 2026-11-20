# End-to-end checks of the Unreal build, the same checks as hyper-bluff/godot/tests/harness.sh
# plus the Director's Cut ones (retake, episode titles, mini-boss). The check list is
# ..\tests\harness_checks.tsv, written by the Linux app tests (tests/run_all.sh), so both runs
# use the same scripts and regexes.
#
# Usage (PowerShell, from anywhere):
#   powershell -ExecutionPolicy Bypass -File hyper-bluff-ue\tools\harness.ps1
#   ... -Only "retake"                       # run matching checks only
#   ... -Exe "C:\...\dist\Windows\HyperBluff.exe"   # run against the packaged game
# Environment: UE_ROOT (default C:\Program Files\Epic Games\UE_5.8).
# Prints "ok   name" / "FAIL name" per check and "HARNESS n failure(s)"; exit code = failures.
param(
    [string]$Only = "",
    [string]$Exe = "",
    [int]$TimeoutSec = 300
)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Project = Join-Path $Root "HyperBluff.uproject"
$Checks = Join-Path $Root "tests\harness_checks.tsv"
$UeRoot = if ($env:UE_ROOT) { $env:UE_ROOT } else { "C:\Program Files\Epic Games\UE_5.8" }
$Editor = Join-Path $UeRoot "Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
$Tmp = Join-Path $env:TEMP "hyperbluff_harness"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

if ($Exe -eq "" -and -not (Test-Path $Editor)) { Write-Host "UnrealEditor-Cmd.exe not found at $Editor (set UE_ROOT)"; exit 99 }
if (-not (Test-Path $Checks)) { Write-Host "missing $Checks"; exit 99 }

$fails = 0
$n = 0
foreach ($row in Get-Content -LiteralPath $Checks) {
    if ($row.StartsWith("#") -or $row.Trim() -eq "") { continue }
    $parts = $row.Split("`t")
    $name = $parts[0]; $want = $parts[1]; $script = $parts[2]
    if ($Only -ne "" -and $name -notmatch $Only) { continue }
    $n++
    $out = Join-Path $Tmp "out_$n.txt"
    $err = Join-Path $Tmp "err_$n.txt"
    $log = Join-Path $Tmp "log_$n.txt"
    Remove-Item -ErrorAction SilentlyContinue $out, $err, $log
    $common = "-nullrhi -nosound -unattended -nosplash -nopause -stdout -FullStdOutLogOutput -abslog=`"$log`" `"-HBScript=$script`""
    if ($Exe -ne "") {
        $file = $Exe; $arguments = $common
    } else {
        $file = $Editor; $arguments = "`"$Project`" -game $common"
    }
    $p = Start-Process -FilePath $file -ArgumentList $arguments -NoNewWindow -PassThru `
        -RedirectStandardOutput $out -RedirectStandardError $err
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch {}
        Write-Host "FAIL $name (timed out after $TimeoutSec s)"; $fails++; continue
    }
    $lines = @()
    if (Test-Path $out) { $lines += Get-Content -LiteralPath $out }
    # Lines the game printed with printf start with "DUMP "; the log has them after "LogHB: Display: ".
    $dumps = @($lines | Where-Object { $_ -match '^DUMP ' } | ForEach-Object { $_.Substring(5) })
    $problems = @($lines | Where-Object { $_ -match '^HARNESS' })
    if ($dumps.Count -eq 0 -and (Test-Path $log)) {
        $logLines = Get-Content -LiteralPath $log
        $dumps = @($logLines | Where-Object { $_ -match 'LogHB: Display: DUMP ' } | ForEach-Object { ($_ -split 'LogHB: Display: DUMP ', 2)[1] })
        $problems = @($logLines | Where-Object { $_ -match 'LogHB: Display: HARNESS' })
    }
    if ($problems.Count -gt 0) {
        Write-Host "FAIL $name : $($problems[0..2] -join ' | ')"; $fails++; continue
    }
    $got = ($dumps | ForEach-Object { "$_;" }) -join ""
    if ($got -cmatch $want) {
        Write-Host "ok   $name"
    } else {
        Write-Host "FAIL $name"; Write-Host "  got:  $got"; Write-Host "  want: $want"; $fails++
    }
}
if ($n -eq 0) { Write-Host "no checks matched"; exit 99 }
Write-Host "HARNESS $fails failure(s)"
exit $fails
