[CmdletBinding()]
param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'), [string[]]$ExtensionId = @(), [switch]$ComponentsOnly, [switch]$RepairLibraries)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
if (-not $ComponentsOnly) {
    Write-Host 'Setting up the private Python runtime ...'
    & (Join-Path $PSScriptRoot 'setup-python.ps1') -CacheRoot $CacheRoot
    if (-not $?) { throw 'Could not set up private Python.' }
    Write-Host 'Registering the loaded Brave extension ...'
    & (Join-Path $PSScriptRoot 'install.ps1') -CacheRoot $CacheRoot -ExtensionId $ExtensionId -RegisterOnly
    if (-not $?) { throw 'Load the unpacked extension in Brave first, then retry.' }
}
$python = Join-Path $CacheRoot 'runtime/python/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'The private Python runtime is missing.' }
$packageDirectory = Join-Path $CacheRoot 'python-packages'
$requirements = Join-Path $PSScriptRoot 'neural-voice-requirements.txt'
$requirementHash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
$marker = Join-Path $packageDirectory '.neural-voice-requirements-sha256'
if ($RepairLibraries -or -not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $requirementHash) {
    & $python (Join-Path $PSScriptRoot 'setup_neural_voice.py') --cache-root $CacheRoot --check-audio
    if ($RepairLibraries -or $LASTEXITCODE -ne 0) {
        & $python -m pip install --disable-pip-version-check --only-binary=:all: --upgrade --target $packageDirectory --requirement $requirements
        if ($LASTEXITCODE -ne 0) { throw 'Could not install the voice audio libraries.' }
        & $python (Join-Path $PSScriptRoot 'setup_neural_voice.py') --cache-root $CacheRoot --check-audio
        if ($LASTEXITCODE -ne 0) { throw 'The voice audio libraries could not be loaded.' }
    }
    [IO.File]::WriteAllText($marker, $requirementHash, (New-Object Text.UTF8Encoding($false)))
}
Write-Host 'Setting up Mao Plain and Nise (about 2 GB on a fresh PC, once) ...'
& $python (Join-Path $PSScriptRoot 'setup_neural_voice.py') --cache-root $CacheRoot
if ($LASTEXITCODE -ne 0) { throw 'Neural voice setup did not finish. Run this file again to reuse completed downloads.' }
Write-Host 'Checking both voices ...'
& $python (Join-Path $PSScriptRoot 'neural_speech.py') check --cache-root $CacheRoot
if ($LASTEXITCODE -ne 0) { throw 'The local voices could not be verified. See the voice log and retry setup.' }
if (-not $ComponentsOnly) {
    Write-Host ''
    Write-Host 'Mao Plain and Nise are ready.' -ForegroundColor Green
    Write-Host 'Reload the extension and your iKnow page. In settings choose Local neural voice, then Female or Male.'
    Write-Host 'No paid API or course language-model download is used.'
}
