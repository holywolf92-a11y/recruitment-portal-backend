$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

Write-Host "=== Looking for Aleeza Tariq candidate ===" 
$r1 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,email,phone,created_at&name=like.*Aleeza*&order=created_at.desc&limit=5" -Headers $h
$r1.Content | ConvertFrom-Json | ForEach-Object { Write-Host "  $($_.id.Substring(0,8)) | $($_.name) | $($_.email) | created:$($_.created_at.Substring(11,8))" }

Write-Host ""
Write-Host "=== Looking for CV(1) candidate - need to find by photo path ===" 
# CV(1) attachment id = 4c3e1e9c - check candidate_photos for this
$r2 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,email,phone,created_at&profile_photo_path=like.*4c3e1e9c*&limit=3" -Headers $h
Write-Host "  By photo path: $($r2.Content)"

Write-Host ""
Write-Host "=== All candidates created today after 12:27 ===" 
$r3 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,email,created_at&created_at=gt.2026-02-23T12:25:00&order=created_at.desc&limit=20" -Headers $h
$r3.Content | ConvertFrom-Json | ForEach-Object { Write-Host "  $($_.id.Substring(0,8)) | $($_.name) | created:$($_.created_at.Substring(11,8))" }
