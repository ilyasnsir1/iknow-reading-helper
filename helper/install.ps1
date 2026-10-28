[CmdletBinding()]
param(
    [string[]]$ExtensionId = @(),
    [string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'),
    [switch]$SetupOnly,
    [switch]$RegisterOnly,
    [switch]$DetectOnly,
    [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
if ($SetupOnly -and $RegisterOnly) { throw 'SetupOnly and RegisterOnly cannot be used together.' }
if ($DetectOnly -and ($SetupOnly -or $RegisterOnly)) { throw 'DetectOnly cannot be combined with setup or registration.' }
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
$helperDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
$extensionDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../extension'))
$ids = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($id in $ExtensionId) {
    if ($id -notmatch '^[a-p]{32}$') { throw 'An extension ID is invalid.' }
    [void]$ids.Add($id)
}

if (-not $SetupOnly) {
    # Read configuration only. No browser profile file is changed.
    $braveData = Join-Path $env:LOCALAPPDATA 'BraveSoftware/Brave-Browser/User Data'
    if (Test-Path -LiteralPath $braveData) {
        foreach ($profile in (Get-ChildItem -LiteralPath $braveData -Directory -ErrorAction SilentlyContinue)) {
            foreach ($name in @('Secure Preferences','Preferences')) {
                $preferencesPath = Join-Path $profile.FullName $name
                if (-not (Test-Path -LiteralPath $preferencesPath)) { continue }
                try {
                    $preferences = Get-Content -LiteralPath $preferencesPath -Raw -Encoding UTF8 | ConvertFrom-Json
                    foreach ($property in $preferences.extensions.settings.PSObject.Properties) {
                        $entry = $property.Value
                        $samePath = $entry.path -and ([IO.Path]::GetFullPath([string]$entry.path) -eq $extensionDirectory)
                        $sameName = $entry.manifest.name -in @('iKnow! Lesehilfe', 'iKnow! Reading Helper')
                        if (-not $sameName -and $entry.path -and [IO.Path]::IsPathRooted([string]$entry.path)) {
                            $candidateManifest = Join-Path ([string]$entry.path) 'manifest.json'
                            if (Test-Path -LiteralPath $candidateManifest) {
                                try { $sameName = (Get-Content -LiteralPath $candidateManifest -Raw -Encoding UTF8 | ConvertFrom-Json).name -in @('iKnow! Lesehilfe', 'iKnow! Reading Helper') } catch { }
                            }
                        }
                        if (($samePath -or $sameName) -and $property.Name -match '^[a-p]{32}$') { [void]$ids.Add($property.Name) }
                    }
                } catch { Write-Verbose ('Could not read profile: ' + $profile.Name) }
            }
        }
    }
    if ($ids.Count -eq 0) { throw 'Load the unpacked extension in Brave first, then run Setup.cmd again.' }
}
if ($DetectOnly) { return @($ids | Sort-Object) }
if (-not $RegisterOnly) {
    & (Join-Path $PSScriptRoot 'setup-runtime.ps1') -CacheRoot $CacheRoot
    if (-not $?) { throw 'Could not set up the local runtime.' }
    & (Join-Path $PSScriptRoot 'setup-word-voice.ps1') -CacheRoot $CacheRoot
    if (-not $?) { throw 'Could not set up the local word voice.' }
}
if ($SetupOnly) { return }
$python = Join-Path $CacheRoot 'runtime/python/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'The Python runtime is missing. Please run Setup.cmd again.' }
$nativeDirectory = Join-Path $CacheRoot 'native'
New-Item -ItemType Directory -Path $nativeDirectory -Force | Out-Null
$encoding = New-Object Text.UTF8Encoding($false)
$hostScript = Join-Path $helperDirectory 'native_host.py'
$batchCache = $CacheRoot.Replace('%','%%')
$batchPython = $python.Replace('%','%%')
$batchScript = $hostScript.Replace('%','%%')
$launcher = Join-Path $nativeDirectory 'host.cmd'
$batch = "@echo off`r`nchcp 65001 >nul`r`nset `"IKNOW_READER_CACHE=$batchCache`"`r`n`"$batchPython`" -u `"$batchScript`"`r`n"
[IO.File]::WriteAllText($launcher, $batch, $encoding)
$manifestPath = Join-Path $nativeDirectory 'de.iknow.lesehilfe.json'
$origins = @($ids | Sort-Object | ForEach-Object { 'chrome-extension://' + $_ + '/' })
$manifest = @{ name='de.iknow.lesehilfe'; description='Local course preparation for iKnow! Reading Helper'; path=$launcher; type='stdio'; allowed_origins=$origins }
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5), $encoding)
$registryPaths = @('Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\de.iknow.lesehilfe', 'Software\Google\Chrome\NativeMessagingHosts\de.iknow.lesehilfe')
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try { foreach ($registryPath in $registryPaths) { $key = $base.CreateSubKey($registryPath); try { $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() } } } finally { $base.Dispose() }
}
$installed = @{host='de.iknow.lesehilfe'; manifest=$manifestPath; helperDirectory=$helperDirectory; extensionIds=@($ids); installedAt=[DateTime]::UtcNow.ToString('o')}
[IO.File]::WriteAllText((Join-Path $CacheRoot 'installation.json'), ($installed | ConvertTo-Json), $encoding)
if ($Quiet) { Write-Host 'Brave connection registered.' }
else {
    Write-Host ''
    Write-Host 'Done. Reload the extension and the iKnow page in Brave.' -ForegroundColor Green
    Write-Host 'Choose the modules you need in Reading Helper to prepare a course.'
}
