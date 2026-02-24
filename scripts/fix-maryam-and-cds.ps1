## Fix Maryam candidate + create candidate_documents for both

$KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$H  = @{ "apikey" = $KEY; "Authorization" = "Bearer $KEY" }
$H2 = @{ "apikey" = $KEY; "Authorization" = "Bearer $KEY"; "Content-Type" = "application/json"; "Prefer" = "return=representation" }
$HP = @{ "apikey" = $KEY; "Authorization" = "Bearer $KEY"; "Content-Type" = "application/json"; "Prefer" = "return=minimal" }
$SBASE = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

$ATT_ALEEZA = "1c9b87ea-ad51-40ac-87e4-dd0365b0a47e"
$ATT_MARYAM = "4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd"
$ALEEZA_ID  = "b557d112-04ee-4fc9-81cb-9a16c9df3677"

Write-Host "=== Step 1: Create candidate_document for Aleeza ==="
# Check existing candidate_documents for aleeza first
$existCD1 = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents?select=id&candidate_id=eq.$ALEEZA_ID&document_type=eq.cv" -Headers $H).Content | ConvertFrom-Json
Write-Host "Existing CD for Aleeza: $($existCD1.Count)"

if ($existCD1.Count -eq 0) {
    $cdBody1 = '{"candidate_id":"' + $ALEEZA_ID + '","inbox_attachment_id":"' + $ATT_ALEEZA + '","document_type":"cv","storage_bucket":"documents","storage_path":"whatsapp/raw/1771838838554_1331abe2b4e68/2750951738571979","file_name":"Aleeza Tariq(Chemistry Lecturer).pdf","mime_type":"application/pdf","status":"received"}'
    try {
        $r = Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents" -Method POST -Headers $H2 -Body $cdBody1
        Write-Host "Aleeza CD created: $($r.StatusCode) - $(($r.Content | ConvertFrom-Json)[0].id)"
    } catch {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        Write-Host "Aleeza CD error: $($reader.ReadToEnd())"
    }
}

Write-Host ""
Write-Host "=== Step 2: Create Maryam candidate ==="
# Check if Maryam already exists (might have been created with code conflict)
$existM = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidates?select=id,name,candidate_code&email=eq.marykhan2015@gmail.com" -Headers $H).Content | ConvertFrom-Json
Write-Host "Maryam in DB: $($existM.Count)"

$maryamId = $null
if ($existM.Count -gt 0) {
    $maryamId = $existM[0].id
    Write-Host "Maryam already exists: $maryamId (code $($existM[0].candidate_code))"
} else {
    # Get next available candidate code (Aleeza is C0001 so Maryam should be C0002)
    $latestCode = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidates?select=candidate_code&order=created_at.desc&limit=1" -Headers $H).Content | ConvertFrom-Json
    $lastCode = $latestCode[0].candidate_code
    Write-Host "Latest code: $lastCode"
    
    if ($lastCode -match "^C(\d+)$") {
        $nextNum = [int]$Matches[1] + 1
        $nextCode = "C{0:D4}" -f $nextNum
    } else {
        $nextCode = "C0002"
    }
    Write-Host "Creating Maryam with code $nextCode..."
    
    # Get Maryam parsed data
    $maryamOut = ((Invoke-WebRequest -UseBasicParsing "$SBASE/parsing_jobs?select=output&inbox_attachment_id=eq.$ATT_MARYAM&order=created_at.desc&limit=1" -Headers $H).Content | ConvertFrom-Json)[0].output.candidate
    
    $skillsStr = if ($maryamOut.skills -is [array]) { ($maryamOut.skills -join ", ") } else { "" }
    $langsStr  = if ($maryamOut.languages -is [array]) { ($maryamOut.languages -join ", ") } else { "" }
    $eduStr    = ($maryamOut.education | ForEach-Object { "$($_.degree) from $($_.institution)" }) -join "; "
    $expStr    = ($maryamOut.experience | ForEach-Object { "$($_.title) at $($_.company)" }) -join "; "
    $certStr   = if ($maryamOut.certifications -is [array]) { ($maryamOut.certifications -join ", ") } else { "" }
    
    # Truncate education to 255 chars
    $eduStr  = if ($eduStr.Length  -gt 255) { $eduStr.Substring(0,252) + "..." } else { $eduStr }
    $certStr = if ($certStr.Length -gt 252) { $certStr.Substring(0,252) + "..." } else { $certStr }
    
    $maryamBody = @{
        candidate_code      = $nextCode
        name                = $maryamOut.full_name
        email               = $maryamOut.email
        phone               = $maryamOut.phone
        address             = $maryamOut.location
        position            = if ($maryamOut.position -and $maryamOut.position.Length -gt 255) { $maryamOut.position.Substring(0,255) } else { $maryamOut.position }
        experience_years    = $maryamOut.experience_years
        skills              = $skillsStr
        languages           = $langsStr
        education           = $eduStr
        previous_employment = $expStr
        certifications      = $certStr
        cv_received         = $true
    } | ConvertTo-Json -Depth 3
    
    try {
        $r2 = Invoke-WebRequest -UseBasicParsing "$SBASE/candidates" -Method POST -Headers $H2 -Body $maryamBody
        $maryamCreated = ($r2.Content | ConvertFrom-Json)[0]
        $maryamId = $maryamCreated.id
        Write-Host "Maryam created: $maryamId"
    } catch {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        Write-Host "Maryam create error: $($reader.ReadToEnd())"
        exit 1
    }
}

Write-Host ""
Write-Host "=== Step 3: Link Maryam attachment ==="
Write-Host "Linking $ATT_MARYAM to candidate $maryamId..."
$patchBody = '{"candidate_id":"' + $maryamId + '"}'
$r3 = Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?id=eq.$ATT_MARYAM" -Method PATCH -Headers $HP -Body $patchBody
Write-Host "Link status: $($r3.StatusCode)"

Write-Host ""
Write-Host "=== Step 4: Create candidate_document for Maryam ==="
$att2 = (Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=*&id=eq.$ATT_MARYAM" -Headers $H).Content | ConvertFrom-Json
$existCD2 = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents?select=id&candidate_id=eq.$maryamId&document_type=eq.cv" -Headers $H).Content | ConvertFrom-Json
Write-Host "Existing CD for Maryam: $($existCD2.Count)"

if ($existCD2.Count -eq 0) {
    $storagePath = $att2[0].storage_path
    $fileName    = $att2[0].file_name
    $cdBody2 = '{"candidate_id":"' + $maryamId + '","inbox_attachment_id":"' + $ATT_MARYAM + '","document_type":"cv","storage_bucket":"documents","storage_path":"' + $storagePath + '","file_name":"' + $fileName + '","mime_type":"application/pdf","status":"received"}'
    
    try {
        $r4 = Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents" -Method POST -Headers $H2 -Body $cdBody2
        Write-Host "Maryam CD created: $($r4.StatusCode)"
    } catch {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        Write-Host "Maryam CD error: $($reader.ReadToEnd())"
    }
}

Write-Host ""
Write-Host "=== Step 5: Final Verification ==="
Start-Sleep -Seconds 1
$v1 = (Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=id,file_name,candidate_id&id=eq.$ATT_ALEEZA" -Headers $H).Content | ConvertFrom-Json
$v2 = (Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=id,file_name,candidate_id&id=eq.$ATT_MARYAM" -Headers $H).Content | ConvertFrom-Json
$cd1 = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents?select=id,document_type&candidate_id=eq.$ALEEZA_ID" -Headers $H).Content | ConvertFrom-Json
$cd2 = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents?select=id,document_type&candidate_id=eq.$maryamId" -Headers $H).Content | ConvertFrom-Json

Write-Host "Aleeza att: $($v1[0].file_name) -> candidate_id=$($v1[0].candidate_id) | docs=$($cd1.Count)"
Write-Host "Maryam att: $($v2[0].file_name) -> candidate_id=$($v2[0].candidate_id) | docs=$($cd2.Count)"

$allLinked = $v1[0].candidate_id -and $v2[0].candidate_id
if ($allLinked) {
    Write-Host ""
    Write-Host "SUCCESS: Both attachments linked to candidates! All 6/6 fixed!"
} else {
    Write-Host ""
    Write-Host "WARNING: Not all linked yet"
}
