# Publishes the Deploy copy (port 8080) at https://learninghub.vihc0509.workers.dev:
# starts a Cloudflare Quick Tunnel if none is running, then deploys the Worker in deploy/worker
# with the tunnel's address as ORIGIN. Run it again after a reboot or when the tunnel stopped.
# Needs a one-time `npx wrangler login` (browser sign-in to Cloudflare) by the owner.
param([switch]$Restart)

$ErrorActionPreference = 'Stop'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$log = Join-Path $env:TEMP 'lh-quick-tunnel.log'
$worker = Join-Path $PSScriptRoot '..\worker'
$wrangler = 'wrangler@4.152.0'

function Get-TunnelUrl {
    if (-not (Test-Path $log)) { return $null }
    $hits = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com'
    if ($hits) { return $hits[-1].Matches[0].Value }
    return $null
}

$running = Get-Process cloudflared -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $cloudflared }
if ($Restart -and $running) { $running | Stop-Process -Force; $running = $null }

function Test-Tunnel([string]$address) {
    try { return (Invoke-WebRequest -UseBasicParsing "$address/api/health" -TimeoutSec 15).StatusCode -eq 200 }
    catch { return $false }
}

$url = if ($running) { Get-TunnelUrl } else { $null }
# A Quick Tunnel that lost its connection for a while is gone for good ("Tunnel not found"),
# although cloudflared keeps running: start a new one.
if ($url -and -not (Test-Tunnel $url)) {
    Write-Host "Tunnel $url does not answer; starting a new one"
    $running | Stop-Process -Force
    $url = $null
}
if (-not $url) {
    if (Test-Path $log) { Remove-Item $log -Force }
    Start-Process -FilePath $cloudflared -WindowStyle Minimized -ArgumentList @(
        'tunnel', '--no-autoupdate', '--url', 'http://localhost:8080', '--logfile', $log)
    for ($i = 0; $i -lt 60 -and -not $url; $i++) { Start-Sleep -Seconds 1; $url = Get-TunnelUrl }
    if (-not $url) { throw "The Quick Tunnel did not report an address; see $log" }
    for ($i = 0; $i -lt 30 -and -not (Test-Tunnel $url); $i++) { Start-Sleep -Seconds 2 }
}
Write-Host "Tunnel: $url"

Push-Location $worker
try {
    # wrangler writes notices to stderr; only its exit code decides.
    $ErrorActionPreference = 'Continue'
    npx --yes $wrangler deploy --var "ORIGIN:$url" 2>&1 | ForEach-Object { "$_" }
    if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed (run `npx wrangler login` once?)' }
} finally {
    Pop-Location
}
Write-Host 'Public address: https://learninghub.vihc0509.workers.dev'
