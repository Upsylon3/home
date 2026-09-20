Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Test-Command($name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
if (-not (Test-Command 'node') -or -not (Test-Command 'npm')) {
    [System.Windows.Forms.MessageBox]::Show('Node.js 20+ and npm are required and must be in PATH.', 'Home Dev Launcher', 'OK', 'Error')
    exit 1
}

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm install' -WorkingDirectory $root -Wait -PassThru
    if ($p.ExitCode -ne 0) { [System.Windows.Forms.MessageBox]::Show('npm install failed. Check the terminal output.', 'Home Dev Launcher', 'OK', 'Error'); exit 1 }
}

$services = @(
    @{ Key='homecloud'; Name='HomeCloud'; Detail='Frontend  :5173 + backend :4500'; Path='apps\homecloud'; Backend='apps\homecloud-backend' },
    @{ Key='homemedia'; Name='HomeMedia'; Detail='Frontend  :5175 + backend :4200'; Path='apps\homemedia'; Backend='apps\homemedia-backend' },
    @{ Key='homenotes'; Name='HomeNotes'; Detail='Frontend  :5176 + backend :4400'; Path='apps\homenotes'; Backend='apps\homenotes-backend' },
    @{ Key='homesync'; Name='HomeSync backend'; Detail='Backend   :4300 (Android client not launched)'; Path=$null; Backend='apps\homesync-backend' },
    @{ Key='homevault'; Name='HomeVault'; Detail='Frontend  :5177 + backend :4600 (v0, not yet security-reviewed)'; Path='apps\homevault'; Backend='apps\homevault-backend' }
)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Home — Development Launcher'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(470, 390)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Home development stack'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(24, 18)
$title.AutoSize = $true
$form.Controls.Add($title)

$desc = New-Object System.Windows.Forms.Label
$desc.Text = 'Always starts HomeCore, HomeCloud backend and Home dashboard.'
$desc.Location = New-Object System.Drawing.Point(26, 52)
$desc.AutoSize = $true
$form.Controls.Add($desc)

$group = New-Object System.Windows.Forms.GroupBox
$group.Text = 'Optional applications'
$group.Location = New-Object System.Drawing.Point(22, 82)
$group.Size = New-Object System.Drawing.Size(410, 185)
$form.Controls.Add($group)

$checks = @{}
$y = 24
foreach ($svc in $services) {
    $cb = New-Object System.Windows.Forms.CheckBox
    $cb.Text = $svc.Name
    $cb.Location = New-Object System.Drawing.Point(16, $y)
    $cb.AutoSize = $true
    $checks[$svc.Key] = $cb
    $group.Controls.Add($cb)

    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $svc.Detail
    $lbl.Location = New-Object System.Drawing.Point(145, ($y + 2))
    $lbl.AutoSize = $true
    $group.Controls.Add($lbl)
    $y += 38
}

$selectAll = New-Object System.Windows.Forms.Button
$selectAll.Text = 'Select all'
$selectAll.Location = New-Object System.Drawing.Point(24, 282)
$selectAll.Size = New-Object System.Drawing.Size(90, 30)
$selectAll.Add_Click({ foreach ($c in $checks.Values) { $c.Checked = $true } })
$form.Controls.Add($selectAll)

$clear = New-Object System.Windows.Forms.Button
$clear.Text = 'Clear'
$clear.Location = New-Object System.Drawing.Point(120, 282)
$clear.Size = New-Object System.Drawing.Size(70, 30)
$clear.Add_Click({ foreach ($c in $checks.Values) { $c.Checked = $false } })
$form.Controls.Add($clear)

$launch = New-Object System.Windows.Forms.Button
$launch.Text = 'Launch development stack'
$launch.Font = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
$launch.Location = New-Object System.Drawing.Point(210, 280)
$launch.Size = New-Object System.Drawing.Size(222, 34)
$form.Controls.Add($launch)
$form.AcceptButton = $launch

$launch.Add_Click({
    try {
        $devSecret = 'home-dev-only-change-me'

        foreach ($dir in @('homecore\data','apps\homecloud-backend\data','apps\homemedia-backend\data','apps\homenotes-backend\data','apps\homesync-backend\data','apps\homevault-backend\data')) {
            $full = Join-Path $root $dir
            if (-not (Test-Path $full)) { New-Item -ItemType Directory -Path $full -Force | Out-Null }
        }
        foreach ($env in @('homecore\.env','apps\homecloud-backend\.env','apps\homemedia-backend\.env','apps\homenotes-backend\.env','apps\homesync-backend\.env','apps\homevault-backend\.env')) {
            $full = Join-Path $root $env
            if (-not (Test-Path $full)) {
                $example = "$full.example"
                if (Test-Path $example) { Copy-Item $example $full }
            }
        }

        # Env is an ARRAY of 'KEY=VALUE' strings, not one space-joined string —
        # deliberately, so a value containing a space (very common in a
        # Windows path like 'C:\Users\Jane Smith\...') can't corrupt the
        # command line below. The old approach built one long string and
        # split it back apart on spaces, which breaks the moment $root
        # itself contains one.
        $cmds = @()
        $cmds += @{ Title='HomeCore - :4000'; Dir='homecore'; Env=@(
            'PORT=4000',
            'DATA_DIR=' + (Join-Path $root 'homecore\data'),
            'CORS_ORIGIN=http://localhost:5174',
            'JWT_SECRET=' + $devSecret,
            'HOMECORE_INTERNAL_SECRET=' + $devSecret,
            'HOMECLOUD_FRONTEND_URL=http://localhost:5173/',
            'HOMEMEDIA_FRONTEND_URL=http://localhost:5175/',
            'HOMENOTES_FRONTEND_URL=http://localhost:5176/',
            'HOMESYNC_INFO_URL=http://localhost:4300/',
            'HOMEVAULT_FRONTEND_URL=http://localhost:5177/'
        ); Run='npm run dev' }

        $cmds += @{ Title='HomeCloud backend - :4500'; Dir='apps\homecloud-backend'; Env=@(
            'PORT=4500',
            'DATA_DIR=' + (Join-Path $root 'apps\homecloud-backend\data'),
            'CORS_ORIGIN=http://localhost:5174',
            'HOMECORE_INTERNAL_URL=http://localhost:4000',
            'HOMECORE_INTERNAL_SECRET=' + $devSecret
        ); Run='npm run dev' }

        $cmds += @{ Title='Home dashboard - :5174'; Dir='apps\home'; Env=@(); Run='npm run dev' }

        if ($checks['homecloud'].Checked) {
            $cmds += @{ Title='HomeCloud frontend - :5173'; Dir='apps\homecloud'; Env=@(); Run='npm run dev' }
        }
        if ($checks['homemedia'].Checked) {
            $cmds += @{ Title='HomeMedia backend - :4200'; Dir='apps\homemedia-backend'; Env=@(
                'PORT=4200',
                'DATA_DIR=' + (Join-Path $root 'apps\homemedia-backend\data'),
                'HOMECORE_INTERNAL_URL=http://localhost:4000',
                'HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500',
                'HOMECORE_INTERNAL_SECRET=' + $devSecret
            ); Run='npm run dev' }
            $cmds += @{ Title='HomeMedia frontend - :5175'; Dir='apps\homemedia'; Env=@(); Run='npm run dev' }
        }
        if ($checks['homenotes'].Checked) {
            $cmds += @{ Title='HomeNotes backend - :4400'; Dir='apps\homenotes-backend'; Env=@(
                'PORT=4400',
                'DATA_DIR=' + (Join-Path $root 'apps\homenotes-backend\data'),
                'HOMECORE_INTERNAL_URL=http://localhost:4000',
                'HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500',
                'HOMECORE_INTERNAL_SECRET=' + $devSecret
            ); Run='npm run dev' }
            $cmds += @{ Title='HomeNotes frontend - :5176'; Dir='apps\homenotes'; Env=@(); Run='npm run dev' }
        }
        if ($checks['homesync'].Checked) {
            $cmds += @{ Title='HomeSync backend - :4300'; Dir='apps\homesync-backend'; Env=@(
                'PORT=4300',
                'DATA_DIR=' + (Join-Path $root 'apps\homesync-backend\data'),
                'HOMECORE_INTERNAL_URL=http://localhost:4000',
                'HOMECLOUD_BACKEND_INTERNAL_URL=http://localhost:4500',
                'HOMECORE_INTERNAL_SECRET=' + $devSecret
            ); Run='npm run dev' }
        }
        if ($checks['homevault'].Checked) {
            # No HOMECLOUD_BACKEND_INTERNAL_URL — HomeVault is the only
            # backend with zero dependency on apps/homecloud-backend.
            $cmds += @{ Title='HomeVault backend - :4600'; Dir='apps\homevault-backend'; Env=@(
                'PORT=4600',
                'DATA_DIR=' + (Join-Path $root 'apps\homevault-backend\data'),
                'HOMECORE_INTERNAL_URL=http://localhost:4000'
            ); Run='npm run dev' }
            $cmds += @{ Title='HomeVault frontend - :5177'; Dir='apps\homevault'; Env=@(); Run='npm run dev' }
        }

        # Each service used to be launched as one long quoted command line
        # ('cd /d "..." && set "K=V" && set "K=V" && ... && npm run dev')
        # handed to cmd.exe /k through PowerShell's own argument quoting.
        # That line ends up with a dozen-plus embedded '"' characters.
        # cmd.exe only reliably preserves quoting when the whole line has
        # EXACTLY two quote characters; with more than that it falls back
        # to a crude "strip the first quote, strip the last quote" rule,
        # which can sever a `set "KEY=VALUE"` from its value and leave a
        # bare `set "<path>"` behind — hence the
        # "Environment variable <path> not defined" errors.
        # Writing each service's commands to its own temp .bat file avoids
        # this entirely: cmd /k then only ever receives one single quoted
        # file path, never a multiply-quoted one-liner.
        $tmpDir = Join-Path $root '.dev-launch'
        if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
        New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

        foreach ($c in $cmds) {
            $dir = Join-Path $root $c.Dir
            $lines = @('@echo off', ('title ' + $c.Title), ('cd /d "' + $dir + '"'))
            foreach ($kv in $c.Env) { $lines += ('set "' + $kv + '"') }
            $lines += $c.Run
            $safeName = ($c.Title -replace '[^a-zA-Z0-9]+', '_')
            $batPath = Join-Path $tmpDir ($safeName + '.bat')
            Set-Content -Path $batPath -Value $lines -Encoding ASCII
            Start-Process 'cmd.exe' -ArgumentList '/k', $batPath -WorkingDirectory $dir
        }

        $form.Close()
    } catch {
        [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Home Dev Launcher', 'OK', 'Error')
    }
})

[void]$form.ShowDialog()
