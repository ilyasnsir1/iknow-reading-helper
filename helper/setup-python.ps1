[CmdletBinding()]
param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'))
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
if ($CacheRoot.Length -lt 12 -or $CacheRoot -eq [IO.Path]::GetPathRoot($CacheRoot)) { throw 'Invalid storage directory.' }
$downloads = Join-Path $CacheRoot 'downloads'
$pythonDirectory = Join-Path $CacheRoot 'runtime/python'
$packageDirectory = Join-Path $CacheRoot 'python-packages'
New-Item -ItemType Directory -Path $downloads,$pythonDirectory,$packageDirectory -Force | Out-Null
function Get-PythonDownload([string]$Url,[string]$Target,[string]$Sha256) {
    if ((Test-Path -LiteralPath $Target) -and (Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Sha256) { return }
    $partial = $Target + '.part'
    & curl.exe --fail --location --retry 3 --continue-at - --output $partial $Url
    if ($LASTEXITCODE -ne 0) { throw 'Python download failed. Run setup again to resume.' }
    if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { Remove-Item -LiteralPath $partial -Force; throw 'Python download checksum mismatch.' }
    Move-Item -LiteralPath $partial -Destination $Target -Force
}
$pythonReady = $true
foreach ($file in @('python.exe','python312.dll','python312.zip')) {
    $required = Join-Path $pythonDirectory $file
    if (-not (Test-Path -LiteralPath $required) -or (Get-Item -LiteralPath $required).Length -eq 0) { $pythonReady = $false }
}
if ($pythonReady) {
    try {
        $version = & (Join-Path $pythonDirectory 'python.exe') --version 2>$null
        $pythonReady = $LASTEXITCODE -eq 0 -and [string]$version -eq 'Python 3.12.10'
        if ($pythonReady) {
            & (Join-Path $pythonDirectory 'python.exe') (Join-Path $PSScriptRoot 'setup_python_check.py') 2>$null
            $pythonReady = $LASTEXITCODE -eq 0
        }
    } catch { $pythonReady = $false }
}
if (-not $pythonReady) {
    $pythonZip = Join-Path $downloads 'python-3.12.10-embed-amd64.zip'
    Get-PythonDownload 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip' $pythonZip '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3'
    Expand-Archive -LiteralPath $pythonZip -DestinationPath $pythonDirectory -Force
}
$encoding = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $pythonDirectory 'python312._pth'), "python312.zip`r`n.`r`n../../python-packages`r`nimport site`r`n", $encoding)
$pipReady = $false
if (Test-Path -LiteralPath (Join-Path $packageDirectory 'pip/__main__.py')) {
    try {
        $pipVersion = & (Join-Path $pythonDirectory 'python.exe') -m pip --version 2>$null
        $pipReady = $LASTEXITCODE -eq 0 -and [string]$pipVersion -match '^pip 25\.0\.1 '
    } catch { $pipReady = $false }
}
if (-not $pipReady) {
    $pipZip = Join-Path $downloads 'pip-25.0.1.zip'
    Get-PythonDownload 'https://files.pythonhosted.org/packages/c9/bc/b7db44f5f39f9d0494071bddae6880eb645970366d0a200022a1a93d57f5/pip-25.0.1-py3-none-any.whl' $pipZip 'c46efd13b6aa8279f33f2864459c8ce587ea6a1a59ee20de055868d8f7688f7f'
    Expand-Archive -LiteralPath $pipZip -DestinationPath $packageDirectory -Force
}
Write-Host 'Private Python runtime ready.'
