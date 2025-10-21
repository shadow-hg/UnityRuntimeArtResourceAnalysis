[CmdletBinding()]
param (
    [int]$ServerPort,
    [int]$WebPort
)

$ErrorActionPreference = 'Stop'

function Ensure-Command {
    param (
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' is required to run this script."
    }
}

function Invoke-KillPort {
    param (
        [Parameter(Mandatory = $true)][int]$Port
    )

    Write-Host "Ensuring port $Port is available..."
    try {
        & npx --yes kill-port $Port | Out-Null
    } catch {
        Write-Warning "Unable to free port $Port automatically. You may need to stop the process manually."
    }
}

$scriptDir = Split-Path -Path $PSCommandPath -Parent
$serverDir = Join-Path $scriptDir 'server'
$webDir = Join-Path $scriptDir 'web'

if ($PSBoundParameters.ContainsKey('ServerPort')) {
    $resolvedServerPort = $ServerPort
} elseif ($env:SERVER_PORT) {
    $resolvedServerPort = [int]$env:SERVER_PORT
} else {
    $resolvedServerPort = 48080
}

if ($PSBoundParameters.ContainsKey('WebPort')) {
    $resolvedWebPort = $WebPort
} elseif ($env:WEB_PORT) {
    $resolvedWebPort = [int]$env:WEB_PORT
} else {
    $resolvedWebPort = 5175
}

Ensure-Command -Name 'npx'
Ensure-Command -Name 'npm'

Invoke-KillPort -Port $resolvedServerPort
Invoke-KillPort -Port $resolvedWebPort

$originalPort = $env:PORT
$serverProcess = $null
$webProcess = $null

Push-Location $scriptDir
try {
    Write-Host "Starting API server on port $resolvedServerPort"
    $env:PORT = $resolvedServerPort.ToString()
    $serverProcess = Start-Process -FilePath 'npm' -ArgumentList 'run', 'dev' -WorkingDirectory $serverDir -NoNewWindow -PassThru

    Write-Host "Starting web client on port $resolvedWebPort"
    $env:PORT = $resolvedWebPort.ToString()
    $webProcess = Start-Process -FilePath 'npm' -ArgumentList 'run', 'dev' -WorkingDirectory $webDir -NoNewWindow -PassThru

    Write-Host "Both processes are running. Press Ctrl+C to stop."
    try {
        Wait-Process -Id $serverProcess.Id, $webProcess.Id
    } finally {
        Write-Host "Stopping dev servers..."
        foreach ($proc in @($serverProcess, $webProcess)) {
            if ($proc -and -not $proc.HasExited) {
                try {
                    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
                } catch {
                    Write-Warning "Unable to stop process with Id $($proc.Id)."
                }
            }
        }
    }
} finally {
    if ($null -ne $originalPort) {
        $env:PORT = $originalPort
    } else {
        Remove-Item Env:PORT -ErrorAction SilentlyContinue
    }

    Pop-Location
}
