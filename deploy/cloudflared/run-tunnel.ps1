# Starts the Learning Hub tunnel with deploy/cloudflared/config.yml (made from config.example.yml).
$config = Join-Path $PSScriptRoot 'config.yml'
if (-not (Test-Path $config)) {
    Write-Error "Missing $config. Copy config.example.yml to config.yml and fill it in first."
    exit 1
}
cloudflared tunnel --config $config run
