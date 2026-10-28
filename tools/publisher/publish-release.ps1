[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ReleaseDirectory,
    [Parameter(Mandatory=$true)][string]$PackageDirectory,
    [Parameter(Mandatory=$true)][string]$NotesFile,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$ReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
$PackageDirectory = [IO.Path]::GetFullPath($PackageDirectory)
$config = Get-Content -LiteralPath (Join-Path $PackageDirectory 'helper/update-config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($slug in @($config.owner, $config.repository)) {
    if ($slug -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$') { throw 'Invalid GitHub destination.' }
}
$destination = $config.owner + '/' + $config.repository
$manifestPath = Join-Path $ReleaseDirectory 'update-manifest.json'
$signaturePath = Join-Path $ReleaseDirectory 'update-manifest.sig'
$manifestBytes = [IO.File]::ReadAllBytes($manifestPath)
$manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
if ($manifest.schema -ne 1 -or $manifest.version -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') { throw 'Invalid signed release manifest.' }
$tag = 'v' + $manifest.version
$expectedName = 'iKnow-Reading-Helper-' + $manifest.version + '.zip'
$expectedUrl = 'https://github.com/' + $destination + '/releases/download/' + $tag + '/' + $expectedName
if ($manifest.asset.name -cne $expectedName -or $manifest.asset.url -cne $expectedUrl) { throw 'Release address does not match the package configuration.' }
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
$rsa.PersistKeyInCsp = $false
try {
    $rsa.FromXmlString([string]$config.publicKeyXml)
    $signature = [Convert]::FromBase64String([IO.File]::ReadAllText($signaturePath).Trim())
    if (-not $rsa.VerifyData($manifestBytes, [Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'), $signature)) { throw 'Release signature is invalid.' }
} finally { $rsa.Dispose() }
$archivePath = Join-Path $ReleaseDirectory $expectedName
$archive = Get-Item -LiteralPath $archivePath
$hasher = [Security.Cryptography.SHA256]::Create()
$archiveStream = [IO.File]::OpenRead($archivePath)
try { $archiveHash = [BitConverter]::ToString($hasher.ComputeHash($archiveStream)).Replace('-', '').ToLowerInvariant() }
finally { $archiveStream.Dispose(); $hasher.Dispose() }
if ($archive.Length -ne $manifest.asset.size -or $archiveHash -cne $manifest.asset.sha256) { throw 'Release archive checksum or length does not match.' }
if (-not (Test-Path -LiteralPath $NotesFile -PathType Leaf)) { throw 'Release notes are missing.' }
$assets = @($archivePath, $manifestPath, $signaturePath, (Join-Path $ReleaseDirectory 'SHA256SUMS.txt'))
foreach ($asset in $assets) { if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) { throw 'A release asset is missing.' } }
if ($DryRun) {
    Write-Host ('Verified signed release ' + $tag + ' for ' + $destination)
    $assets | ForEach-Object { Write-Host ([IO.Path]::GetFileName($_)) }
    Write-Host 'Dry run: no GitHub changes made.'
    return
}
# Credentials come from gh's existing session or a separately supplied GH_TOKEN.
# They are never read into a command argument, package, log or source file.
$isPrivate = & gh api ('repos/' + $destination) --jq '.private'
if ($LASTEXITCODE -ne 0) { throw 'Could not access the selected GitHub repository.' }
if ([string]$isPrivate -ne 'false') { throw 'This distribution workflow requires a public download repository.' }
& gh release view $tag --repo $destination *> $null
if ($LASTEXITCODE -eq 0) { throw 'This version already has a release. Publish a new version instead of replacing signed assets.' }
& gh release create $tag @assets --repo $destination --target main --draft --title ('iKnow! Reading Helper ' + $manifest.version) --notes-file ([IO.Path]::GetFullPath($NotesFile))
if ($LASTEXITCODE -ne 0) { throw 'Could not upload the draft release. Inspect the draft before retrying.' }
& gh release edit $tag --repo $destination --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'The release remains a draft. Inspect it before publishing.' }
Write-Host ('Published https://github.com/' + $destination + '/releases/tag/' + $tag)
