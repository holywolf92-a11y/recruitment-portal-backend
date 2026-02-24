## Fix script: Create candidates for Aleeza Tariq and Maryam Riaz
## and link them to their inbox_attachments records

$KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$H = @{
    "apikey"        = $KEY
    "Authorization" = "Bearer $KEY"
    "Content-Type"  = "application/json"
    "Prefer"        = "return=representation"
}
$SBASE = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

# Attachment IDs
$ATT_ALEEZA = "1c9b87ea-ad51-40ac-87e4-dd0365b0a47e"
$ATT_MARYAM = "4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd"

# ---------- helpers -----------
function Get-NextCandidateCode {
    # Get max candidate_code from candidates table
    $r = Invoke-WebRequest -UseBasicParsing "$SBASE/candidates?select=candidate_code&order=candidate_code.desc&limit=1" -Headers $H
    $rows = $r.Content | ConvertFrom-Json
    if ($rows.Count -gt 0 -and $rows[0].candidate_code -match "^C(\d+)$") {
        $num = [int]$Matches[1] + 1
        return "C{0:D4}" -f $num
    }
    return "C0001"
}

function Create-Candidate($body) {
    $json = $body | ConvertTo-Json -Depth 5
    try {
        $r = Invoke-WebRequest -UseBasicParsing "$SBASE/candidates" -Method POST -Headers $H -Body $json
        $result = $r.Content | ConvertFrom-Json
        return $result[0]
    } catch {
        Write-Host "ERROR creating candidate: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            Write-Host "Response: $($reader.ReadToEnd())"
        }
        return $null
    }
}

function Create-CandidateDocument($body) {
    $json = $body | ConvertTo-Json -Depth 3
    try {
        $r = Invoke-WebRequest -UseBasicParsing "$SBASE/candidate_documents" -Method POST -Headers $H -Body $json
        return $r.Content | ConvertFrom-Json
    } catch {
        Write-Host "ERROR creating candidate_document: $($_.Exception.Message)"
        return $null
    }
}

function Link-Attachment($attId, $candidateId) {
    $patchH = @{
        "apikey"        = $KEY
        "Authorization" = "Bearer $KEY"
        "Content-Type"  = "application/json"
        "Prefer"        = "return=minimal"
    }
    $body = @{ candidate_id = $candidateId } | ConvertTo-Json
    $r = Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?id=eq.$attId" -Method PATCH -Headers $patchH -Body $body
    return $r.StatusCode
}

# ---------- Get parsed output ----------
Write-Host "`n=== Getting parsed output for both attachments ==="
$aleezaJob = ((Invoke-WebRequest -UseBasicParsing "$SBASE/parsing_jobs?select=output&inbox_attachment_id=eq.$ATT_ALEEZA&order=created_at.desc&limit=1" -Headers $H).Content | ConvertFrom-Json)[0]
$maryamJob = ((Invoke-WebRequest -UseBasicParsing "$SBASE/parsing_jobs?select=output&inbox_attachment_id=eq.$ATT_MARYAM&order=created_at.desc&limit=1" -Headers $H).Content | ConvertFrom-Json)[0]

$aleezaC = $aleezaJob.output.candidate
$maryamC = $maryamJob.output.candidate

Write-Host "Aleeza: $($aleezaC.full_name) / $($aleezaC.email)"
Write-Host "Maryam: $($maryamC.full_name) / $($maryamC.email)"

# ---------- Get attachment storage info ----------
$att1 = ((Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=*&id=eq.$ATT_ALEEZA" -Headers $H).Content | ConvertFrom-Json)[0]
$att2 = ((Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=*&id=eq.$ATT_MARYAM" -Headers $H).Content | ConvertFrom-Json)[0]

# ---------- Check if already exist ----------
$existA = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidates?select=id,name&email=eq.$($aleezaC.email)" -Headers $H).Content | ConvertFrom-Json
$existM = (Invoke-WebRequest -UseBasicParsing "$SBASE/candidates?select=id,name&email=eq.$($maryamC.email)" -Headers $H).Content | ConvertFrom-Json

Write-Host "`nAleeza in DB: $($existA.Count)"
Write-Host "Maryam in DB: $($existM.Count)"

# ---------- Process Aleeza ----------
Write-Host "`n=== Processing Aleeza Tariq ==="
if ($existA.Count -gt 0) {
    $aleezaId = $existA[0].id
    Write-Host "Aleeza already exists: $aleezaId"
} else {
    $code = Get-NextCandidateCode
    Write-Host "Creating Aleeza with code $code..."

    $skillsStr = if ($aleezaC.skills -is [array]) { $aleezaC.skills -join ", " } else { "" }
    $langsStr  = if ($aleezaC.languages -is [array]) { $aleezaC.languages -join ", " } else { "" }
    $eduStr    = if ($aleezaC.education -is [array]) { ($aleezaC.education | ForEach-Object { "$($_.degree) from $($_.institution)" }) -join "; " } else { "" }
    $expStr    = if ($aleezaC.experience -is [array]) { ($aleezaC.experience | ForEach-Object { "$($_.title) at $($_.company)" }) -join "; " } else { "" }
    $certStr   = if ($aleezaC.certifications -is [array]) { $aleezaC.certifications -join ", " } else { "" }

    # Truncate to column size limits (education is VARCHAR(255), others TEXT)
    $eduStr      = if ($eduStr.Length      -gt 255)  { $eduStr.Substring(0,252) + "..." } else { $eduStr }

    $aleezaBody = @{
        candidate_code       = $code
        name                 = $aleezaC.full_name
        email                = $aleezaC.email
        phone                = $aleezaC.phone
        address              = $aleezaC.location
        position             = if ($aleezaC.position -and $aleezaC.position.Length -gt 255) { $aleezaC.position.Substring(0,255) } else { $aleezaC.position }
        experience_years     = $aleezaC.experience_years
        skills               = $skillsStr
        languages            = $langsStr
        education            = $eduStr
        previous_employment  = $expStr
        certifications       = $certStr
        cv_received          = $true
    }

    $aleezaCandidate = Create-Candidate $aleezaBody
    if ($null -eq $aleezaCandidate) {
        Write-Host "FAILED to create Aleeza candidate"
        exit 1
    }
    $aleezaId = $aleezaCandidate.id
    Write-Host "Created Aleeza candidate: $aleezaId"
}

# Create candidate_document for Aleeza
Write-Host "Creating candidate_document for Aleeza..."
$cdAleeza = @{
    candidate_id         = $aleezaId
    inbox_attachment_id  = $ATT_ALEEZA
    document_type        = "cv"
    storage_bucket       = "documents"
    storage_path         = $att1.storage_path
    file_name            = $att1.file_name
    mime_type            = "application/pdf"
    source               = "whatsapp"
    status               = "received"
    category             = "cv"
    detected_category    = "cv"
}
$cdRes1 = Create-CandidateDocument $cdAleeza
Write-Host "candidate_document result: $($cdRes1 | ConvertTo-Json -Compress)"

# Link attachment
Write-Host "Linking attachment $ATT_ALEEZA to candidate $aleezaId..."
$status1 = Link-Attachment $ATT_ALEEZA $aleezaId
Write-Host "Link status: $status1"

# ---------- Process Maryam ----------
Write-Host "`n=== Processing Maryam Riaz ==="
if ($existM.Count -gt 0) {
    $maryamId = $existM[0].id
    Write-Host "Maryam already exists: $maryamId"
} else {
    $code2 = Get-NextCandidateCode
    Write-Host "Creating Maryam with code $code2..."

    $skillsStr2 = if ($maryamC.skills -is [array]) { $maryamC.skills -join ", " } else { "" }
    $langsStr2  = if ($maryamC.languages -is [array]) { $maryamC.languages -join ", " } else { "" }
    $eduStr2    = if ($maryamC.education -is [array]) { ($maryamC.education | ForEach-Object { "$($_.degree) from $($_.institution)" }) -join "; " } else { "" }
    $expStr2    = if ($maryamC.experience -is [array]) { ($maryamC.experience | ForEach-Object { "$($_.title) at $($_.company)" }) -join "; " } else { "" }
    $certStr2   = if ($maryamC.certifications -is [array]) { $maryamC.certifications -join ", " } else { "" }

    # Truncate to column size limits (education is VARCHAR(255), others TEXT)
    $eduStr2     = if ($eduStr2.Length     -gt 255)  { $eduStr2.Substring(0,252) + "..." } else { $eduStr2 }

    $maryamBody = @{
        candidate_code       = $code2
        name                 = $maryamC.full_name
        email                = $maryamC.email
        phone                = $maryamC.phone
        address              = $maryamC.location
        position             = if ($maryamC.position -and $maryamC.position.Length -gt 255) { $maryamC.position.Substring(0,255) } else { $maryamC.position }
        experience_years     = $maryamC.experience_years
        skills               = $skillsStr2
        languages            = $langsStr2
        education            = $eduStr2
        previous_employment  = $expStr2
        certifications       = $certStr2
        cv_received          = $true
    }

    $maryamCandidate = Create-Candidate $maryamBody
    if ($null -eq $maryamCandidate) {
        Write-Host "FAILED to create Maryam candidate"
        exit 1
    }
    $maryamId = $maryamCandidate.id
    Write-Host "Created Maryam candidate: $maryamId"
}

# Create candidate_document for Maryam
Write-Host "Creating candidate_document for Maryam..."
$cdMaryam = @{
    candidate_id         = $maryamId
    inbox_attachment_id  = $ATT_MARYAM
    document_type        = "cv"
    storage_bucket       = "documents"
    storage_path         = $att2.storage_path
    file_name            = $att2.file_name
    mime_type            = "application/pdf"
    source               = "whatsapp"
    status               = "received"
    category             = "cv"
    detected_category    = "cv"
}
$cdRes2 = Create-CandidateDocument $cdMaryam
Write-Host "candidate_document result: $($cdRes2 | ConvertTo-Json -Compress)"

# Link attachment
Write-Host "Linking attachment $ATT_MARYAM to candidate $maryamId..."
$status2 = Link-Attachment $ATT_MARYAM $maryamId
Write-Host "Link status: $status2"

# ---------- Verify ----------
Write-Host "`n=== Verifying ==="
Start-Sleep -Seconds 2
$v1 = ((Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=id,file_name,candidate_id&id=eq.$ATT_ALEEZA" -Headers $H).Content | ConvertFrom-Json)[0]
$v2 = ((Invoke-WebRequest -UseBasicParsing "$SBASE/inbox_attachments?select=id,file_name,candidate_id&id=eq.$ATT_MARYAM" -Headers $H).Content | ConvertFrom-Json)[0]

Write-Host "Aleeza attachment: $($v1.file_name) -> candidate_id=$($v1.candidate_id)"
Write-Host "Maryam attachment: $($v2.file_name) -> candidate_id=$($v2.candidate_id)"

if ($v1.candidate_id -and $v2.candidate_id) {
    Write-Host "`nSUCCESS: Both attachments are now linked to candidates!"
} else {
    Write-Host "`nWARNING: Some attachments still missing candidate_id"
}
