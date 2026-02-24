$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }

Write-Host "=== Aleeza Tariq full job history ==="
$r1 = Invoke-WebRequest -UseBasicParsing "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1/parsing_jobs?select=id,status,created_at,file_hash&inbox_attachment_id=eq.1c9b87ea-ad51-40ac-87e4-dd0365b0a47e&order=created_at.asc" -Headers $h
$r1.Content | ConvertFrom-Json | ForEach-Object { Write-Host "  $($_.status) @ $($_.created_at.Substring(11,19)) [job=$($_.id.Substring(0,8))]" }

Write-Host ""
Write-Host "=== CV(1).pdf full job history ==="
$r2 = Invoke-WebRequest -UseBasicParsing "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1/parsing_jobs?select=id,status,created_at,file_hash&inbox_attachment_id=eq.4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd&order=created_at.asc" -Headers $h
$r2.Content | ConvertFrom-Json | ForEach-Object { Write-Host "  $($_.status) @ $($_.created_at.Substring(11,19)) [job=$($_.id.Substring(0,8))]" }

Write-Host ""
Write-Host "=== candidates linked to Aleeza Tariq phone/name ==="
$r3 = Invoke-WebRequest -UseBasicParsing "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1/candidates?select=id,full_name,created_at&full_name=like.*Aleeza*&order=created_at.desc&limit=5" -Headers $h
$r3.Content | ConvertFrom-Json | ForEach-Object { Write-Host "  $($_.id.Substring(0,8)) $($_.full_name) @ $($_.created_at.Substring(11,8))" }
