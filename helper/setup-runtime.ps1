[CmdletBinding()]
param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'), [switch]$RepairLibraries)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
if ($CacheRoot.Length -lt 12 -or $CacheRoot -eq [IO.Path]::GetPathRoot($CacheRoot)) { throw 'Invalid storage directory.' }
$downloads = Join-Path $CacheRoot 'downloads'
$pythonDirectory = Join-Path $CacheRoot 'runtime/python'
$llamaDirectory = Join-Path $CacheRoot 'runtime/llama'
$packageDirectory = Join-Path $CacheRoot 'python-packages'
$models = Join-Path $CacheRoot 'models'
New-Item -ItemType Directory -Path $downloads,$pythonDirectory,$llamaDirectory,$packageDirectory,$models -Force | Out-Null

function Get-VerifiedDownload([string]$Url, [string]$Target, [string]$Sha256) {
    if (Test-Path -LiteralPath $Target) {
        Write-Host ('Checking existing ' + [IO.Path]::GetFileName($Target) + ' ...')
        if ((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256) { Write-Host 'Verified; reusing this download.'; return }
        Remove-Item -LiteralPath $Target -Force
    }
    $partial = $Target + '.part'
    Write-Host ('Downloading ' + [IO.Path]::GetFileName($Target) + ' ...')
    & curl.exe --fail --location --retry 3 --continue-at - --output $partial $Url
    if ($LASTEXITCODE -ne 0) { throw ('Download failed: ' + [IO.Path]::GetFileName($Target) + '. Run setup again to resume the download.') }
    $actual = (Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) {
        Remove-Item -LiteralPath $partial -Force
        throw ('Checksum mismatch: ' + [IO.Path]::GetFileName($Target) + '. Please run setup again.')
    }
    Move-Item -LiteralPath $partial -Destination $Target
}

Write-Host '1/4  Setting up the Python runtime ...'
$pythonZip = Join-Path $downloads 'python-3.12.10-embed-amd64.zip'
Get-VerifiedDownload 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' $pythonZip '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
if (-not (Test-Path -LiteralPath (Join-Path $pythonDirectory 'python.exe'))) { Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDirectory -Force }
$encoding = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $pythonDirectory 'python312._pth'), "python312.zip`r`n.`r`n../../python-packages`r`nimport site`r`n", $encoding)
$python = Join-Path $pythonDirectory 'python.exe'
$pipZip = Join-Path $downloads 'pip-25.0.1.zip'
Get-VerifiedDownload 'https://files.pythonhosted.org/packages/c9/bc/b7db44f5f39f9d0494071bddae6880eb645970366d0a200022a1a93d57f5/pip-25.0.1-py3-none-any.whl' $pipZip 'c46efd13b6aa8279f33f2864459c8ce587ea6a1a59ee20de055868d8f7688f7f'
if (-not (Test-Path -LiteralPath (Join-Path $packageDirectory 'pip/__main__.py'))) { Expand-Archive -LiteralPath $pipZip -DestinationPath $packageDirectory -Force }
$requirementPath = Join-Path $PSScriptRoot 'requirements.txt'
$requirementHash = (Get-FileHash -LiteralPath $requirementPath -Algorithm SHA256).Hash
$requirementMarker = Join-Path $packageDirectory '.requirements-sha256'
if ($RepairLibraries -or -not (Test-Path -LiteralPath $requirementMarker) -or (Get-Content -LiteralPath $requirementMarker -Raw).Trim() -ne $requirementHash) {
    & $python -m pip install --disable-pip-version-check --only-binary=:all: --upgrade --target $packageDirectory --requirement $requirementPath
    if ($LASTEXITCODE -ne 0) { throw 'Could not set up Python packages.' }
    [IO.File]::WriteAllText($requirementMarker, $requirementHash, $encoding)
}
# Pass a script file instead of inline code. Windows PowerShell 5.1 removes
# embedded double quotes while constructing native command-line arguments.
$runtimeSetup = Join-Path $PSScriptRoot 'setup_runtime.py'
& $python $runtimeSetup check-audio
if ($LASTEXITCODE -ne 0) { throw 'Could not load the audio libraries.' }

Write-Host '2/4  Setting up the local model runtime ...'
$llamaZip = Join-Path $downloads 'llama-b11669-vulkan.zip'
Get-VerifiedDownload 'https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-vulkan-x64.zip' $llamaZip '2c07574e7bde71321cb785282b20cc821e951132149eeceeea32ddebdbf0598e'
$llamaExecutable = Join-Path $llamaDirectory 'llama-server.exe'
if (-not (Test-Path -LiteralPath $llamaExecutable) -or (Get-Item -LiteralPath $llamaExecutable).Length -eq 0) { Expand-Archive -LiteralPath $llamaZip -DestinationPath $llamaDirectory -Force }

Write-Host '3/4  Language model (about 5.7 GB on a fresh PC) ...'
$llamaModel = Join-Path $models 'Qwen3.5-9B-Q4_K_M.gguf'
Get-VerifiedDownload 'https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/3885219b6810b007914f3a7950a8d1b469d598a5/Qwen3.5-9B-Q4_K_M.gguf?download=true' $llamaModel '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8'

Write-Host '4/4  Audio timing model (about 500 MB on a fresh PC) ...'
$whisperModel = Join-Path $models 'whisper-small'
$env:HF_HUB_DISABLE_XET = '1'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
& $python $runtimeSetup prepare-whisper --model-directory $whisperModel
if ($LASTEXITCODE -ne 0) { throw 'Could not download the audio model.' }
$config = @{
    llamaExecutable = (Join-Path $llamaDirectory 'llama-server.exe')
    llamaModel = $llamaModel
    whisperModel = $whisperModel
    dependencies = $packageDirectory
    pythonExecutable = $python
}
[IO.File]::WriteAllText((Join-Path $CacheRoot 'runtime-config.json'), ($config | ConvertTo-Json), $encoding)
Write-Host 'Local processing is ready.'
