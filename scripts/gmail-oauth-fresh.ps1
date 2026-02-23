param(
    [string]$ClientId = "",
    [string]$ClientSecret = "",
    [string]$Port = "8080"
)
if (-not $ClientId -or -not $ClientSecret) {
    Write-Host "Usage: .\gmail-oauth.ps1 -ClientId <id> -ClientSecret <secret>"
    exit 0
}
$RedirectUri = "http://localhost:$Port"
$Scopes = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify"
$ScopesEncoded = [System.Uri]::EscapeDataString($Scopes)
$RedirectEncoded = [System.Uri]::EscapeDataString($RedirectUri)
$AuthUrl = "https://accounts.google.com/o/oauth2/v2/auth?client_id=${ClientId}&redirect_uri=${RedirectEncoded}&response_type=code&scope=${ScopesEncoded}&access_type=offline&prompt=consent"
Write-Host "Opening browser - sign in as falishamanpower4035@gmail.com" -ForegroundColor Cyan
Write-Host "URL: $AuthUrl" -ForegroundColor Gray
Start-Process $AuthUrl
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("$RedirectUri/")
$Listener.Start()
Write-Host "Waiting for OAuth callback on $RedirectUri ..." -ForegroundColor Yellow
$Context = $Listener.GetContext()
$RawUrl = $Context.Request.RawUrl
$HtmlOk = [System.Text.Encoding]::UTF8.GetBytes("<html><body><h2>Done! Close this tab.</h2></body></html>")
$Context.Response.OutputStream.Write($HtmlOk, 0, $HtmlOk.Length)
$Context.Response.Close()
$Listener.Stop()
$Qs = $RawUrl -replace "^/\?", ""
$Prms = @{}
foreach ($pair in ($Qs -split [char]38)) {
    $kv = $pair -split "=", 2
    if ($kv.Count -eq 2) { $Prms[$kv[0]] = [System.Uri]::UnescapeDataString($kv[1]) }
}
$Code = $Prms["code"]
if (-not $Code) { Write-Host "No code. Error: $($Prms['error'])" -ForegroundColor Red; exit 1 }
Write-Host "Got code. Exchanging for tokens..." -ForegroundColor Green
$TokenBody = "code=${Code}&client_id=${ClientId}&client_secret=${ClientSecret}&redirect_uri=${RedirectUri}&grant_type=authorization_code"
$TR = Invoke-RestMethod -Uri "https://oauth2.googleapis.com/token" -Method POST -Body $TokenBody -ContentType "application/x-www-form-urlencoded"
if (-not $TR.refresh_token) { Write-Host "No refresh_token returned!"; Write-Host ($TR | ConvertTo-Json); exit 1 }
Write-Host ""
Write-Host "=== SUCCESS - copy to Railway ===" -ForegroundColor Green
Write-Host "GMAIL_CLIENT_ID=${ClientId}" -ForegroundColor Yellow
Write-Host "GMAIL_CLIENT_SECRET=${ClientSecret}" -ForegroundColor Yellow
Write-Host "GMAIL_REFRESH_TOKEN=$($TR.refresh_token)" -ForegroundColor Yellow
