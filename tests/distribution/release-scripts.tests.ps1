#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
. (Join-Path $repositoryRoot 'scripts/release-common.ps1')
$script:Checks = 0

function Assert-Release {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "Release verification failed: $Message" }
    $script:Checks++
}
function Assert-ReleaseFailure {
    param([scriptblock]$Action, [string]$Message)
    $failed = $false
    try { & $Action | Out-Null } catch { $failed = $true }
    Assert-Release $failed $Message
}
function Read-ZipText {
    param($Archive, [string]$Name)
    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry) { throw "ZIP entry is missing: $Name" }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $reader.ReadToEnd() } finally { $reader.Dispose() }
}

# Local command doubles make these tests incapable of publishing a release
# or building/running Desktop. Real package creation still runs end to end.
function gh {
    $call = @($args)
    $global:ReleaseTestGhCalls.Add($call)
    $global:LASTEXITCODE = 0
    if ($call[1] -eq 'view') {
        if ($global:ReleaseTestView -eq 'missing') {
            $global:LASTEXITCODE = 1
            'release not found'
        }
        elseif ($global:ReleaseTestView -eq 'denied') {
            $global:LASTEXITCODE = 1
            'HTTP 403: permission denied'
        }
        else { @{ tagName = $call[2]; isDraft = $false } | ConvertTo-Json -Compress }
    }
    elseif ($call[1] -eq $global:ReleaseTestFailCommand) { $global:LASTEXITCODE = 1 }
}
function dotnet {
    $global:ReleaseTestDotnetArguments = @($args)
    $global:LASTEXITCODE = 0
    if ($global:ReleaseTestDotnetFails) { $global:LASTEXITCODE = 1; return }
    $outputIndex = [Array]::IndexOf($global:ReleaseTestDotnetArguments, '--output') + 1
    $destination = $global:ReleaseTestDotnetArguments[$outputIndex]
    [IO.File]::WriteAllText((Join-Path $destination 'ChatGPTComfyConnector.Desktop.exe'), 'packaging fixture')
}

$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$testRoot = Join-Path $temporaryRoot ('connector-release-tests-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$global:ReleaseTestGhCalls = [Collections.Generic.List[object]]::new()
$global:ReleaseTestView = 'missing'
$global:ReleaseTestFailCommand = ''
$global:ReleaseTestDotnetFails = $false
$global:ReleaseTestDotnetArguments = @()
try {
    Assert-Release ((Get-Command gh).CommandType -eq 'Function') 'GitHub command must be mocked'
    Assert-Release ((Get-Command dotnet).CommandType -eq 'Function') 'Desktop build command must be mocked'
    $stable = Get-ComponentRelease -Component desktop -Tag 'desktop-v1.2.3'
    Assert-Release (-not $stable.IsPrerelease) 'stable Desktop tag'
    $preview = Get-ComponentRelease -Component collector -Tag 'collector-v1.2.3-preview.4+build.7'
    Assert-Release ($preview.IsPrerelease -and $preview.NumericVersion -eq '1.2.3') 'Collector prerelease and numeric manifest version'
    foreach ($badTag in @('v1.2.3', 'desktop-v1.2.3', 'collector-v01.2.3', 'collector-v1.2', 'collector-v1.2.3-01', 'collector-v1.2.3/other', "collector-v1.2.3`n")) {
        Assert-ReleaseFailure { Get-ComponentRelease -Component collector -Tag $badTag } "reject invalid Collector tag $badTag"
    }
    Assert-ReleaseFailure { Get-ComponentRelease -Component desktop -Tag 'collector-v1.2.3' } 'Desktop rejects Collector tags'
    Assert-ReleaseFailure { Get-ReleaseVersion -Version '65536.0.0' } 'reject unsupported numeric versions'

    $collectorScript = Join-Path $repositoryRoot 'scripts/publish-collector.ps1'
    $manifestPath = Join-Path $repositoryRoot 'browser-extension/manifest.json'
    $manifestBefore = (Get-FileHash -LiteralPath $manifestPath).Hash
    $collectorOutput = Join-Path $testRoot 'collector'
    $collector = & $collectorScript -Version '1.2.3-preview.4+build.7' -OutputDirectory $collectorOutput
    $archive = [IO.Compression.ZipFile]::OpenRead($collector.ZipPath)
    try {
        $expected = @('README.md', 'background.js', 'chatgpt-locators.js', 'content-script.js', 'manifest.json', 'popup.css', 'popup.html', 'popup.js')
        Assert-Release (@(Compare-Object $expected @($archive.Entries.FullName)).Count -eq 0) 'Collector ZIP contains only complete installable extension files'
        $manifest = (Read-ZipText $archive 'manifest.json') | ConvertFrom-Json
        Assert-Release ($manifest.version -eq '1.2.3' -and $manifest.version_name -eq '1.2.3-preview.4+build.7') 'manifest follows release tag'
        foreach ($file in @('background.js', 'chatgpt-locators.js', 'content-script.js', 'popup.js')) {
            Assert-Release ((Read-ZipText $archive $file) -ceq [IO.File]::ReadAllText((Join-Path $repositoryRoot "browser-extension/$file"))) "source preserved in $file"
        }
        Assert-Release ((Read-ZipText $archive 'README.md') -match '開発者モード') 'installation guide is bundled'
    }
    finally { $archive.Dispose() }
    Assert-Release ($manifestBefore -eq (Get-FileHash -LiteralPath $manifestPath).Hash) 'packaging does not modify source manifest'
    $zipName = [IO.Path]::GetFileName($collector.ZipPath)
    $hash = (Get-FileHash -LiteralPath $collector.ZipPath).Hash.ToLowerInvariant()
    Assert-Release ([IO.File]::ReadAllText($collector.ChecksumPath).Trim() -ceq "$hash  $zipName") 'checksum matches actual Collector ZIP'
    Assert-Release ([IO.File]::ReadAllText($collector.NotesPath).Contains($zipName)) 'release notes name the actual asset'
    Assert-Release (@(Get-ChildItem -LiteralPath $collectorOutput -Directory -Force).Count -eq 0) 'Collector staging is cleaned'
    Assert-ReleaseFailure { & $collectorScript -Version '0.0.0' -OutputDirectory $collectorOutput } 'reject all-zero Chromium version'
    Assert-ReleaseFailure { & $collectorScript -Version '../outside' -OutputDirectory $collectorOutput } 'reject path-like version'

    $desktopScript = Join-Path $repositoryRoot 'scripts/publish-win-x64.ps1'
    $desktopOutput = Join-Path $testRoot 'desktop'
    $desktop = & $desktopScript -Version '2.3.4-alpha.1' -SourceRevisionId 'abcdef1234567890' -NoRestore -OutputDirectory $desktopOutput
    Assert-Release ($global:ReleaseTestDotnetArguments -contains '-p:Version=2.3.4-alpha.1') 'Desktop binary version follows requested release version'
    Assert-Release ($global:ReleaseTestDotnetArguments -contains '--no-restore') 'CI can reuse restored dependencies'
    Assert-Release ($global:ReleaseTestDotnetArguments -contains '-p:SourceRevisionId=abcdef1234567890') 'Desktop retains the source commit in release metadata'
    $archive = [IO.Compression.ZipFile]::OpenRead($desktop.ZipPath)
    try {
        Assert-Release ($null -ne $archive.GetEntry('ChatGPTComfyConnector.Desktop.exe')) 'Desktop executable is at ZIP root'
        Assert-Release (@($archive.Entries | Where-Object { $_.FullName -match 'browser-extension|manifest.json|background.js' }).Count -eq 0) 'Desktop and Collector payloads are independent'
        Assert-Release ((Read-ZipText $archive 'README.md') -match 'collector-v') 'Desktop instructions identify Collector downloads'
    }
    finally { $archive.Dispose() }
    $global:ReleaseTestDotnetFails = $true
    Assert-ReleaseFailure { & $desktopScript -Version '2.3.5' -OutputDirectory $desktopOutput } 'failed build must not create a release package'
    Assert-Release (-not (Test-Path -LiteralPath (Join-Path $desktopOutput 'ChatGPT-Comfy-Connector-v2.3.5-win-x64.zip'))) 'no ZIP after failed publish'
    Assert-Release (@(Get-ChildItem -LiteralPath $desktopOutput -Directory -Force).Count -eq 0) 'failed Desktop build staging is cleaned'

    $publisher = Join-Path $repositoryRoot 'scripts/publish-github-release.ps1'
    $publishArguments = @{
        Component = 'collector'; Tag = 'collector-v1.2.3-preview.4+build.7'; Repository = 'Lye-0/chatgpt-comfy-connector'
        ZipPath = $collector.ZipPath; ChecksumPath = $collector.ChecksumPath; NotesPath = $collector.NotesPath
    }
    & $publisher @publishArguments
    Assert-Release (($global:ReleaseTestGhCalls | ForEach-Object { $_[1] }) -join ',' -eq 'view,create,upload,edit') 'upload completes before a new release becomes public'
    Assert-Release ($global:ReleaseTestGhCalls[1] -contains '--draft') 'new release begins as draft'
    Assert-Release ($global:ReleaseTestGhCalls[1] -contains '--verify-tag') 'publisher cannot create a missing git tag'
    Assert-Release ($global:ReleaseTestGhCalls[3] -contains '--draft=false') 'completed release is published'
    Assert-Release ($global:ReleaseTestGhCalls[3] -contains '--prerelease=true') 'all SemVer prereleases are marked correctly'
    Assert-Release ($global:ReleaseTestGhCalls[3] -contains '--latest=false') 'Collector keeps Desktop Latest unchanged'
    Assert-Release (@($global:ReleaseTestGhCalls | Where-Object { $_ -notcontains '--repo' }).Count -eq 0) 'every GitHub operation targets the explicit repository'

    $global:ReleaseTestGhCalls.Clear()
    $global:ReleaseTestFailCommand = 'upload'
    Assert-ReleaseFailure { & $publisher @publishArguments } 'upload failure stops publication'
    Assert-Release (@($global:ReleaseTestGhCalls | Where-Object { $_[1] -eq 'edit' }).Count -eq 0) 'failed upload leaves draft unpublished'
    $global:ReleaseTestGhCalls.Clear()
    $global:ReleaseTestFailCommand = ''
    $global:ReleaseTestView = 'exists'
    & $publisher @publishArguments
    Assert-Release (($global:ReleaseTestGhCalls | ForEach-Object { $_[1] }) -join ',' -eq 'view,upload,edit') 'rerun reuses the matching release'
    $global:ReleaseTestGhCalls.Clear()
    $global:ReleaseTestView = 'denied'
    Assert-ReleaseFailure { & $publisher @publishArguments } 'permission errors do not masquerade as a missing release'
    Assert-Release ($global:ReleaseTestGhCalls.Count -eq 1) 'permission error causes no GitHub mutations'
    $global:ReleaseTestGhCalls.Clear()
    [IO.File]::WriteAllText($collector.ChecksumPath, 'wrong hash')
    Assert-ReleaseFailure { & $publisher @publishArguments } 'reject mismatched checksum before contacting GitHub'
    Assert-Release ($global:ReleaseTestGhCalls.Count -eq 0) 'bad local assets never reach GitHub'

    foreach ($component in @('desktop', 'collector')) {
        $workflow = [IO.File]::ReadAllText((Join-Path $repositoryRoot ".github/workflows/release-$component.yml"))
        $tagPatterns = [regex]::Matches($workflow, "(?m)^\s+- '([^']+)'\s*$")
        Assert-Release ($tagPatterns.Count -eq 1 -and $tagPatterns[0].Groups[1].Value -ceq "$component-v*") "$component workflow has an exclusive tag trigger"
    }
    Assert-Release (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot '.github/workflows/release.yml'))) 'old catch-all release workflow is retired'
    Write-Output "PASS: $script:Checks release/package checks; no GitHub requests were made."
}
finally {
    $resolvedTestRoot = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedTestRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedTestRoot) -notmatch '\Aconnector-release-tests-[a-f0-9]{32}\z') {
        throw "Unexpected test directory: $resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    Remove-Variable -Scope Global -Name ReleaseTestGhCalls, ReleaseTestView, ReleaseTestFailCommand, ReleaseTestDotnetFails, ReleaseTestDotnetArguments
    $global:LASTEXITCODE = 0
}
