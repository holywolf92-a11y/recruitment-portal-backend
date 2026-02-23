######################################################################
#  Gmail OAuth2 Setup for falishamanpower4035@gmail.com
#  Run this ONCE to generate the refresh token.
#
#  Prerequisites:
#    1. A Google Cloud project with Gmail API enabled
#    2. OAuth 2.0 credentials (Desktop app type)
#       — Go to: https://console.cloud.google.com/apis/credentials
#
#  Output:
#    Prints GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
#    — copy these into Railway environment variables
######################################################################

param(
    [string]$ClientId      = "",   # Paste your OAuth client ID here
    [string]$ClientSecret  = "",   # Paste your OAuth client secret here
    [string]$Port          = "8080" # Local redirect port
)

if (-not $ClientId -or -not $ClientSecret) {
    Write-Host @"

=== STEP 1: Create Google Cloud credentials ===

1. Go to https://console.cloud.google.com/
2. Create a new project (or use existing)
3. Enable Gmail API:
   https://console.cloud.google.com/apis/library/gmail.googleapis.com
4. Go to Credentials → Create Credentials → OAuth 2.0 Client IDs
   - Application type: Desktop app
   - Name: Falisha Manpower Gmail
5. Download the JSON — copy Client ID and Client Secret
6. Re-run this script:

   .\scripts\gmail-oauth-setup.ps1 -ClientId "YOUR_CLIENT_ID" -ClientSecret "YOUR_CLIENT_SECRET"

"@ -ForegroundColor Cyan
    exit 0
}

$RedirectUri = "http://localhost:$Port"

# Gmail scopes needed
$Scopes = @(
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify"
) -join " "

$ScopesEncoded = [System.Uri]::EscapeDataString($Scopes)
$RedirectEncoded = [System.Uri]::EscapeDataString($RedirectUri)

$AuthUrl = "https://accounts.google.com/o/oauth2/v2/auth" +
    "?client_id=$ClientId" +
    "&redirect_uri=$RedirectEncoded" +
    "&response_type=code" +
    "&scope=$ScopesEncoded" +
    "&access_type=offline" +
    "&prompt=consent"

Write-Host "`n=== STEP 2: Authorize falishamanpower4035@gmail.com ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Opening browser — sign in as falishamanpower4035@gmail.com" -ForegroundColor Yellow
Write-Host ""
Write-Host "Auth URL: $AuthUrl" -ForegroundColor Gray
Write-Host ""

Start-Process $AuthUrl

# Start local HTTP listener to capture the callback
$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add("$RedirectUri/")
$Listener.Start()
Write-Host "Waiting for OAuth callback on $RedirectUri ..." -ForegroundColor Gray

$Context = $Listener.GetContext()
$RawUrl = $Context.Request.RawUrl
$Listener.Stop()

# Extract code from callback URL
$QueryString = $RawUrl -replace "^/\?", ""
$Params = @{}
$QueryString -split ([char]38) | ForEach-Object {
    $kv = $_ -split "=", 2
    $Params[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1])
}

# Send a friendly response to the browser
$ResponseBytes = [System.Text.Encoding]::UTF8.GetBytes("<html><body><h2>✅ Authorization complete! You can close this tab.</h2></body></html>")
$Context.Response.OutputStream.Write($ResponseBytes, 0, $ResponseBytes.Length)
$Context.Response.Close()

$Code = $Params["code"]
if (-not $Code) {
    Write-Host "`n❌ No authorization code received. Error: $($Params['error'])" -ForegroundColor Red
    exit 1
}

Write-Host "`n✅ Authorization code received. Exchanging for refresh token..." -ForegroundColor Green

# Exchange code for tokens
$TokenBody = @{
    code          = $Code
    client_id     = $ClientId
    client_secret = $ClientSecret
    redirect_uri  = $RedirectUri
    grant_type    = "authorization_code"
}

$TokenResponse = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method POST -Body $TokenBody -ContentType "application/x-www-form-urlencoded"

if (-not $TokenResponse.refresh_token) {
    Write-Host "`n❌ No refresh_token in response. Make sure prompt=consent was in the auth URL." -ForegroundColor Red
    Write-Host "Response: $($TokenResponse | ConvertTo-Json)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  SUCCESS! Add these to Railway environment variables:" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "GMAIL_CLIENT_ID=$ClientId" -ForegroundColor Yellow
Write-Host "GMAIL_CLIENT_SECRET=$ClientSecret" -ForegroundColor Yellow
Write-Host "GMAIL_REFRESH_TOKEN=$($TokenResponse.refresh_token)" -ForegroundColor Yellow
Write-Host "RUN_GMAIL_POLLING=true" -ForegroundColor Yellow
Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host 'Also set for admin API access:' -ForegroundColor Cyan
Write-Host 'ADMIN_SECRET=<make up a long random string>'
Write-Host ""
Write-Host 'To start the historical backfill after deployment, run:' -ForegroundColor Cyan
Write-Host '.\scripts\gmail-backfill.ps1 -AdminSecret YOUR_ADMIN_SECRET'
Write-Host ""
