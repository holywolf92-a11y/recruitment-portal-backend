$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$storageUrl = "https://hncvsextwmvjydcukdwx.supabase.co/storage/v1/object/list/documents"

$folders = @(
    @{ name = "Sami-ur-rehman"; folder = "whatsapp/raw/1771838835214_12faec209a5ec" },
    @{ name = "CV(1)"; folder = "whatsapp/raw/1771838825494_3bf470bc248d8" },
    @{ name = "Resume-Ali Ahmed"; folder = "whatsapp/raw/1771838834734_7d8be5f3bcb05" },
    @{ name = "Aleeza Tariq"; folder = "whatsapp/raw/1771838838554_1331abe2b4e68" }
)

foreach ($f in $folders) {
    Write-Host "=== $($f.name) ==="
    $body = "{`"prefix`":`"$($f.folder)`",`"limit`":10}"
    try {
        $r = Invoke-WebRequest -UseBasicParsing $storageUrl -Method POST -Headers $headers -Body $body -ContentType "application/json"
        $files = $r.Content | ConvertFrom-Json
        if ($files.Count -eq 0) {
            Write-Host "  NO FILES FOUND in folder: $($f.folder)"
        } else {
            foreach ($file in $files) {
                Write-Host "  Found: $($file.name) ($($file.metadata.size) bytes)"
            }
        }
    } catch {
        Write-Host "  ERROR: $_"
    }
    Write-Host ""
}
