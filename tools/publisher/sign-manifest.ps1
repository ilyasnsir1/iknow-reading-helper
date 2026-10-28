[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [Parameter(Mandatory=$true)][string]$PrivateKeyPath,
    [Parameter(Mandatory=$true)][string]$SignaturePath,
    [Parameter(Mandatory=$true)][string]$PublicKeyPath
)
$ErrorActionPreference = 'Stop'
$rsa = New-Object Security.Cryptography.RSACryptoServiceProvider
$rsa.PersistKeyInCsp = $false
try {
    $rsa.FromXmlString([IO.File]::ReadAllText([IO.Path]::GetFullPath($PrivateKeyPath)))
    $expectedPublicKey = [IO.File]::ReadAllText([IO.Path]::GetFullPath($PublicKeyPath)).Trim()
    if ($rsa.ToXmlString($false) -cne $expectedPublicKey) { throw 'The signing key does not match the public key pinned in the package.' }
    $bytes = [IO.File]::ReadAllBytes([IO.Path]::GetFullPath($ManifestPath))
    $signature = $rsa.SignData($bytes, [Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'))
    if (-not $rsa.VerifyData($bytes, [Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'), $signature)) { throw 'Manifest signature self-check failed.' }
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($SignaturePath), ([Convert]::ToBase64String($signature) + "`n"), (New-Object Text.UTF8Encoding($false)))
} finally { $rsa.Dispose() }
