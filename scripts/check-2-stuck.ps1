$key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuY3ZzZXh0d212anlkY3VrZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NzI2NzMyOSwiZXhwIjoyMDgyODQzMzI5fQ.X0XKEnH8pUqthf0tziaRWFAsRIaeU6am0qtWDxuR6mQ"
$h = @{ "apikey" = $key; "Authorization" = "Bearer $key" }
$supaBase = "https://hncvsextwmvjydcukdwx.supabase.co/rest/v1"

$stuckAtts = @(
    @{ name = "Aleeza Tariq"; id = "1c9b87ea-ad51-40ac-87e4-dd0365b0a47e" },
    @{ name = "CV(1).pdf"; id = "4c3e1e9c-a540-4a3b-bf07-b2b4a072ccdd" }
)

foreach ($att in $stuckAtts) {
    Write-Host "==== $($att.name) [att=$($att.id.Substring(0,8))] ===="
    
    # Check inbox_attachments
    $iaResp = Invoke-WebRequest -UseBasicParsing "$supaBase/inbox_attachments?select=candidate_id,linked_candidate_id,attachment_type&id=eq.$($att.id)" -Headers $h
    $ia = ($iaResp.Content | ConvertFrom-Json)[0]
    Write-Host "  candidate_id: $($ia.candidate_id) | linked: $($ia.linked_candidate_id) | type: $($ia.attachment_type)"
    
    # Check parsing_jobs
    $pjResp = Invoke-WebRequest -UseBasicParsing "$supaBase/parsing_jobs?select=id,status,created_at&inbox_attachment_id=eq.$($att.id)&order=created_at.desc&limit=3" -Headers $h
    $pjobs = $pjResp.Content | ConvertFrom-Json
    Write-Host "  Recent parsing jobs:"
    foreach ($j in $pjobs) {
        Write-Host "    $($j.status) @ $($j.created_at.Substring(11,8)) [job=$($j.id.Substring(0,8))]"
    }
    
    # Check candidate_documents
    $cdResp = Invoke-WebRequest -UseBasicParsing "$supaBase/candidate_documents?select=id,candidate_id,document_type&inbox_attachment_id=eq.$($att.id)" -Headers $h
    $cdocs = $cdResp.Content | ConvertFrom-Json
    Write-Host "  candidate_documents:"
    if ($cdocs.Count -gt 0) {
        foreach ($d in $cdocs) {
            Write-Host "    doc=$($d.id.Substring(0,8)) candidate=$($d.candidate_id.Substring(0,8)) type=$($d.document_type)"
        }
    } else {
        Write-Host "    (none)"
    }
    Write-Host ""
}
