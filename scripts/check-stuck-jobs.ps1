$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

$stuckAttIds = @(
    "1c9b87ea-ad51-40ac-87e4-dd0365b0a47e",  # Aleeza Tariq
    "35222a1a-5563-46d0-a66c-13859c2124b8",  # Resume-Ali Ahmed
    "7dd17cc1-36b3-43ea-9e6e-b1b52476534a",  # Sami-ur-rehman
    "4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd"   # CV(1).pdf
)

foreach ($attId in $stuckAttIds) {
    $url = "$base/parsing_jobs?select=id,status,result_json,created_at&inbox_attachment_id=eq.$attId&order=created_at.desc&limit=1"
    $jobs = Invoke-RestMethod $url -Headers $h
    if ($jobs.Count -gt 0) {
        $j = $jobs[0]
        Write-Host "=== att=$($attId.Substring(0,8)): status=$($j.status) @ $($j.created_at.Substring(11,8)) ==="
        if ($j.result_json) {
            $j.result_json | ConvertTo-Json -Depth 5
        } else {
            Write-Host "(no result_json)"
        }
    } else {
        Write-Host "=== att=$($attId.Substring(0,8)): NO JOB FOUND ==="
    }
    Write-Host ""
}
