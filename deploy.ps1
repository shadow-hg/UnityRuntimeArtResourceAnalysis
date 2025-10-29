[CmdletBinding()]
param (
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$NoStart,
    [ValidateSet('Auto', 'Process', 'Pm2')]
    [string]$Mode = 'Auto',
    [int]$ServerPort = 48080,
    [int]$WebPort = 5175,
    [string]$ServerProcessName = 'unity-telemetry-server',
    [string]$WebProcessName = 'unity-telemetry-web'
)

$ErrorActionPreference = 'Stop'

function Write-Section {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Ensure-Command {
    param([Parameter(Mandatory = $true)][string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Get-CommandPath {
    param([Parameter(Mandatory = $true)][string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $cmd) { return $null }
    return $cmd.Source
}

function Join-Arguments {
    param([string[]]$Arguments)
    if (-not $Arguments) { return '' }
    return ($Arguments | ForEach-Object {
        if ($_ -eq $null) { '' }
        elseif ($_ -eq '') { '""' }
        elseif ($_ -match '[\s\"\^]') { '"' + ($_ -replace '"', '""') + '"' }
        else { $_ }
    }) -join ' '
}

function Invoke-Executable {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [hashtable]$Environment,
        [switch]$PassThru,
        [string]$DisplayName,
        [switch]$IgnoreExitCode
    )

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError = $false
    $psi.CreateNoWindow = $true
    $psi.Arguments = Join-Arguments -Arguments $ArgumentList

    if ($Environment) {
        foreach ($key in $Environment.Keys) {
            $value = $Environment[$key]
            if ($null -eq $value) { $value = '' }
            $psi.Environment[$key] = [string]$value
        }
    }

    $process = [System.Diagnostics.Process]::Start($psi)
    if ($PassThru) { return $process }

    $process.WaitForExit()
    if (-not $IgnoreExitCode -and $process.ExitCode -ne 0) {
        $name = if ($DisplayName) { $DisplayName } else { $FilePath }
        throw "Command '$name' failed with exit code $($process.ExitCode)."
    }
}

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)][string]$Description,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Section $Description
    & $Action
}

function Invoke-Npm {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [string]$DisplayName
    )
    Invoke-Executable -FilePath $script:npmPath -ArgumentList $Args -WorkingDirectory $WorkingDirectory -DisplayName $DisplayName
}

function Invoke-Pm2 {
    param(
        [Parameter(Mandatory = $true)][string[]]$Args,
        [switch]$IgnoreExitCode
    )
    Invoke-Executable -FilePath $script:pm2Path -ArgumentList $Args -DisplayName "pm2 $($Args -join ' ')" -IgnoreExitCode:$IgnoreExitCode
}

function Start-BackgroundProcess {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [hashtable]$Environment
    )

    Write-Host "Starting $Name..."
    $process = Invoke-Executable -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -Environment $Environment -PassThru -DisplayName $Name
    Start-Sleep -Seconds 2
    if ($process.HasExited) {
        throw "$Name exited immediately with code $($process.ExitCode)."
    }
    Write-Host "$Name is running (PID=$($process.Id))."
    return $process
}

$scriptDir = Split-Path -Path $PSCommandPath -Parent
$serverDir = Join-Path $scriptDir 'server'
$webDir = Join-Path $scriptDir 'web'

Ensure-Command -Name 'node'
Ensure-Command -Name 'npm'

$npmPath = Get-CommandPath -Name 'npm.cmd'
if (-not $npmPath) { $npmPath = Get-CommandPath -Name 'npm' }
if (-not $npmPath) {
    throw "Unable to locate npm executable."
}

$nodePath = Get-CommandPath -Name 'node.exe'
if (-not $nodePath) { $nodePath = Get-CommandPath -Name 'node' }
if (-not $nodePath) {
    throw "Unable to locate node executable."
}

$pm2Path = Get-CommandPath -Name 'pm2.cmd'
if (-not $pm2Path) { $pm2Path = Get-CommandPath -Name 'pm2' }

switch ($Mode) {
    'Auto' {
        $usePm2 = [bool]$pm2Path
    }
    'Pm2' {
        if (-not $pm2Path) {
            throw "Mode 'Pm2' was requested but pm2 is not installed. Install it with 'npm install -g pm2'."
        }
        $usePm2 = $true
    }
    'Process' {
        $usePm2 = $false
    }
}

if ($usePm2) {
    Write-Host "Using PM2 to manage background processes."
} else {
    Write-Host "Using plain PowerShell processes. They will stop when this script exits." -ForegroundColor Yellow
}

Invoke-Step -Description 'Ensuring required directories exist' -Action {
    New-Item -ItemType Directory -Path (Join-Path $serverDir 'data') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $webDir 'dist') -Force | Out-Null
}

if (-not $SkipInstall) {
    Invoke-Step -Description 'Installing server dependencies' -Action {
        Invoke-Npm -Args @('install', '--production') -WorkingDirectory $serverDir -DisplayName 'npm install --production (server)'
    }

    Invoke-Step -Description 'Installing web dependencies' -Action {
        Invoke-Npm -Args @('install') -WorkingDirectory $webDir -DisplayName 'npm install (web)'
    }
} else {
    Write-Host 'Skipping dependency installation as requested.'
}

if (-not $SkipBuild) {
    Invoke-Step -Description 'Building web dashboard' -Action {
        Invoke-Npm -Args @('run', 'build') -WorkingDirectory $webDir -DisplayName 'npm run build (web)'
    }
} else {
    Write-Host 'Skipping web build as requested.'
}

if ($NoStart) {
    Write-Host 'Deployment artifacts prepared. Skipping process startup.'
    return
}

if ($usePm2) {
    Invoke-Step -Description 'Starting API server via PM2' -Action {
        Invoke-Pm2 -Args @('delete', $ServerProcessName) -IgnoreExitCode
        Invoke-Pm2 -Args @(
            'start',
            (Join-Path $serverDir 'src/server.js'),
            '--name', $ServerProcessName,
            '--cwd', $serverDir,
            '--',
            "PORT=$ServerPort"
        )
    }

    Invoke-Step -Description 'Starting web dashboard via PM2' -Action {
        Invoke-Pm2 -Args @('delete', $WebProcessName) -IgnoreExitCode
        Invoke-Pm2 -Args @(
            'start',
            $npmPath,
            '--name', $WebProcessName,
            '--cwd', $webDir,
            '--',
            'run', 'preview', '--', '--host', '0.0.0.0', '--port', $WebPort.ToString(), '--strictPort'
        )
    }

    Write-Section 'PM2 status'
    Invoke-Pm2 -Args @('status')
    Write-Host "Use 'pm2 save' to persist the process list and 'pm2 logs <name>' to inspect logs." -ForegroundColor Green
    return
}

$backgroundProcesses = @()
try {
    $backgroundProcesses += Start-BackgroundProcess -Name 'Unity telemetry API server' -FilePath $nodePath -ArgumentList @((Join-Path $serverDir 'src/server.js')) -WorkingDirectory $serverDir -Environment @{ PORT = $ServerPort }

    $backgroundProcesses += Start-BackgroundProcess -Name 'Unity telemetry web preview' -FilePath $npmPath -ArgumentList @('run', 'preview', '--', '--host', '0.0.0.0', '--port', $WebPort.ToString(), '--strictPort') -WorkingDirectory $webDir -Environment @{}

    Write-Host "Both services are running. Press Ctrl+C to stop them." -ForegroundColor Green
    Wait-Process -Id ($backgroundProcesses | ForEach-Object { $_.Id })
} finally {
    foreach ($proc in $backgroundProcesses) {
        if ($proc -and -not $proc.HasExited) {
            try {
                $proc.Kill()
            } catch {
                Write-Warning "Unable to stop process with PID $($proc.Id): $($_.Exception.Message)"
            }
        }
    }
}
