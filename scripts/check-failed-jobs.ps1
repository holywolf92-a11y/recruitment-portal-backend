$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

# Get all columns for the latest jobs
$atts = @(
    @{ name = "Aleeza Tariq"; id = "1c9b87ea-ad51-40ac-87e4-dd0365b0a47e" },
    @{ name = "CV(1)"; id = "4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd" }
)

foreach ($att in $atts) {
    Write-Host "=== $($att.name) latest jobs ==="
    $url = "$base/parsing_jobs?select=id,status,created_at&inbox_attachment_id=eq.$($att.id)&order=created_at.desc&limit=5"
    try {
        $r = Invoke-WebRequest -UseBasicParsing $url -Headers $h
        $jobs = $r.Content | ConvertFrom-Json
        $jobs | ForEach-Object { Write-Host "  $($_.status) @ $($_.created_at.Substring(11,8)) [job=$($_.id.Substring(0,8))]" }
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)"
        # Try to get error details
        try {
            $err = Invoke-WebRequest -UseBasicParsing $url -Headers $h -ErrorAction SilentlyContinue
        } catch {}
    }
    Write-Host ""
}

# Also check if there's a 'failed' status for these
Write-Host "=== All FAILED jobs in last hour ==="
$url2 = "$base/parsing_jobs?select=id,status,inbox_attachment_id,created_at&status=eq.failed&order=created_at.desc&limit=10"
try {
    $r2 = Invoke-WebRequest -UseBasicParsing $url2 -Headers $h
    $failed = $r2.Content | ConvertFrom-Json
    $found = $failed | Where-Object { $_.inbox_attachment_id -in @("1c9b87ea-ad51-40ac-87e4-dd0365b0a47e","4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd") }
    if ($found) {
        Write-Host "Found failed jobs for our attachments:"
        $found | ForEach-Object { Write-Host "  $($_.id.Substring(0,8)) att=$($_.inbox_attachment_id.Substring(0,8)) @ $($_.created_at.Substring(11,8))" }
    } else {
        Write-Host "No failed jobs found for our 2 attachments (they may have failed in BullMQ only, not in DB)"
        $failed | ForEach-Object { Write-Host "  Failed: att=$($_.inbox_attachment_id.Substring(0,8)) @ $($_.created_at.Substring(11,8))" }
    }
} catch {
    Write-Host "ERROR querying failed jobs: $($_.Exception.Message)"
}
