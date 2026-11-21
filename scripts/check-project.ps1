$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$files = @('package.json','vite.config.ts','index.html','src\main.tsx','src\App.tsx','.env.example')
foreach ($file in $files) {
  $path = Join-Path $root $file
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing required web project file: $path" }
}
Write-Host 'Nookly Web project structure: OK' -ForegroundColor Green
if (-not (Test-Path (Join-Path $root '.env'))) { Write-Warning 'Create .env from .env.example and configure Appwrite.' }
