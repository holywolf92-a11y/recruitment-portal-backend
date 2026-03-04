######################################################################
#  Gmail OAuth2 Setup for falishaoep4035@gmail.com  (Account 2)
#  Run this ONCE to generate GMAIL2_* environment variables.
#
#  Prerequisites:
#    1. A Google Cloud Project created under falishaoep4035@gmail.com
#    2. Gmail API enabled on that project
#    3. OAuth 2.0 credentials of type "Desktop app" created
#
#  Output:
#    Prints GMAIL2_CLIENT_ID, GMAIL2_CLIENT_SECRET, GMAIL2_REFRESH_TOKEN
#    — add all three to Railway environment variables
######################################################################

param(
    [string]$ClientId     = "",   # Client ID from Google Cloud Console
    [string]$ClientSecret = "",   # Client Secret from Google Cloud Console
    [string]$Port         = "8080"
)

if (-not $ClientId -or -not $ClientSecret) {
    Write-Host @"

=== You need to create OAuth credentials first ===

1. Go to https://console.cloud.google.com/
   Sign in as falishaoep4035@gmail.com

2. Create a new project:  Falisha OEP Recruitment

3. Enable Gmail API:
   https://console.cloud.google.com/apis/library/gmail.googleapis.com

4. Configure OAuth consent screen:
   https://console.cloud.google.com/apis/credentials/consent
   - User Type: External
   - App name: Falisha OEP
   - Support email: falishaoep4035@gmail.com
   - Save → Publish App

5. Create credentials:
   https://console.cloud.google.com/apis/credentials
   - + Create Credentials → OAuth 2.0 Client IDs
   - Application type: Desktop app
   - Name: Falisha OEP Gmail
   - Create → copy Client ID and Client Secret

6. Re-run this script:
   .\scripts\gmail-oauth-account2.ps1 -ClientId "YOUR_CLIENT_ID" -ClientSecret "YOUR_CLIENT_SECRET"

"@ -ForegroundColor Cyan
    exit 0
}

$RedirectUri     = "http://localhost:$Port"
$Scopes          = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
$ScopesEncoded   = [System.Uri]::EscapeDataString($Scopes)
$RedirectEncoded = [System.Uri]::EscapeDataString($RedirectUri)

$AuthUrl = "https://accounts.google.com/o/oauth2/v2/auth" +
    "?client_id=${ClientId}" +
    "&redirect_uri=${RedirectEncoded}" +
    "&response_type=code" +
    "&scope=${ScopesEncoded}" +
    "&access_type=offline" +
    "&prompt=consent"

Write-Host ""
Write-Host "=== Opening browser ===" -ForegroundColor Cyan
Write-Host "IMPORTANT: Sign in as falishaoep4035@gmail.com" -ForegroundColor Yellow
Write-Host "           (not any other account)" -ForegroundColor Yellow
Write-Host ""

Start-Process $AuthUrl

# Start temporary local listener to capture the OAuth callback
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("$RedirectUri/")
$Listener.Start()
Write-Host "Waiting for Google to redirect back to $RedirectUri ..." -ForegroundColor Gray

$Context = $Listener.GetContext()
$RawUrl  = $Context.Request.RawUrl

$HtmlOk = [System.Text.Encoding]::UTF8.GetBytes("<html><body><h2>Done! You can close this tab.</h2></body></html>")
$Context.Response.OutputStream.Write($HtmlOk, 0, $HtmlOk.Length)
$Context.Response.Close()
$Listener.Stop()

# Parse query string
$Qs   = $RawUrl -replace "^/\?", ""
$Prms = @{}
foreach ($pair in ($Qs -split [char]38)) {
    $kv = $pair -split "=", 2
    if ($kv.Count -eq 2) { $Prms[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1]) }
}

$Code = $Prms["code"]
if (-not $Code) {
    Write-Host "No authorization code received. Error: $($Prms['error'])" -ForegroundColor Red
    exit 1
}

Write-Host "Got authorization code. Exchanging for refresh token..." -ForegroundColor Green

$TokenBody = "code=${Code}&client_id=${ClientId}&client_secret=${ClientSecret}&redirect_uri=${RedirectUri}&grant_type=authorization_code"
$TR = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method POST -Body $TokenBody -ContentType "application/x-www-form-urlencoded"

if (-not $TR.refresh_token) {
    Write-Host "No refresh_token returned. Full response:" -ForegroundColor Red
    Write-Host ($TR | ConvertTo-Json) -ForegroundColor Red
    Write-Host "Make sure you chose 'Desktop app' type in Google Cloud Console." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  SUCCESS! Add these 3 variables to Railway:" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "GMAIL2_CLIENT_ID=$ClientId" -ForegroundColor Yellow
Write-Host "GMAIL2_CLIENT_SECRET=$ClientSecret" -ForegroundColor Yellow
Write-Host "GMAIL2_REFRESH_TOKEN=$($TR.refresh_token)" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "After adding to Railway and redeploying, trigger the backfill:" -ForegroundColor Cyan
Write-Host '.\scripts\gmail-backfill.ps1 -Account 2 -AdminSecret YOUR_ADMIN_SECRET'
Write-Host ""
