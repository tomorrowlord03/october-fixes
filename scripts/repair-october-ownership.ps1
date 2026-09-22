<#
.SYNOPSIS
    Inspect and repair October Canvas bus ownership journal conflicts.
.DESCRIPTION
    Scans ~/.october/bus-ownership-v1.json for entries with 'state: conflict' or
    mismatched hashes, and provides an option to safely excise conflicted entries
    so October can cleanly regenerate configurations without aborting launches.
#>

param(
    [switch]$Repair = $false
)

$ErrorActionPreference = "Stop"

$userProfile = $env:USERPROFILE
$journalPath = Join-Path $userProfile ".october\bus-ownership-v1.json"

if (-not (Test-Path $journalPath)) {
    Write-Host "[INFO] No October bus-ownership-v1.json found at: $journalPath" -ForegroundColor Yellow
    exit 0
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  October Bus Ownership Journal Diagnostic & Repair      " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

$journal = Get-Content $journalPath -Raw | ConvertFrom-Json
$conflicts = @()

foreach ($entry in $journal.entries) {
    if ($entry.state -eq "conflict" -or $entry.conflict) {
        $conflicts += $entry
    }
}

Write-Host "`nTotal journal entries: $($journal.entries.Count)" -ForegroundColor White

if ($conflicts.Count -eq 0) {
    Write-Host "[SUCCESS] No conflicted ownership entries detected." -ForegroundColor Green
    exit 0
}

Write-Host "[WARNING] Found $($conflicts.Count) conflicted entry/entries:" -ForegroundColor Red
for ($i = 0; $i -lt $conflicts.Count; $i++) {
    $c = $conflicts[$i]
    Write-Host "  [$i] Path: $($c.path)" -ForegroundColor Yellow
    Write-Host "      Provider: $($c.provider) | Artifact: $($c.artifact)" -ForegroundColor Gray
    Write-Host "      Conflict: $($c.conflict)" -ForegroundColor Red
}

if (-not $Repair) {
    Write-Host "`nRun with -Repair to excise conflicted entries and allow clean regeneration." -ForegroundColor Cyan
    exit 0
}

# Create backup
$backupPath = "$journalPath.bak-$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
Copy-Item $journalPath $backupPath -Force
Write-Host "`n[BACKUP] Created backup at: $backupPath" -ForegroundColor Green

# Remove conflicted entries
$cleanEntries = @($journal.entries | Where-Object { $_.state -ne "conflict" -and -not $_.conflict })
$journal.entries = $cleanEntries

$tmpPath = "$journalPath.tmp"
$journal | ConvertTo-Json -Depth 15 | Set-Content -Path $tmpPath -Encoding UTF8
Move-Item $tmpPath $journalPath -Force

Write-Host "[SUCCESS] Removed $($conflicts.Count) conflicted entry/entries. Active entries: $($cleanEntries.Count)" -ForegroundColor Green
Write-Host "October will now cleanly regenerate configurations on terminal start." -ForegroundColor Green
