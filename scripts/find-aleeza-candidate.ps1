$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

# The profile photo log showed this path for Aleeza Tariq:
# candidate_photos/1c9b87ea-ad51-40ac-87e4-dd0365b0a47e/profile.jpg
# This is stored in candidates.profile_photo_path field

Write-Host "=== Searching by profile photo path ==="
$encodedPath = "candidate_photos/1c9b87ea-ad51-40ac-87e4-dd0365b0a47e/profile.jpg"
$r1 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,created_at&profile_photo_path=like.*1c9b87ea*" -Headers $h
Write-Host "Like *1c9b87ea*: $($r1.Content)"

# Also look for candidates with position 'Chemistry Lecturer'  
$r2 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,position,created_at&position=like.*[Cc]hem*" -Headers $h
Write-Host "Chem position: $($r2.Content)"

# Also check candidates table with the photo of Aleeza  
$r3 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,position,profile_photo_url,created_at&created_at=gt.2026-02-23T12%3A26%3A00&created_at=lt.2026-02-23T12%3A58%3A00&order=created_at.asc" -Headers $h
$cands = $r3.Content | ConvertFrom-Json
Write-Host ""
Write-Host "=== Candidates with positions (today 12:26-12:58) ==="
$cands | ForEach-Object { 
    Write-Host "  $($_.id.Substring(0,8)) | $($_.name) | pos: $($_.position) | photo: $($_.profile_photo_url)" 
}
