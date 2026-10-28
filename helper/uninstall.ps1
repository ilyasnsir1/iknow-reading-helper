[CmdletBinding()]
param([string]$CacheRoot = (Join-Path $env:LOCALAPPDATA 'iKnowLesehilfe'))
$ErrorActionPreference = 'Stop'
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
$expectedManifest = Join-Path $CacheRoot 'native/de.iknow.lesehilfe.json'
$registryPaths = @('Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\de.iknow.lesehilfe', 'Software\Google\Chrome\NativeMessagingHosts\de.iknow.lesehilfe')
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
        foreach ($registryPath in $registryPaths) {
        $key = $base.OpenSubKey($registryPath)
        if ($key) {
            $value = $key.GetValue('')
            $key.Dispose()
            if ($value -eq $expectedManifest) { $base.DeleteSubKey($registryPath, $false) }
        }
        }
    } finally { $base.Dispose() }
}
Write-Host 'The local helper is disconnected from Brave. Models and prepared courses are kept.'
Write-Host ('Storage directory: ' + $CacheRoot)
