$supaUrl = "https://hncvsextwmvjydcukdwx.supabase.co"
$supaKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$headers = @{
    "apikey" = $supaKey
    "Authorization" = "Bearer $supaKey"
}

$ids = "d1b4c77d-7872-434b-98b6-8e958bcc9073,1c9b87ea-ad51-40ac-87e4-dd0365b0a47e,3fe82029-7adc-4c60-8c0c-285b049a1a56,35222a1a-5563-46d0-a66c-13859c2124b8,7dd17cc1-36b3-43ea-9e6e-b1b52476534a,4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd"
$url = "$supaUrl/rest/v1/inbox_attachments?select=file_name,candidate_id,linked_candidate_id&id=in.($ids)"

Write-Host "Checking attachment statuses..."
$results = Invoke-RestMethod $url -Headers $headers

$extracted = 0
$stuck = 0
foreach ($r in $results) {
    $status = if ($r.candidate_id -or $r.linked_candidate_id) { "EXTRACTED ✅"; $extracted++ } else { "STUCK     ⏳"; $stuck++ }
    Write-Host "$status | $($r.file_name)"
}

Write-Host ""
Write-Host "$extracted/6 extracted, $stuck/6 still stuck"

# Also check queue
$queueResult = Invoke-RestMethod "https://recruitment-portal-backend-production-d1f7.up.railway.app/api/health/queue"
Write-Host "Queue: waiting=$($queueResult.queue.counts.waiting) active=$($queueResult.queue.counts.active) completed=$($queueResult.queue.counts.completed) failed=$($queueResult.queue.counts.failed)"
