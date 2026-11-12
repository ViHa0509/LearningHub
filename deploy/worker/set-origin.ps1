# Points the public address (the Cloudflare Worker in this folder) at an origin, for example the
# Vercel project: .\set-origin.ps1 https://<project>.vercel.app
# (The Quick Tunnel on this PC is set by ..\cloudflared\start-public.ps1 instead.)
param([Parameter(Mandatory = $true)][string]$Origin)

if ($Origin -notmatch '^https://[a-z0-9.-]+$') { throw "Give the origin as https://host, without a path" }
Push-Location $PSScriptRoot
try {
    $ErrorActionPreference = 'Continue'
    npx --yes wrangler@4.152.0 deploy --var "ORIGIN:$Origin" 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed (run `npx wrangler login` once?)' }
} finally {
    Pop-Location
}
Write-Host "The public address now forwards to $Origin"
