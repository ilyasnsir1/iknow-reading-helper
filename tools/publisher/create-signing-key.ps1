[CmdletBinding()]
param(
    [string]$KeyDirectory = (Join-Path $env:LOCALAPPDATA 'iKnowReadingHelperPublisher')
)
$ErrorActionPreference = 'Stop'
$KeyDirectory = [IO.Path]::GetFullPath($KeyDirectory)
if ($KeyDirectory.Length -lt 12 -or $KeyDirectory -eq [IO.Path]::GetPathRoot($KeyDirectory)) { throw 'Invalid key directory.' }
$privatePath = Join-Path $KeyDirectory 'signing-key.xml'
$publicPath = Join-Path $KeyDirectory 'signing-public.xml'
if ((Test-Path -LiteralPath $privatePath) -or (Test-Path -LiteralPath $publicPath)) {
    throw 'Signing keys already exist. Keep the existing private key; replacing it would break update trust.'
}
New-Item -ItemType Directory -Path $KeyDirectory -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$directoryAcl = New-Object Security.AccessControl.DirectorySecurity
$directoryAcl.SetAccessRuleProtection($true, $false)
$directoryAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
[IO.Directory]::SetAccessControl($KeyDirectory, $directoryAcl)
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider(3072)
$rsa.PersistKeyInCsp = $false
try {
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($privatePath, $rsa.ToXmlString($true), $encoding)
    [IO.File]::WriteAllText($publicPath, $rsa.ToXmlString($false), $encoding)
} finally { $rsa.Dispose() }
Write-Host ('Created protected publisher keys in ' + $KeyDirectory)
Write-Host ('Public key file: ' + $publicPath)
Write-Host 'The private key must remain outside the project, downloads and Git repositories.'
