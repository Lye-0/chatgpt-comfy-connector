#requires -Version 7.0
Set-StrictMode -Version Latest

function Get-ReleaseVersion {
    param([Parameter(Mandatory)][string]$Version)

    $number = '(0|[1-9][0-9]*)'
    $identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
    $pattern = "\A(?<major>$number)\.(?<minor>$number)\.(?<patch>$number)(?:-(?<prerelease>$identifier(?:\.$identifier)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z"
    $match = [regex]::Match($Version, $pattern)
    if (-not $match.Success -or $Version.Length -gt 100) {
        throw "Invalid release version '$Version'. Use SemVer, for example 0.2.0 or 0.2.0-alpha.1."
    }
    foreach ($part in @('major', 'minor', 'patch')) {
        if ([decimal]$match.Groups[$part].Value -gt 65535) {
            throw 'Version components must be between 0 and 65535 for Desktop and Chromium packages.'
        }
    }
    [pscustomobject]@{
        Version = $Version
        NumericVersion = '{0}.{1}.{2}' -f $match.Groups['major'].Value, $match.Groups['minor'].Value, $match.Groups['patch'].Value
        IsPrerelease = $match.Groups['prerelease'].Success
    }
}

function Get-ComponentRelease {
    param(
        [Parameter(Mandatory)][ValidateSet('desktop', 'collector')][string]$Component,
        [Parameter(Mandatory)][string]$Tag
    )
    $prefix = $Component.ToLowerInvariant() + '-v'
    if (-not $Tag.StartsWith($prefix, [StringComparison]::Ordinal)) {
        throw "Release tag must start with '$prefix', for example ${prefix}0.2.0-alpha."
    }
    Get-ReleaseVersion -Version $Tag.Substring($prefix.Length)
}

function Get-ReleaseZipName {
    param(
        [Parameter(Mandatory)][ValidateSet('desktop', 'collector')][string]$Component,
        [Parameter(Mandatory)][string]$Version
    )
    $null = Get-ReleaseVersion -Version $Version
    if ($Component -eq 'desktop') { return "ChatGPT-Comfy-Connector-v$Version-win-x64.zip" }
    return "ChatGPT-Comfy-Collector-v$Version.zip"
}

function New-ReleaseStage {
    param([Parameter(Mandatory)][string]$OutputDirectory)
    $outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
    $stageRoot = Join-Path $outputRoot ('.stage-' + [guid]::NewGuid().ToString('N'))
    $payload = Join-Path $stageRoot 'payload'
    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    [pscustomobject]@{ OutputRoot = $outputRoot; Root = $stageRoot; Payload = $payload }
}

function Get-ReleaseNotes {
    param(
        [Parameter(Mandatory)][ValidateSet('desktop', 'collector')][string]$Component,
        [Parameter(Mandatory)][string]$Version
    )
    $zipName = Get-ReleaseZipName -Component $Component -Version $Version
    $template = Join-Path $PSScriptRoot "release-notes/$Component.md"
    [IO.File]::ReadAllText($template).Replace('{{VERSION}}', $Version).Replace('{{ZIP}}', $zipName)
}

function Remove-ReleaseStage {
    param([Parameter(Mandatory)]$Stage)
    $outputRoot = [IO.Path]::GetFullPath($Stage.OutputRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $stageRoot = [IO.Path]::GetFullPath($Stage.Root)
    if (-not $stageRoot.StartsWith($outputRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($stageRoot) -notmatch '\A\.stage-[a-f0-9]{32}\z') {
        throw "Refusing to remove an unexpected staging directory: $stageRoot"
    }
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}

function Complete-ReleasePackage {
    param(
        [Parameter(Mandatory)][ValidateSet('desktop', 'collector')][string]$Component,
        [Parameter(Mandatory)][string]$Version,
        [Parameter(Mandatory)]$Stage
    )
    $zipName = Get-ReleaseZipName -Component $Component -Version $Version
    $zipPath = Join-Path $Stage.OutputRoot $zipName
    $temporaryZip = Join-Path $Stage.Root 'package.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($Stage.Payload, $temporaryZip, [IO.Compression.CompressionLevel]::Optimal, $false)
    $hash = (Get-FileHash -LiteralPath $temporaryZip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::Move($temporaryZip, $zipPath, $true)
    $checksumPath = "$zipPath.sha256"
    [IO.File]::WriteAllText($checksumPath, "$hash  $zipName`n", [Text.Encoding]::ASCII)

    $notes = Get-ReleaseNotes -Component $Component -Version $Version
    $notesPath = Join-Path $Stage.OutputRoot ($zipName -replace '\.zip$', '.release-notes.md')
    [IO.File]::WriteAllText($notesPath, $notes, [Text.UTF8Encoding]::new($false))
    [pscustomobject]@{
        Component = $Component
        Version = $Version
        ZipPath = $zipPath
        ChecksumPath = $checksumPath
        NotesPath = $notesPath
    }
}
