# BhooAI Nexus - sync the framework source into production/.
# Idempotent: safe to re-run after framework changes.
# Usage:  powershell -ExecutionPolicy Bypass -File .\sync.ps1   (run from the repo root)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Prod = $PSScriptRoot

function Copy-Tree([string]$Rel) {
  $src = Join-Path $Root $Rel
  if (-not (Test-Path $src)) { Write-Warning "missing source: $Rel"; return }
  $dst = Join-Path $Prod $Rel
  New-Item -ItemType Directory -Force -Path $dst | Out-Null
  Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
  Write-Host "  copied $Rel"
}

function Copy-File([string]$Rel) {
  $src = Join-Path $Root $Rel
  if (-not (Test-Path $src)) { Write-Warning "missing source: $Rel"; return }
  $dst = Join-Path $Prod $Rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  Copy-Item -Path $src -Destination $dst -Force
  Write-Host "  copied $Rel"
}

Write-Host 'Syncing BhooAI Nexus -> production/'

# Root workspace + configs
Copy-File 'package.json'
Copy-File 'package-lock.json'
Copy-File 'tsconfig.json'
Copy-File 'tsconfig.base.json'
Copy-File 'nexus.config.ts'

# CLI entry + the serve-all runner (from the CLI template)
Copy-File 'bin\nexus.js'
Copy-File 'packages\nexus-cli\templates\bin\serve-all.mjs'   # staged below into production/bin
Move-Item -Force (Join-Path $Prod 'packages\nexus-cli\templates\bin\serve-all.mjs') (Join-Path $Prod 'bin\serve-all.mjs') -ErrorAction SilentlyContinue

# Framework packages (source + package.json + tsconfig)
foreach ($pkg in (Get-ChildItem (Join-Path $Root 'packages') -Directory)) {
  $name = $pkg.Name
  $base = "packages\$name"
  Copy-File "$base\package.json"
  foreach ($sub in 'src','templates') {
    if (Test-Path (Join-Path $Root "$base\$sub")) { Copy-Tree "$base\$sub" }
  }
  if (Test-Path (Join-Path $Root "$base\tsconfig.json")) { Copy-File "$base\tsconfig.json" }
}

# Apps - backend (src only; tests are dev-only)
Copy-File 'apps\backend\package.json'
Copy-File 'apps\backend\tsconfig.json'
Copy-Tree 'apps\backend\src'

# Apps - frontend + admin (full vite projects)
foreach ($app in 'frontend','admin') {
  Copy-File "apps\$app\package.json"
  Copy-File "apps\$app\tsconfig.json"
  Copy-File "apps\$app\vite.config.ts"
  Copy-File "apps\$app\tailwind.config.js"
  Copy-File "apps\$app\postcss.config.js"
  Copy-File "apps\$app\index.html"
  Copy-Tree "apps\$app\src"
  Copy-Tree "apps\$app\public"
}

# Apps - python AI server
Copy-File 'apps\ai-server\requirements.txt'
Copy-File 'apps\ai-server\settings.py'
Copy-File 'apps\ai-server\main.py'
Copy-Tree 'apps\ai-server\providers'
Copy-Tree 'apps\ai-server\routers'

# Shared contract
Copy-Tree 'contracts'

# Ensure runtime dirs exist
foreach ($d in 'uploads','plugins','logs','certs') {
  New-Item -ItemType Directory -Force -Path (Join-Path $Prod $d) | Out-Null
}

# Clean up any accidentally-copied dev artifacts
foreach ($junk in 'dist','node_modules','.venv','__pycache__','.pytest_cache','tests','*.tsbuildinfo','*.log') {
  Get-ChildItem -Path $Prod -Recurse -Force -ErrorAction SilentlyContinue -Include $junk |
    Where-Object { $_.FullName -notmatch '\\dist\\' -and $_.FullName -notmatch '\\node_modules\\' } |
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Sync complete.'
