$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$dataPath = Join-Path $projectRoot '.local\firebase-auth'
$emulatorArgs = @('emulators:start', '--project', 'demo-broget', '--only', 'auth', "--export-on-exit=$dataPath")
if (Test-Path -LiteralPath (Join-Path $dataPath 'firebase-export-metadata.json')) { $emulatorArgs += "--import=$dataPath" }
Write-Output 'Starting local Firebase Auth. MongoDB runs separately. Stop with Ctrl+C and wait for export to preserve test accounts and records.'
$ErrorActionPreference = 'Continue'
& firebase.cmd @emulatorArgs
$resultCode = $LASTEXITCODE
exit $resultCode
