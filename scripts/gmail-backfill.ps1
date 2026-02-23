######################################################################
#  Gmail Historical Backfill - Trigger & Monitor
#
#  Usage:
#    # Process ALL historical emails (can take hours for large inboxes)
#    .\scripts\gmail-backfill.ps1 -AdminSecret "your_secret"
#
#    # Process only emails from 2024 onwards
#    .\scripts\gmail-backfill.ps1 -AdminSecret "your_secret" -AfterDate "2024-01-01"
#
#    # Dry-run: just check how many emails will be found (maxTotal=1)
#    .\scripts\gmail-backfill.ps1 -AdminSecret "your_secret" -MaxTotal 1
#
#    # Cancel a running backfill
#    .\scripts\gmail-backfill.ps1 -AdminSecret "your_secret" -Cancel
######################################################################

param(
    [string]$AdminSecret  = "",
    [string]$BackendUrl   = "https://recruitment-portal-backend-production-d1f7.up.railway.app",
    [string]$AfterDate    = "",        # e.g. "2024-01-01"
    [string]$BeforeDate   = "",        # e.g. "2026-01-01"
    [int]$BatchSize       = 100,
    [int]$MaxTotal        = 10000,
    [int]$DelayMs         = 250,       # ms between messages — increase to avoid rate limits
    [switch]$Cancel       = $false,    # cancel running backfill
    [switch]$StatusOnly   = $false     # just check status without starting
)

if (-not $AdminSecret) {
    Write-Host "❌ Missing -AdminSecret parameter" -ForegroundColor Red
    Write-Host "   Usage: .\gmail-backfill.ps1 -AdminSecret 'your_admin_secret'"
    exit 1
}

$H = @{ "x-admin-token" = $AdminSecret; "Content-Type" = "application/json" }
$BASE = "$BackendUrl/api/gmail-admin"

function Show-Status {
    $s = Invoke-RestMethod -Uri "$BASE/backfill/status" -Headers $H -TimeoutSec 10
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Gmail Backfill Status" -ForegroundColor Cyan
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  Running   : $($s.running)"
    Write-Host "  Mode      : $($s.mode)"
    Write-Host "  Started   : $($s.startedAt)"
    Write-Host "  Finished  : $($s.finishedAt)"
    Write-Host "  AfterDate : $($s.afterDate)"
    Write-Host ""
    Write-Host "  Discovered: $($s.discovered)" -ForegroundColor Yellow
    Write-Host "  Processed : $($s.processed)" -ForegroundColor Green
    Write-Host "  Skipped   : $($s.skipped)" -ForegroundColor Gray
    Write-Host "  Errors    : $($s.errors)" -ForegroundColor $(if($s.errors -gt 0){"Red"}else{"Green"})
    Write-Host "  Progress  : $($s.progressPct)%"
    Write-Host "  ETA       : $($s.eta)"
    if ($s.lastError) {
        Write-Host "  Last Error: $($s.lastError)" -ForegroundColor Red
    }
    Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
    return $s
}

# First: test connection
Write-Host "`nChecking Gmail connection..." -ForegroundColor Gray
try {
    $status = Invoke-RestMethod -Uri "$BASE/status" -Headers $H -TimeoutSec 10
    $gmailOk = $status.gmail.ok
    Write-Host "  Gmail account : $($status.gmail.email)" -ForegroundColor $(if($gmailOk){"Green"}else{"Red"})
    Write-Host "  Client ID     : $($status.credentials.clientId)"
    Write-Host "  Refresh Token : $($status.credentials.refreshToken)"
    Write-Host "  Polling       : $($status.polling.enabled)"
    if (-not $gmailOk) {
        Write-Host "`n❌ Gmail connection failed: $($status.gmail.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Cannot reach backend: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

if ($StatusOnly) {
    Show-Status
    exit 0
}

if ($Cancel) {
    Write-Host "`nCancelling backfill..." -ForegroundColor Yellow
    Invoke-RestMethod -Uri "$BASE/backfill/cancel" -Method POST -Headers $H -TimeoutSec 10 | Out-Null
    Show-Status
    exit 0
}

# Start backfill
Write-Host "`nStarting historical Gmail backfill..." -ForegroundColor Cyan
Write-Host "  AfterDate : $(if($AfterDate){"$AfterDate"}else{"all history"})"
Write-Host "  BeforeDate: $(if($BeforeDate){"$BeforeDate"}else{"now"})"
Write-Host "  BatchSize : $BatchSize"
Write-Host "  MaxTotal  : $MaxTotal"
Write-Host "  DelayMs   : $DelayMs ms"
Write-Host ""

$Body = @{
    afterDate  = if ($AfterDate)  { $AfterDate }  else { $null }
    beforeDate = if ($BeforeDate) { $BeforeDate } else { $null }
    batchSize  = $BatchSize
    maxTotal   = $MaxTotal
    delayMs    = $DelayMs
} | ConvertTo-Json

try {
    $start = Invoke-RestMethod -Uri "$BASE/backfill/start" -Method POST -Headers $H -Body $Body -TimeoutSec 15
    Write-Host "✅ Backfill started!" -ForegroundColor Green
    Write-Host "   $($start.tip)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Failed to start backfill: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Poll progress every 10 seconds until done
Write-Host "`nPolling progress (Ctrl+C to stop watching, backfill continues on server)..." -ForegroundColor Gray
$lastProcessed = 0

while ($true) {
    Start-Sleep 10
    try {
        $s = Show-Status
        if (-not $s.running) {
            Write-Host "`n✅ Backfill finished!" -ForegroundColor Green
            Write-Host "  Processed: $($s.processed) new emails → CV parsing queue" -ForegroundColor Green
            Write-Host "  Skipped  : $($s.skipped) (already in DB)" -ForegroundColor Gray
            Write-Host "  Errors   : $($s.errors)" -ForegroundColor $(if($s.errors -gt 0){"Red"}else{"Green"})
            break
        }
    } catch {
        Write-Host "⚠ Status check failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}
