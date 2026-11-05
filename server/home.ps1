param([ValidateSet('start','code','access','diagnose','snapshot','recover-snapshot','export-backups','verify-backups','stop','status','logs','upgrade','import')][string]$Action = 'start', [string]$PreviousFolder)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($Action -in @('import','snapshot','recover-snapshot')) {
    # Establish both directions before the first native command; legacy
    # PowerShell otherwise inherits the host console's older code page.
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = $OutputEncoding
    [Console]::OutputEncoding = $OutputEncoding
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install Docker Desktop, start it with Linux containers, then run HOME again. See START-HERE.md.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with Linux containers, then try again.' }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose v2 is required.' }
if ((Get-Item -LiteralPath 'configuration/snapshot-state.json' -Force -ErrorAction SilentlyContinue) -and $Action -notin @('status','logs','recover-snapshot')) {
    throw 'Snapshot recovery is pending. Run home.cmd recover-snapshot before other actions.'
}
function Invoke-CoordinatedSnapshot([string]$RootFolder, [string]$Destination, [string]$BackupImage, [switch]$Recover) {
    $snapshotImage = (Get-Content -LiteralPath installer-image.txt -Raw).Trim()
    $format = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"config":{{json (index .Config.Labels "com.docker.compose.project.config_files")}},"job":{{json (index .Config.Labels "home.snapshot.job")}},"mounts":{{json .Mounts}}}'
    function Get-SnapshotInventory {
        $ids = @(docker ps -aq --no-trunc)
        if ($LASTEXITCODE -ne 0 -or @($ids | Where-Object { $_ -notmatch '^[a-f0-9]{64}$' }).Count) { throw 'Could not list Docker container identities.' }
        if (-not $ids.Count) { return '[]' }
        $rows = @(docker inspect --format $format @ids)
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker container state and mounts.' }
        return ($rows -join "`n")
    }
    function Invoke-SnapshotHelper([string]$Command, [string]$Inventory = '') {
        $Inventory | & docker run --rm -i --network none --cap-drop ALL --security-opt no-new-privileges --mount "type=bind,source=$RootFolder,target=/bundle" --entrypoint node $snapshotImage /bundle/setup/cli.mjs $Command $RootFolder
        $script:SnapshotHelperCode = $LASTEXITCODE
    }
    function Resume-Snapshot {
        $restoreIds = @(Invoke-SnapshotHelper 'snapshot-resume' (Get-SnapshotInventory) | Where-Object { $_ })
        if ($script:SnapshotHelperCode -ne 0) { throw 'Could not validate snapshot recovery. Keep the marker and check other writers or changed containers.' }
        if ($restoreIds.Count) {
            & docker start @restoreIds > $null
            if ($LASTEXITCODE -ne 0) { throw 'Could not restart the original services. Run recover-snapshot after fixing Docker.' }
        }
        for ($attempt = 0; $attempt -lt 90; $attempt++) {
            Invoke-SnapshotHelper 'snapshot-finish' (Get-SnapshotInventory)
            if ($script:SnapshotHelperCode -eq 0) {
                Write-Host 'Previous running state restored. Services that were stopped stayed stopped.'
                return
            }
            if ($script:SnapshotHelperCode -ne 2) { throw 'Snapshot recovery remains pending. Check status and logs, then run recover-snapshot.' }
            Start-Sleep -Seconds 2
        }
        throw 'Services did not become ready. Check status and logs, then run recover-snapshot.'
    }
    if ($Recover) { Resume-Snapshot; return }
    Invoke-SnapshotHelper 'snapshot-begin' (Get-SnapshotInventory)
    if ($script:SnapshotHelperCode -ne 0) { throw 'Snapshot preflight did not complete. Existing services were not stopped.' }
    try {
        $original = @(Invoke-SnapshotHelper 'snapshot-originals' (Get-SnapshotInventory) | Where-Object { $_ })
        if ($script:SnapshotHelperCode -ne 0) { throw 'Could not validate the original service identities.' }
        Write-Host 'Stopping this HOME for a coordinated snapshot. Downtime lasts through capture and verification.'
        if ($original.Count) {
            & docker stop --timeout 30 @original > $null
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop all original services; snapshot refused.' }
        }
        $quiet = Invoke-SnapshotHelper 'snapshot-check' (Get-SnapshotInventory)
        if ($script:SnapshotHelperCode -ne 0) { throw 'Could not establish the shared offline interval.' }
        $job = Invoke-SnapshotHelper 'snapshot-job'
        if ($script:SnapshotHelperCode -ne 0) { throw 'Could not read snapshot identity.' }
        $mounts = @(Invoke-SnapshotHelper 'snapshot-mounts')
        if ($script:SnapshotHelperCode -ne 0) { throw 'Could not validate snapshot source mounts.' }
        $snapshotArgs = @('run','--rm','--network','none','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--cap-add','CHOWN','--security-opt','no-new-privileges',
            '--label',"home.snapshot.job=$job",'--mount',"type=bind,source=$Destination,target=/destination")
        foreach ($mount in $mounts) {
            if ($mount -notmatch '^([a-zA-Z0-9_-]+)=([a-zA-Z0-9_-]+)$') { throw 'Invalid snapshot source mount.' }
            $snapshotArgs += @('--mount',"type=bind,source=$RootFolder/data/$($Matches[1]),target=/sources/$($Matches[2]),readonly")
        }
        $deadline = if ($env:BACKUP_TIMEOUT_SECONDS) { $env:BACKUP_TIMEOUT_SECONDS } else { '3600' }
        & docker @snapshotArgs --entrypoint python3 $BackupImage /coordinated.py /sources /destination --confirm-offline --quiesced-at $quiet --timeout $deadline
        if ($LASTEXITCODE -ne 0) { throw 'Coordinated snapshot failed. Earlier snapshots were kept.' }
    } finally {
        Resume-Snapshot
    }
}
if ($Action -eq 'recover-snapshot') {
    Invoke-CoordinatedSnapshot -RootFolder $PSScriptRoot -Recover
    exit 0
}
if ($Action -in @('stop','status','logs')) {
    $command = @{stop='stop'; status='ps'; logs='logs'}[$Action]
    docker compose -f compose.json $command
    exit $LASTEXITCODE
}
if ($Action -in @('export-backups','verify-backups','snapshot')) {
    if (-not $PreviousFolder) { throw 'Pass an existing mounted destination folder, or an export folder to verify.' }
    $destination = (Resolve-Path -LiteralPath $PreviousFolder).Path
    $current = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\','/')
    if (-not (Test-Path -LiteralPath $destination -PathType Container)) { throw 'Backup destination must be an existing directory.' }
    foreach ($candidate in @($destination, $current)) {
        $cursor = $candidate
        while ($cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Backup paths must not pass through links or junctions.' }
            $parent = [IO.Directory]::GetParent($cursor)
            $cursor = if ($parent) { $parent.FullName } else { $null }
        }
    }
    if ($env:OS -eq 'Windows_NT') {
        # Resolve-Path can retain 8.3 aliases in ancestors. Expand both paths
        # before comparing, without treating an alias as separate storage.
        if (-not ('HomeExportPaths' -as [type])) {
            Add-Type @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class HomeExportPaths {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetLongPathName(string source, StringBuilder target, uint size);
    public static string Expand(string source) {
        var target = new StringBuilder(32768);
        uint length = GetLongPathName(source, target, (uint)target.Capacity);
        if (length == 0 || length >= target.Capacity) throw new IOException("Could not normalize the backup storage path.");
        return target.ToString();
    }
}
'@
        }
        $destination = [HomeExportPaths]::Expand($destination)
        $current = [HomeExportPaths]::Expand($current).TrimEnd('\','/')
    }
    $comparison = [StringComparison]::OrdinalIgnoreCase
    $boundary = $destination.TrimEnd('\','/')
    if (($boundary + '\').StartsWith($current + '\', $comparison) -or ($current + '\').StartsWith($boundary + '\', $comparison) -or
        ($boundary + '/').StartsWith($current + '/', $comparison) -or ($current + '/').StartsWith($boundary + '/', $comparison) -or $destination.Contains(',')) {
        throw 'Backup storage must be outside the installation, non-nested, and use a path without commas.'
    }
    $backupImage = @(docker compose -f compose.json images -q backup)
    if ($LASTEXITCODE -ne 0 -or $backupImage.Count -ne 1 -or $backupImage[0] -notmatch '^(sha256:)?[a-f0-9]{12,64}$') { throw 'Start HOME once so its backup image is available.' }
    if ($Action -eq 'snapshot') {
        Invoke-CoordinatedSnapshot -RootFolder $current -Destination $destination -BackupImage $backupImage[0]
        exit 0
    }
    $exportArgs = @('run','--rm','--network','none','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges')
    if ($Action -eq 'export-backups') {
        $exportArgs += @('--cap-add','CHOWN')
        $exportArgs += @('--mount',"type=bind,source=$PSScriptRoot/backups,target=/backups,readonly",'--mount',"type=bind,source=$destination,target=/destination")
        $exportArgs += @('--entrypoint','python3',$backupImage[0],'/export.py','/backups','/destination')
    } else {
        $exportArgs += @('--mount',"type=bind,source=$destination,target=/export,readonly",'--entrypoint','python3',$backupImage[0],'/export.py','--verify','/export')
    }
    & docker @exportArgs
    exit $LASTEXITCODE
}
$installerImage = (Get-Content -LiteralPath installer-image.txt -Raw).Trim()
if ($Action -eq 'diagnose') {
    $coreContainer = docker compose -f compose.json ps -q homecore
    if ($LASTEXITCODE -ne 0 -or -not $coreContainer) { throw 'Start HOME before running diagnostics.' }
    $homeNetwork = docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}' $coreContainer
    if ($LASTEXITCODE -ne 0 -or -not $homeNetwork) { throw 'Could not find this HOME network.' }
    & docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --network $homeNetwork.Trim() --mount "type=bind,source=$PSScriptRoot,target=/bundle,readonly" --entrypoint node $installerImage /bundle/setup/cli.mjs diagnose
    exit $LASTEXITCODE
}
docker image inspect $installerImage *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Loading the included HOME containers. This may take a few minutes.'
    docker load -i images.tar
    if ($LASTEXITCODE -ne 0) { throw 'Could not load HOME images.' }
}
if ($Action -in @('upgrade','import')) {
    if (-not $PreviousFolder) { throw 'Pass the old HOME or source checkout folder after the action.' }
    $previous = (Resolve-Path -LiteralPath $PreviousFolder).Path.TrimEnd('\','/')
    $current = (Resolve-Path -LiteralPath $PSScriptRoot).Path.TrimEnd('\','/')
    # Resolve-Path does not canonicalize every junction ancestor on Windows.
    # Reject aliases rather than risk copying a folder into its own storage.
    if ($env:OS -eq 'Windows_NT') {
        foreach ($candidate in @($previous, $current)) {
            $cursor = $candidate
            while ($cursor) {
                if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    throw 'Upgrade paths must not pass through symbolic links or junctions.'
                }
                $parent = [IO.Directory]::GetParent($cursor)
                $cursor = if ($parent) { $parent.FullName } else { $null }
            }
        }
    }
    $comparison = [System.StringComparison]::OrdinalIgnoreCase
    if ($previous.Equals($current, $comparison) -or ($previous + '\').StartsWith($current + '\', $comparison) -or ($current + '\').StartsWith($previous + '\', $comparison)) {
        throw 'Old and new folders must be separate and non-nested.'
    }
    if ($previous.Contains(',') -or $current.Contains(',')) { throw 'Installation paths must not contain commas.' }
    if ($Action -eq 'import') {
        $targetMount = @('--mount',"type=bind,source=$current,target=/bundle")
        $sourceMount = @('--mount',"type=bind,source=$previous,target=/source,readonly")
        # With --no-path-resolution, Compose reads relative env_file entries
        # against its working directory as well as retaining relative paths.
        Push-Location -LiteralPath $previous
        try {
            $resolved = docker compose --project-directory $previous -f (Join-Path $previous 'docker-compose.yml') --profile '*' config --no-path-resolution --format json
        } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the source Compose configuration.' }
        $project = ($resolved -join "`n") | docker run --rm -i @targetMount @sourceMount --entrypoint node $installerImage /bundle/setup/cli.mjs prepare-import
        if ($LASTEXITCODE -ne 0) { throw 'Source import preflight failed. The original was not changed.' }
        $resolved = $null
        $project = ($project | Out-String).Trim()
        if ($project -ne 'complete') {
            if ($project -notmatch '^[a-z0-9][a-z0-9_-]*$') { throw 'Invalid source project.' }
            $containers = @(docker ps -aq --filter "label=com.docker.compose.project=$project")
            if ($LASTEXITCODE -ne 0 -or -not $containers.Count) { throw 'Keep source containers present; use stop rather than down before import.' }
            foreach ($container in $containers) {
                $configFiles = docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' $container
                if ($LASTEXITCODE -ne 0 -or $configFiles -ne (Join-Path $previous 'docker-compose.yml')) { throw 'Source containers use another checkout or Compose overrides.' }
            }
            $inspected = docker inspect @containers
            if ($LASTEXITCODE -ne 0) { throw 'Could not inspect source containers.' }
            ($inspected -join "`n") | docker run --rm -i @targetMount --entrypoint node $installerImage /bundle/setup/cli.mjs check-import-containers
            if ($LASTEXITCODE -ne 0) { throw 'Source container settings or storage do not match.' }
            $inspected = $null
            $volumes = @(docker run --rm @targetMount --entrypoint node $installerImage /bundle/setup/cli.mjs import-mounts)
            if ($LASTEXITCODE -ne 0) { throw 'Could not read the verified source volume plan.' }
            $available = @(docker volume ls --format '{{.Name}}')
            if ($LASTEXITCODE -ne 0) { throw 'Could not inspect source volumes.' }
            $importArgs = @('run','--rm') + $targetMount + $sourceMount + @('--mount',"type=bind,source=$previous/backups,target=/import-source/backups,readonly")
            foreach ($line in $volumes) {
                $logical, $actual = $line -split '=', 2
                if ($available -notcontains $actual) {
                    if ($logical -in @('caddy_data','caddy_config')) { continue }
                    throw 'A required source volume is missing; import refused.'
                }
                $metadata = docker volume inspect $actual
                if ($LASTEXITCODE -ne 0) { throw 'Could not inspect a source volume.' }
                ($metadata -join "`n") | docker run --rm -i @targetMount --entrypoint node $installerImage /bundle/setup/cli.mjs check-import-volume $logical
                if ($LASTEXITCODE -ne 0) { throw 'A source volume has unexpected ownership or storage options.' }
                $importArgs += @('--mount',"type=volume,source=$actual,target=/import-source/data/$logical,readonly,volume-nocopy")
            }
            Write-Host 'Stopping source HOME and verifying that no other containers use its volumes.'
            docker compose --project-name $project --project-directory $previous -f (Join-Path $previous 'docker-compose.yml') --profile '*' stop
            if ($LASTEXITCODE -ne 0) { throw 'Could not stop source HOME.' }
            $running = docker ps -q --filter "label=com.docker.compose.project=$project"
            if ($LASTEXITCODE -ne 0 -or $running) { throw 'Source containers are still running; import refused.' }
            foreach ($line in $volumes) {
                $logical, $actual = $line -split '=', 2
                $writers = docker ps -q --filter "volume=$actual"
                if ($LASTEXITCODE -ne 0 -or $writers) { throw 'Another container may be using source storage; import refused.' }
            }
            & docker @importArgs --entrypoint node $installerImage /bundle/setup/cli.mjs import-source --confirm-stopped
            if ($LASTEXITCODE -ne 0) { throw 'Source import did not complete. Keep both copies and rerun the same import action.' }
        }
        docker compose -f compose.json up -d --wait --wait-timeout 180 --remove-orphans
        if ($LASTEXITCODE -ne 0) { throw 'Import copied successfully but startup failed. Preserve the original and follow START-HERE.md recovery.' }
        Write-Host 'HOME imported. Sign in locally with your existing account. Keep source volumes offline for recovery.'
        exit 0
    }
    $mounts = @('--mount',"type=bind,source=$current,target=/bundle",'--mount',"type=bind,source=$previous,target=/previous,readonly")
    $project = & docker run --rm @mounts --entrypoint node $installerImage /bundle/setup/cli.mjs check-upgrade
    if ($LASTEXITCODE -ne 0) { throw 'Upgrade preflight failed. Original data was not changed.' }
    $project = ($project | Out-String).Trim()
    if ($project -ne 'complete') {
        if ($project -notmatch '^home-server-[a-f0-9-]{36}$') { throw 'Invalid upgrade project.' }
        $containers = docker ps -aq --filter "label=com.docker.compose.project=$project"
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the source project; upgrade refused.' }
        foreach ($container in $containers) {
            $configFiles = docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' $container
            if ($LASTEXITCODE -ne 0 -or $configFiles -ne (Join-Path $previous 'compose.json')) {
                throw 'This project uses another folder or Compose overrides; migration refused.'
            }
        }
        Write-Host 'Stopping the old HOME (including optional services) before making a verified copy. Keep both folders private.'
        docker compose --project-name $project -f (Join-Path $previous 'compose.json') --profile '*' stop
        if ($LASTEXITCODE -ne 0) { throw 'Could not stop the old HOME; upgrade refused.' }
        $running = docker ps -q --filter "label=com.docker.compose.project=$project"
        if ($LASTEXITCODE -ne 0 -or $running) { throw 'Could not establish that all source containers stopped; upgrade refused.' }
        & docker run --rm @mounts --entrypoint node $installerImage /bundle/setup/cli.mjs upgrade --confirm-stopped
        if ($LASTEXITCODE -ne 0) { throw 'Upgrade did not complete. Preserve both folders and rerun the same upgrade action.' }
    }
    docker compose -f compose.json up -d --wait --wait-timeout 180 --remove-orphans
    if ($LASTEXITCODE -ne 0) { throw 'Upgrade copied successfully but startup failed. Preserve both folders and see START-HERE.md recovery.' }
    Write-Host 'HOME upgraded. Start and manage it from this new folder only.'
    exit 0
}
$runArgs = @('run','--rm','-it')
if ($Action -eq 'access') {
    docker compose -f compose.json stop tls
    if ($LASTEXITCODE -ne 0) { throw 'Start HOME before changing access.' }
    $coreContainer = docker compose -f compose.json ps -q homecore
    if ($LASTEXITCODE -ne 0 -or -not $coreContainer) { throw 'Start HOME before changing access.' }
    $homeNetwork = docker inspect --format '{{range $name, $value := .NetworkSettings.Networks}}{{$name}}{{end}}' $coreContainer
    if ($LASTEXITCODE -ne 0 -or -not $homeNetwork) { throw 'Could not find this HOME network.' }
    $runArgs += @('--network',$homeNetwork.Trim())
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
