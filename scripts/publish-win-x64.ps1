#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
    [string]$Version,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../artifacts/desktop'),
    [string]$SourceRevisionId,
    [switch]$NoRestore
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-common.ps1')
$projectPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../src/ChatGPTComfyConnector.Desktop/ChatGPTComfyConnector.Desktop.csproj'))
if (-not $Version) {
    [xml]$project = Get-Content -LiteralPath $projectPath -Raw
    $prefix = $project.SelectSingleNode('//VersionPrefix').InnerText
    $suffix = $project.SelectSingleNode('//VersionSuffix')
    $Version = if ($suffix -and $suffix.InnerText) { "$prefix-$($suffix.InnerText)" } else { $prefix }
}
$null = Get-ReleaseVersion -Version $Version
if ($SourceRevisionId -and $SourceRevisionId -notmatch '\A[a-fA-F0-9]{7,64}\z') {
    throw 'SourceRevisionId must be a git commit hash.'
}
$stage = New-ReleaseStage -OutputDirectory $OutputDirectory
try {
    $publishArguments = @(
        'publish', $projectPath,
        '--configuration', $Configuration, '--runtime', 'win-x64', '--self-contained', 'true',
        '--output', $stage.Payload, "-p:Version=$Version",
        '-p:PublishSingleFile=false', '-p:DebugType=None', '-p:DebugSymbols=false',
        '-p:IncludeSourceRevisionInInformationalVersion=false'
    )
    if ($NoRestore) { $publishArguments += '--no-restore' }
    if ($SourceRevisionId) { $publishArguments += "-p:SourceRevisionId=$SourceRevisionId" }
    & dotnet @publishArguments | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "Desktop publish failed with exit code $LASTEXITCODE." }
    if (-not (Test-Path -LiteralPath (Join-Path $stage.Payload 'ChatGPTComfyConnector.Desktop.exe'))) {
        throw 'Desktop publish did not produce the application executable.'
    }
    foreach ($folder in @('config', 'data/sessions', 'logs', 'backups', 'cache')) {
        New-Item -ItemType Directory -Path (Join-Path $stage.Payload $folder) -Force | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $stage.Payload 'README.md'),
        (Get-ReleaseNotes -Component desktop -Version $Version), [Text.UTF8Encoding]::new($false))
    Complete-ReleasePackage -Component desktop -Version $Version -Stage $stage
}
finally {
    Remove-ReleaseStage -Stage $stage
}
