$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

# Get storage info for stuck attachments
$ids = "1c9b87ea-ad51-40ac-87e4-dd0365b0a47e,35222a1a-5563-46d0-a66c-13859c2124b8,7dd17cc1-36b3-43ea-9e6e-b1b52476534a,4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd"
$resp = Invoke-WebRequest -UseBasicParsing "$base/inbox_attachments?select=id,file_name,storage_path,storage_bucket,mime_type&id=in.($ids)" -Headers $h
$atts = $resp.Content | ConvertFrom-Json

Write-Host "=== Storage Paths for Stuck Attachments ==="
foreach ($a in $atts) {
    Write-Host "File: $($a.file_name)"
    Write-Host "  bucket: $($a.storage_bucket) | path: $($a.storage_path)"
    Write-Host "  mime: $($a.mime_type)"
    Write-Host ""
}

# Get most recent job for each
Write-Host "=== Latest parsing_jobs ==="
foreach ($a in $atts) {
    $jobResp = Invoke-WebRequest -UseBasicParsing "$base/parsing_jobs?select=id,status,created_at&inbox_attachment_id=eq.$($a.id)&order=created_at.desc&limit=2" -Headers $h
    $jobs = $jobResp.Content | ConvertFrom-Json
    if ($jobs.Count -gt 0) {
        foreach ($j in $jobs) {
            Write-Host "  $($a.file_name.Substring(0, [Math]::Min(30, $a.file_name.Length))): $($j.status) @ $($j.created_at.Substring(11,8)) [job=$($j.id.Substring(0,8))]"
        }
    } else {
        Write-Host "  $($a.file_name): NO JOBS"
    }
}
