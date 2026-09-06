#requires -Version 7.0
[CmdletBinding()]
param(
    [string]$Version,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../artifacts/collector')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release-common.ps1')
$extensionRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../browser-extension'))
$manifest = Get-Content -LiteralPath (Join-Path $extensionRoot 'manifest.json') -Raw | ConvertFrom-Json
if (-not $Version) { $Version = $manifest.version }
$release = Get-ReleaseVersion -Version $Version
if ($release.NumericVersion -eq '0.0.0') { throw 'Chromium extension version must not be all zero.' }
if ($manifest.manifest_version -ne 3) { throw 'Collector must use Manifest V3.' }

# Keep the distributable explicit: no local credentials, test harnesses, or
# unrelated repository files are copied into the extension package.
$files = @('manifest.json', 'background.js', 'chatgpt-locators.js', 'content-script.js', 'popup.html', 'popup.css', 'popup.js', 'README.md')
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $extensionRoot $file) -PathType Leaf)) {
        throw "Collector package file is missing: $file"
    }
}
$stage = New-ReleaseStage -OutputDirectory $OutputDirectory
try {
    foreach ($file in $files) {
        Copy-Item -LiteralPath (Join-Path $extensionRoot $file) -Destination (Join-Path $stage.Payload $file)
    }
    $manifest.version = $release.NumericVersion
    $manifest | Add-Member -MemberType NoteProperty -Name version_name -Value $release.Version -Force
    $manifestJson = ($manifest | ConvertTo-Json -Depth 30) + "`n"
    [IO.File]::WriteAllText((Join-Path $stage.Payload 'manifest.json'), $manifestJson, [Text.UTF8Encoding]::new($false))
    Complete-ReleasePackage -Component collector -Version $Version -Stage $stage
}
finally {
    Remove-ReleaseStage -Stage $stage
}
