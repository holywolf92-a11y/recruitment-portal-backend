$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

# Find candidates created during parsing windows
# Aleeza Tariq: job ran at 12:27, 12:44, 12:56 - created time should be around there
Write-Host "=== Candidates created between 12:26-12:58 today ==="
$url = "$base/candidates?select=id,name,phone,email,position,created_at&created_at=gte.2026-02-23T12%3A26%3A00&created_at=lte.2026-02-23T12%3A58%3A00&order=created_at.asc"
$r1 = Invoke-WebRequest -UseBasicParsing $url -Headers $h
$cands = $r1.Content | ConvertFrom-Json
foreach ($c in $cands) {
    $nameStr = if ($c.name) { $c.name } else { "(no name)" }
    $emailStr = if ($c.email) { $c.email } else { "" }
    Write-Host "  $($c.id.Substring(0,8)) | $($nameStr.PadRight(30)) | $($emailStr) | @ $($c.created_at.Substring(11,8))"
}

Write-Host ""
Write-Host "=== Check inbox_attachments for these candidates (looking for already-linked ones) ==="
foreach ($c in $cands) {
    $attResp = Invoke-WebRequest -UseBasicParsing "$base/inbox_attachments?select=id,file_name,candidate_id&candidate_id=eq.$($c.id)" -Headers $h
    $linkedAtts = $attResp.Content | ConvertFrom-Json
    if ($linkedAtts.Count -gt 0) {
        Write-Host "  Cand $($c.id.Substring(0,8)) ($($c.name)) linked to: $($linkedAtts | ForEach-Object { $_.file_name } | Join-String ', ')"
    }
}

Write-Host ""
Write-Host "=== Candidate_documents for Aleeza and CV1 attachments ==="
"1c9b87ea-ad51-40ac-87e4-dd0365b0a47e","4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd" | ForEach-Object {
    $attId = $_
    $cdResp = Invoke-WebRequest -UseBasicParsing "$base/candidate_documents?select=id,candidate_id,document_type,inbox_attachment_id&inbox_attachment_id=eq.$attId" -Headers $h
    $cdocs = $cdResp.Content | ConvertFrom-Json
    Write-Host "att=$($attId.Substring(0,8)): $($cdocs.Count) docs"
    $cdocs | ForEach-Object { Write-Host "  candidate=$($_.candidate_id.Substring(0,8)) type=$($_.document_type)" }
}
