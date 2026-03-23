$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')

if (-not $env:HOSTINGER_SMTP_USER -or -not $env:HOSTINGER_SMTP_PASSWORD) {
	$railwayExecutable = Get-Command railway.cmd -CommandType Application -ErrorAction SilentlyContinue
	$npxExecutable = Get-Command npx.ps1 -CommandType ExternalScript -ErrorAction SilentlyContinue

	$varsJson = if ($railwayExecutable) {
		& $railwayExecutable.Source variables --json
	} elseif ($npxExecutable) {
		& $npxExecutable.Source railway variables --json
	} else {
		throw 'HOSTINGER_SMTP_USER/HOSTINGER_SMTP_PASSWORD are not set and neither railway nor npx is available.'
	}

	$vars = $varsJson | ConvertFrom-Json
	$env:HOSTINGER_SMTP_USER = $vars.HOSTINGER_SMTP_USER
	$env:HOSTINGER_SMTP_PASSWORD = $vars.HOSTINGER_SMTP_PASSWORD
}

node .\scripts\prod-hostinger-auto-poll-e2e.js