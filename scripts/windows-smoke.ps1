$ErrorActionPreference = 'Stop'
$setup = Get-ChildItem src-tauri/target/release/bundle/nsis/*-setup.exe | Select-Object -First 1
if (!$setup) { throw 'NSIS installer not found' }
$installation = Start-Process $setup.FullName -ArgumentList '/S' -PassThru -Wait
if ($installation.ExitCode -ne 0) { throw "Installer failed with code $($installation.ExitCode)" }
$exe = Join-Path $env:LOCALAPPDATA 'Noesis\noesis.exe'
if (!(Test-Path $exe)) { throw "Application not installed at $exe" }
$application = Start-Process $exe -PassThru
try {
    Start-Sleep -Seconds 20
    if ($application.HasExited) { throw "Noesis exited early with code $($application.ExitCode)" }
    $db = Join-Path $env:APPDATA 'app.noesis.desktop\noesis.db'
    if (!(Test-Path $db)) { throw 'Application database was not created' }
    if ((Get-Item $db).Length -eq 0) { throw 'Application database is empty' }
    Write-Host "Install and launch passed. Process: $($application.Id); database: $((Get-Item $db).Length) bytes."
} finally {
    if (!$application.HasExited) { Stop-Process -Id $application.Id -Force }
}
Start-Sleep -Seconds 2
$uninstaller = Join-Path $env:LOCALAPPDATA 'Noesis\uninstall.exe'
Start-Process $uninstaller -ArgumentList '/S' -Wait
# NSIS can re-launch from a temporary directory before its parent exits.
for ($attempt = 0; $attempt -lt 30 -and (Test-Path $exe); $attempt++) { Start-Sleep -Seconds 1 }
if (Test-Path $exe) { throw "Uninstall left the executable at $exe" }
Write-Host 'Install / launch / uninstall OK'
