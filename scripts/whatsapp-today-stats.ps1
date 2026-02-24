$SUPABASE_URL = "https://hncvsextwmvjydcukdwx.supabase.co"
$SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$H = @{ "apikey" = $SERVICE_KEY; "Authorization" = "Bearer $SERVICE_KEY" }
$TODAY = "2026-02-23T00:00:00.000Z"

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "   WHATSAPP DAILY REPORT - 23 Feb 2026" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# ── 1. All WhatsApp inbox messages today ──────────────────────────────
$msgs = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/inbox_messages?created_at=gte.$TODAY&order=created_at.asc" -Headers $H
$waMsgs = $msgs | Where-Object { $_.source -eq 'whatsapp' }
Write-Host "`n[MESSAGES] Total WhatsApp messages today: $($waMsgs.Count)" -ForegroundColor Yellow
$waMsgs | Group-Object status | ForEach-Object { Write-Host "  status=$($_.Name): $($_.Count)" }

# ── 2. All WhatsApp attachments today ─────────────────────────────────
$atts = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/inbox_attachments?created_at=gte.$TODAY&order=created_at.asc" -Headers $H
$waAtts = $atts | Where-Object { $_.message_source -eq 'whatsapp' }
Write-Host "`n[ATTACHMENTS] Total WhatsApp attachments today: $($waAtts.Count)" -ForegroundColor Yellow

if ($waAtts.Count -gt 0) {
    Write-Host "`n  By type:" -ForegroundColor Gray
    $waAtts | Group-Object attachment_type | ForEach-Object { Write-Host "    $($_.Name.PadRight(12)): $($_.Count)" }

    Write-Host "`n  By MIME type:" -ForegroundColor Gray
    $waAtts | Group-Object mime_type | ForEach-Object { Write-Host "    $($_.Name): $($_.Count)" }

    Write-Host "`n  Candidate linking:" -ForegroundColor Gray
    $linked   = ($waAtts | Where-Object { $_.candidate_id }).Count
    $unlinked = ($waAtts | Where-Object { !$_.candidate_id }).Count
    Write-Host "    Linked  (candidate_id set): $linked"
    Write-Host "    Unlinked (no candidate_id): $unlinked"

    Write-Host "`n  Detail per attachment:" -ForegroundColor Gray
    $waAtts | ForEach-Object {
        $cand = if ($_.candidate_id) { "✅ $($_.candidate_id.Substring(0,8))" } else { "❌ none" }
        $time = if ($_.created_at.Length -ge 19) { $_.created_at.Substring(11,8) } else { "?" }
        Write-Host "    $time | $($_.attachment_type.PadRight(10)) | $($_.mime_type.PadRight(30)) | cand=$cand | $($_.file_name)"
    }
}

# ── 3. Parsing jobs today ──────────────────────────────────────────────
$pjAll = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/parsing_jobs?created_at=gte.$TODAY&order=created_at.asc" -Headers $H
Write-Host "`n[PARSING JOBS] Total today: $($pjAll.Count)" -ForegroundColor Yellow
$pjAll | Group-Object status | ForEach-Object { Write-Host "  $($_.Name.PadRight(15)): $($_.Count)" }

# ── 4. Failed parsing jobs with error messages ─────────────────────────
$failed = $pjAll | Where-Object { $_.status -eq 'failed' -or $_.status -eq 'error' }
if ($failed.Count -gt 0) {
    Write-Host "`n[FAILURES] $($failed.Count) failed parsing jobs:" -ForegroundColor Red
    $failed | ForEach-Object {
        $att = $waAtts | Where-Object { $_.id -eq $_.attachment_id }
        $time = if ($_.created_at.Length -ge 19) { $_.created_at.Substring(11,8) } else { "?" }
        Write-Host "  ❌ $time | attachment=$($_.attachment_id) | $($_.error_message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n[FAILURES] No failed parsing jobs today ✅" -ForegroundColor Green
}

# ── 5. Queue snapshot via Railway API ─────────────────────────────────
Write-Host "`n[QUEUE] Checking BullMQ queue status..." -ForegroundColor Yellow
$BACKEND = "https://recruitment-portal-backend-production-d1f7.up.railway.app"
try {
    $q = Invoke-RestMethod -Uri "$BACKEND/api/queue/status" -TimeoutSec 10
    Write-Host "  cv-parsing queue:"
    Write-Host "    waiting  : $($q.waiting)"
    Write-Host "    active   : $($q.active)"
    Write-Host "    completed: $($q.completed)"
    Write-Host "    failed   : $($q.failed)"
    Write-Host "    delayed  : $($q.delayed)"
} catch {
    Write-Host "  Could not reach queue endpoint: $_" -ForegroundColor DarkYellow
}

# ── 6. All-time summary for context ───────────────────────────────────
$allAtts = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/inbox_attachments?message_source=eq.whatsapp&order=created_at.desc&limit=1000" -Headers $H
Write-Host "`n[ALL TIME WA ATTACHMENTS] Total: $($allAtts.Count)" -ForegroundColor Yellow
$allAtts | Group-Object attachment_type | ForEach-Object { Write-Host "  $($_.Name.PadRight(12)): $($_.Count)" }
$linkedAll   = ($allAtts | Where-Object { $_.candidate_id }).Count
$unlinkedAll = ($allAtts | Where-Object { !$_.candidate_id }).Count
Write-Host "  Linked  : $linkedAll"
Write-Host "  Unlinked: $unlinkedAll"

# ── 7. All-time parsing job summary ───────────────────────────────────
$allPj = Invoke-RestMethod -Uri "$SUPABASE_URL/rest/v1/parsing_jobs?order=created_at.desc&limit=1000" -Headers $H
Write-Host "`n[ALL TIME PARSING JOBS] Total: $($allPj.Count)" -ForegroundColor Yellow
$allPj | Group-Object status | ForEach-Object { Write-Host "  $($_.Name.PadRight(15)): $($_.Count)" }

$allFailed = $allPj | Where-Object { $_.status -eq 'failed' -or $_.status -eq 'error' }
if ($allFailed.Count -gt 0) {
    Write-Host "`n  Top failure reasons (all time):" -ForegroundColor Red
    $allFailed | Group-Object error_message | Sort-Object Count -Descending | Select-Object -First 10 | ForEach-Object {
        $msg = if ($_.Name.Length -gt 80) { $_.Name.Substring(0,80) + "..." } else { $_.Name }
        Write-Host "    [$($_.Count)x] $msg" -ForegroundColor Red
    }
}

Write-Host "`n============================================================" -ForegroundColor Cyan
Write-Host "   DONE" -ForegroundColor Cyan
Write-Host "============================================================`n" -ForegroundColor Cyan
