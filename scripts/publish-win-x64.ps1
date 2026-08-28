param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$Version = '0.1.0-alpha'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$artifactRoot = Join-Path $repoRoot 'artifacts'
$stage = Join-Path $artifactRoot 'chatgpt-comfy-connector-win-x64'
$zip = Join-Path $artifactRoot "ChatGPTComfyConnector-v$Version-win-x64.zip"

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }

dotnet publish (Join-Path $repoRoot 'src/ChatGPTComfyConnector.Desktop/ChatGPTComfyConnector.Desktop.csproj') `
    --configuration $Configuration --runtime win-x64 --self-contained true `
    -p:PublishSingleFile=false -p:DebugType=None -p:DebugSymbols=false -o $stage

$extensionSource = Join-Path $repoRoot 'browser-extension'
$extensionDestination = Join-Path $stage 'browser-extension'
Copy-Item -LiteralPath $extensionSource -Destination $extensionDestination -Recurse -Force

foreach ($folder in @('config', 'data', 'data/sessions', 'logs', 'backups', 'cache')) {
    New-Item -ItemType Directory -Force -Path (Join-Path $stage $folder) | Out-Null
}

Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Write-Output "Portable publish: $stage"
Write-Output "ZIP: $zip"
