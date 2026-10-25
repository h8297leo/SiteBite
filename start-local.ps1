$ErrorActionPreference = 'Stop'
$runtimeNodeDir = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
$runtimePnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
$env:PATH = $runtimeNodeDir + ';' + $env:PATH
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) { & $runtimePnpm install; if ($LASTEXITCODE -ne 0) { throw '套件安裝失敗' } }
& $runtimePnpm run dev
