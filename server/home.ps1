param([ValidateSet('start','code','access','stop','status','logs')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop, start it with Linux containers, then run HOME again. See START-HERE.md.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with Linux containers, then try again.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }
if ($Action -in @('stop','status','logs')) {
    $command = @{stop='stop'; status='ps'; logs='logs'}[$Action]
    docker compose -f compose.json $command
    exit $LASTEXITCODE
}
$installerImage = (Get-Content -LiteralPath installer-image.txt -Raw).Trim()
docker image inspect $installerImage *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Loading the included HOME containers. This may take a few minutes.'
    docker load -i images.tar
    if ($LASTEXITCODE -ne 0) { throw 'Could not load HOME images.' }
}
$runArgs = @('run','--rm','-it')
if ($Action -eq 'access') {
    docker compose -f compose.json stop tls
    if ($LASTEXITCODE -ne 0) { throw 'Start HOME before changing access.' }
    $runArgs += @('--network','home-server_default')
}
$runArgs += @('--mount',"type=bind,source=$PSScriptRoot,target=/bundle",'--entrypoint','node',$installerImage,'/bundle/setup/cli.mjs',$Action)
& docker @runArgs
if ($LASTEXITCODE -ne 0) { throw 'HOME configuration did not complete. Your existing data is preserved.' }
if ($Action -ne 'code') {
    docker compose -f compose.json up -d --wait --wait-timeout 180 --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'Some HOME services did not start. Run home.cmd status and home.cmd logs to investigate.' }
    Write-Host 'HOME is running. Open http://localhost:8080 on this computer.'
    $installation = Get-Content -LiteralPath 'configuration/installation.json' -Raw | ConvertFrom-Json
    if ($installation.access.mode -eq 'lan') {
        Write-Host 'For other devices on your home network, use the address for your Wi-Fi or Ethernet connection:'
        Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object {
            Write-Host ("  {0}: http://{1}:8080" -f $_.InterfaceAlias, $_.IPAddress)
        }
    }
}
