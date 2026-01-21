# Reprocess Hamna Ghouri's Documents
# Run this after backend is deployed

$backendUrl = "https://recruitment-portal-backend-production-d1f7.up.railway.app"

Write-Host "`n🔄 Reprocessing Hamna Ghouri's Documents" -ForegroundColor Cyan
Write-Host "=======================================`n" -ForegroundColor Cyan

# Document IDs
$certificateId = "ee157535-27f5-4147-ba4c-c2d5f44181ef"
$passportId = "878bb30e-5180-4384-9d6b-7ac65e25f82e"

# Reprocess Certificate
Write-Host "1. Reprocessing Certificate..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$backendUrl/api/documents/candidate-documents/$certificateId/reprocess" -Method POST
    Write-Host "   ✅ Success: $($response.message)" -ForegroundColor Green
    Write-Host "   📋 Request ID: $($response.request_id)" -ForegroundColor White
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "   💡 Endpoint not deployed yet. Wait 2-5 minutes and try again." -ForegroundColor Yellow
    }
}

Write-Host ""

# Reprocess Passport
Write-Host "2. Reprocessing Passport..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$backendUrl/api/documents/candidate-documents/$passportId/reprocess" -Method POST
    Write-Host "   ✅ Success: $($response.message)" -ForegroundColor Green
    Write-Host "   📋 Request ID: $($response.request_id)" -ForegroundColor White
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "   💡 Endpoint not deployed yet. Wait 2-5 minutes and try again." -ForegroundColor Yellow
    }
}

Write-Host "`n💡 Check Railway logs to see processing results" -ForegroundColor Cyan
Write-Host "💡 Documents should update automatically after processing`n" -ForegroundColor Cyan
