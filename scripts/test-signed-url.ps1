$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$headers = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$storageUrl = "https://hncvsextwmvjydcukdwx.supabase.co/storage/v1"

# Test Sami-ur-rehman (7dd17cc1)
$filePath = "whatsapp/raw/1771838835214_12faec209a5ec/1602973741043359"
$signBody = "{`"expiresIn`":3600}"
$signEndpoint = "$storageUrl/object/sign/documents/$([Uri]::EscapeDataString($filePath))"

Write-Host "Signing: $signEndpoint"

try {
    $signRes = Invoke-WebRequest -UseBasicParsing $signEndpoint -Method POST -Headers $headers -Body $signBody -ContentType "application/json"
    $signData = $signRes.Content | ConvertFrom-Json
    Write-Host "signedURL field: $($signData.signedURL)"
    
    # The signedURL from Supabase is a RELATIVE path - need to prepend the base
    $fullSignedUrl = "https://hncvsextwmvjydcukdwx.supabase.co$($signData.signedURL)"
    Write-Host "Full URL: $fullSignedUrl"
    
    # Fetch actual file
    $fetchRes = Invoke-WebRequest -UseBasicParsing $fullSignedUrl -Method GET
    Write-Host "SUCCESS! Content-Length = $($fetchRes.Headers['Content-Length']), Status = $($fetchRes.StatusCode)"
} catch {
    Write-Host "ERROR: $_"
    # Maybe the signedUrl IS already a full URL
    if ($signData.signedURL -like "http*") {
        Write-Host "signedURL is absolute: $($signData.signedURL)"
        try {
            $fr = Invoke-WebRequest -UseBasicParsing $signData.signedURL -Method GET
            Write-Host "Absolute URL fetch SUCCESS: $($fr.StatusCode)"
        } catch {
            Write-Host "Absolute URL fetch FAIL: $_"
        }
    }
}
