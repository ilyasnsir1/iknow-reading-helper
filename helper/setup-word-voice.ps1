[CmdletBinding()]
param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'), [switch]$RepairLibraries)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
if ($CacheRoot.Length -lt 12 -or $CacheRoot -eq [IO.Path]::GetPathRoot($CacheRoot)) { throw 'Invalid storage directory.' }
$python = Join-Path $CacheRoot 'runtime/python/python.exe'
$packages = Join-Path $CacheRoot 'python-packages'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run helper/Setup.cmd first to install the private Python runtime.' }
$requirements = Join-Path $PSScriptRoot 'word-voice-requirements.txt'
$hash = (Get-FileHash -LiteralPath $requirements -Algorithm SHA256).Hash
$marker = Join-Path $packages '.word-voice-requirements-sha256'
$encoding = New-Object Text.UTF8Encoding($false)
Write-Host 'Setting up the local Japanese word voice (about 33 MB, once) ...'
if ($RepairLibraries -or -not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $hash) {
    New-Item -ItemType Directory -Path $packages -Force | Out-Null
    & $python -m pip install --disable-pip-version-check --only-binary=:all: --require-hashes --no-deps --upgrade --target $packages --requirement $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the local word voice. Close iKnow tabs and run this setup again.' }
}
& $python (Join-Path $PSScriptRoot 'word_speech.py') check --cache-root $CacheRoot
if ($LASTEXITCODE -ne 0) { throw 'The Japanese word voice could not be loaded.' }
[IO.File]::WriteAllText($marker, $hash, $encoding)
Write-Host 'Word voice ready. Reload the extension and the iKnow page.'
Write-Host 'No language-model download or paid service is used.'
