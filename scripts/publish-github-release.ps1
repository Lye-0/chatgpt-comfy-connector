#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('desktop', 'collector')][string]$Component,
    [Parameter(Mandatory)][string]$Tag,
    [Parameter(Mandatory)][ValidatePattern('\A[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\z')][string]$Repository,
    [Parameter(Mandatory)][string]$ZipPath,
    [Parameter(Mandatory)][string]$ChecksumPath,
    [Parameter(Mandatory)][string]$NotesPath
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-common.ps1')
$release = Get-ComponentRelease -Component $Component -Tag $Tag
$zipName = Get-ReleaseZipName -Component $Component -Version $release.Version
foreach ($file in @($ZipPath, $ChecksumPath, $NotesPath)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Release file is missing: $file" }
}
if ([IO.Path]::GetFileName($ZipPath) -cne $zipName -or [IO.Path]::GetFileName($ChecksumPath) -cne "$zipName.sha256") {
    throw 'Release assets must match the component and tag version.'
}
$hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([IO.File]::ReadAllText([IO.Path]::GetFullPath($ChecksumPath)).TrimEnd("`r", "`n") -cne "$hash  $zipName") {
    throw 'The SHA-256 file does not match the ZIP being published.'
}

function Invoke-ReleaseGh {
    param([Parameter(Mandatory)][string[]]$Arguments)
    $output = & gh @Arguments 2>&1
    $result = $LASTEXITCODE
    $output | ForEach-Object { Write-Host $_ }
    if ($result -ne 0) { throw "GitHub release command failed with exit code ${result}: $($Arguments[0..1] -join ' ')" }
}

$releaseTitle = if ($Component -eq 'desktop') { "ChatGPT Comfy Connector v$($release.Version)" } else { "ChatGPT Comfy Collector v$($release.Version)" }
$viewArguments = @('release', 'view', $Tag, '--repo', $Repository, '--json', 'tagName,isDraft')
$viewOutput = & gh @viewArguments 2>&1
$viewExitCode = $LASTEXITCODE
if ($viewExitCode -ne 0) {
    if (($viewOutput | Out-String) -notmatch '(?i)release not found|HTTP 404') {
        throw "Could not inspect release ${Tag}: $($viewOutput | Out-String)"
    }
    # Keep a new release private until both tested assets have been uploaded.
    $createArguments = @('release', 'create', $Tag, '--repo', $Repository,
        '--verify-tag', '--draft', '--title', $releaseTitle, '--notes-file', $NotesPath)
    if ($release.IsPrerelease) { $createArguments += '--prerelease' }
    if ($Component -eq 'collector') { $createArguments += '--latest=false' }
    Invoke-ReleaseGh -Arguments $createArguments
}
else {
    $existing = ($viewOutput | Out-String) | ConvertFrom-Json
    if ($existing.tagName -cne $Tag) { throw 'GitHub returned an unexpected release tag.' }
}

Invoke-ReleaseGh -Arguments @('release', 'upload', $Tag, '--repo', $Repository, $ZipPath, $ChecksumPath, '--clobber')
$editArguments = @('release', 'edit', $Tag, '--repo', $Repository,
    '--verify-tag', '--title', $releaseTitle, '--draft=false',
    "--prerelease=$($release.IsPrerelease.ToString().ToLowerInvariant())")
# GitHub has one Latest slot per repository; keep Collector releases from
# replacing the Desktop download entry point.
if ($Component -eq 'collector') { $editArguments += '--latest=false' }
Invoke-ReleaseGh -Arguments $editArguments
