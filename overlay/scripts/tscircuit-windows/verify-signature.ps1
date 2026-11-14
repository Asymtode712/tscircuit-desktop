param(
  [Parameter(Mandatory)][string]$Path,
  [string]$ExpectedPublisher = "tscircuit Inc"
)

$ErrorActionPreference = "Stop"
$binary = (Resolve-Path -LiteralPath $Path).Path
$signature = Get-AuthenticodeSignature -LiteralPath $binary
if ($signature.SignatureType -eq "Catalog") {
  # PowerShell prefers the system catalog, even when the file has an embedded signature.
  $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
  $signTool = Get-ChildItem -LiteralPath $sdkBin -Directory |
    Where-Object { $_.Name -match '^\d+(\.\d+){3}$' -and (Test-Path (Join-Path $_.FullName 'x64/signtool.exe')) } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1
  if ($null -eq $signTool) { throw "SignTool is required to verify the embedded signature on $binary" }

  & (Join-Path $signTool.FullName 'x64/signtool.exe') verify /pa /tw $binary | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "SignTool did not verify a timestamped embedded signature on $binary" }

  # Read the signer from the same embedded signature SignTool verifies by default.
  $signer = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($binary)
} else {
  if ($signature.Status -ne "Valid" -or $signature.SignatureType -ne "Authenticode") {
    throw "Invalid embedded Authenticode signature on ${binary}: $($signature.Status) ($($signature.SignatureType))"
  }
  if ($null -eq $signature.TimeStamperCertificate) {
    throw "The signature on $binary has no trusted timestamp"
  }
  $signer = $signature.SignerCertificate
}
$publisher = $signer.GetNameInfo(
  [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false
)
if ($publisher -cne $ExpectedPublisher) {
  throw "Unexpected signing publisher on ${binary}: $publisher"
}
$usage = $signer.Extensions |
  Where-Object { $_.Oid.Value -eq "2.5.29.37" }
if ("1.3.6.1.5.5.7.3.3" -notin @($usage.EnhancedKeyUsages | ForEach-Object { $_.Value })) {
  throw "The certificate for $binary does not permit code signing"
}
