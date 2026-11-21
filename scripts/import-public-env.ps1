# Reads only approved EXPO_PUBLIC_APPWRITE_* values from the local reference project.
# Does not modify the reference folder or contact GitHub.
param(
  [string] $Reference = 'C:\Users\nooklyweb\Documents\nookly-mobile-reference'
)
$ErrorActionPreference = 'Stop'
$destination = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
$template = Join-Path (Split-Path $PSScriptRoot -Parent) '.env.example'
if (Test-Path -LiteralPath $destination) {
  Write-Host "Existing .env detected; not overwriting: $destination" -ForegroundColor Yellow
  exit 0
}
$source = Join-Path $Reference '.env'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
  Copy-Item -LiteralPath $template -Destination $destination
  Write-Warning 'The mobile reference has no .env. Created an empty .env template. Fill in Appwrite public IDs manually.'
  exit 0
}
$wanted = @{
  'VITE_APPWRITE_ENDPOINT' = 'EXPO_PUBLIC_APPWRITE_ENDPOINT'
  'VITE_APPWRITE_PROJECT_ID' = 'EXPO_PUBLIC_APPWRITE_PROJECT_ID'
  'VITE_APPWRITE_DATABASE_ID' = 'EXPO_PUBLIC_APPWRITE_DATABASE_ID'
  'VITE_APPWRITE_USERS_COLLECTION_ID' = 'EXPO_PUBLIC_APPWRITE_USERS_COLLECTION_ID'
  'VITE_APPWRITE_PROPERTIES_COLLECTION_ID' = 'EXPO_PUBLIC_APPWRITE_PROPERTIES_COLLECTION_ID'
  'VITE_APPWRITE_FAVORITES_COLLECTION_ID' = 'EXPO_PUBLIC_APPWRITE_FAVORITES_COLLECTION_ID'
  'VITE_APPWRITE_TENANT_PROFILES_COLLECTION_ID' = 'EXPO_PUBLIC_APPWRITE_TENANT_PROFILES_COLLECTION_ID'
  'VITE_APPWRITE_LANDLORDS_COLLECTION_ID' = 'EXPO_PUBLIC_APPWRITE_LANDLORDS_COLLECTION_ID'
  'VITE_APPWRITE_ORGANIZATION_TENANTS_COLLECTION_ID' = 'EXPO_PUBLIC_APPWRITE_ORGANIZATION_TENANTS_COLLECTION_ID'
}
$values = @{}
foreach ($line in (Get-Content -LiteralPath $source)) {
  if ($line -match '^\s*#') { continue }
  if ($line -match '^\s*(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*?)\s*$') {
    $value = $Matches[2]
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$Matches[1]] = $value
  }
}
$lines = @('# Generated from the local Nookly mobile reference (public identifiers only).')
foreach ($name in ($wanted.Keys | Sort-Object)) {
  $sourceName = $wanted[$name]
  $lines += "$name=$($values[$sourceName])"
}
Set-Content -LiteralPath $destination -Value $lines -Encoding UTF8
Write-Host "Created $destination from local public Appwrite configuration." -ForegroundColor Green
Write-Host 'No API keys or secrets were copied.'
