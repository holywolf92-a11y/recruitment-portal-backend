$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$storageBase = "https://hncvsextwmvjydcukdwx.supabase.co/storage/v1"

$files = @(
    @{ name = "Sami-ur-rehman.pdf"; path = "whatsapp/raw/1771838835214_12faec209a5ec/1602973741043359" },
    @{ name = "CV(1).pdf"; path = "whatsapp/raw/1771838825494_3bf470bc248d8/2002923737245072" },
    @{ name = "Resume-Ali Ahmed.pdf"; path = "whatsapp/raw/1771838834734_7d8be5f3bcb05/25553507687685738" },
    @{ name = "Aleeza Tariq.pdf"; path = "whatsapp/raw/1771838838554_1331abe2b4e68/2750951738571979" }
)

foreach ($f in $files) {
    Write-Host "Testing: $($f.name)"
    $encodedPath = [Uri]::EscapeUriString($f.path)
    $signUrl = "$storageBase/object/sign/documents/$encodedPath"
    try {
        $body = '{"expiresIn":60}'
        $signRes = Invoke-WebRequest -UseBasicParsing $signUrl -Method POST -Headers $h -Body $body -ContentType "application/json"
        $signData = $signRes.Content | ConvertFrom-Json
        if ($signData.signedURL) {
            Write-Host "  -> Signed URL OK. Testing fetch..."
            $fullUrl = "https://hncvsextwmvjydcukdwx.supabase.co$($signData.signedURL)"
            try {
                $fetchRes = Invoke-WebRequest -UseBasicParsing $fullUrl -Method HEAD
                Write-Host "  -> FILE EXISTS size=$($fetchRes.Headers['Content-Length']) bytes"
            } catch {
                Write-Host "  -> FILE NOT ACCESSIBLE: $_"
            }
        } else {
            Write-Host "  -> No signedURL returned: $($signRes.Content)"
        }
    } catch {
        Write-Host "  -> SIGN FAILED: $_"
    }
    Write-Host ""
}
