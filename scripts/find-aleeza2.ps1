$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$base = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"
$storageBase = "https://hncvsextwmvjydcukdwx.supabase.co/storage/v1"

Write-Host "=== Checking Aleeza Tariq photo ==="
$photoUrl = "https://hncvsextwmvjydcukdwx.supabase.co/storage/v1/object/public/documents/candidate_photos/1c9b87ea-ad51-40ac-87e4-dd0365b0a47e/profile.jpg"
try {
    $r = Invoke-WebRequest -UseBasicParsing $photoUrl -Method HEAD
    Write-Host "PHOTO EXISTS! Status: $($r.StatusCode) Content-Length: $($r.Headers['Content-Length'])"
} catch {
    Write-Host "Photo does NOT exist at default path"
}

Write-Host ""
Write-Host "=== Looking for candidates with profile_photo_url containing 1c9b87ea ==="
$r2 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,position,profile_photo_url,created_at&profile_photo_url=like.*1c9b87ea*" -Headers $h
Write-Host $r2.Content

Write-Host ""
Write-Host "=== Also check profile_photo_path ==="
$r3 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,profile_photo_path,created_at&profile_photo_path=like.*1c9b87ea*" -Headers $h
Write-Host $r3.Content

Write-Host ""
Write-Host "=== Searching for chemistry professor/lecturer candidates ==="
$r4 = Invoke-WebRequest -UseBasicParsing "$base/candidates?select=id,name,position,created_at&position=ilike.*lecturer*" -Headers $h
Write-Host $r4.Content
