$ErrorActionPreference = 'Continue'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
foreach ($check in @('check', 'test', 'test:mongo')) {
  & npm.cmd --prefix backend run $check
  if ($LASTEXITCODE -ne 0) { throw "Backend $check failed." }
}
Write-Output 'Backend checks passed. No code was pushed and no deployment was started. See docs/RAILWAY.md for deployment.'
