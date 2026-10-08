$repoRoot = Split-Path -Parent $PSScriptRoot
$releaseDir = Join-Path $repoRoot "release"
$destFolder = Join-Path $releaseDir "Japamine"
$winUnpacked = Join-Path $releaseDir "win-unpacked"

Write-Host "1. Preparando carpeta Japamine..."
if (Test-Path $destFolder) {
    Remove-Item -Path $destFolder -Recurse -Force
}
if (Test-Path $winUnpacked) {
    Copy-Item -Path $winUnpacked -Destination $destFolder -Recurse -Force
}

Write-Host "2. Copiando ejecutable portable..."
$portableFiles = Get-ChildItem -Path $releaseDir -Filter "Japamine-Portable*.exe" -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne "Japamine-Portable.exe" }
if ($portableFiles -and $portableFiles.Count -gt 0) {
    $portableDest = Join-Path $releaseDir "Japamine-Portable.exe"
    Copy-Item -Path $portableFiles[0].FullName -Destination $portableDest -Force
}

Write-Host "3. Creando accesos directos..."
$targetExe = Join-Path $destFolder "Japamine.exe"
$iconPath = Join-Path $destFolder "Japamine.exe"

if (Test-Path $targetExe) {
    $WshShell = New-Object -ComObject WScript.Shell

    # Acceso directo en el Escritorio
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $desktopShortcut = $WshShell.CreateShortcut((Join-Path $desktopPath "Japamine.lnk"))
    $desktopShortcut.TargetPath = $targetExe
    $desktopShortcut.WorkingDirectory = $destFolder
    $desktopShortcut.IconLocation = "$iconPath,0"
    $desktopShortcut.Description = "Japamine Audio Player"
    $desktopShortcut.Save()
    Write-Host "-> Creado en Escritorio: $desktopPath\Japamine.lnk"

    # Acceso directo dentro de la carpeta Japamine
    $folderShortcut = $WshShell.CreateShortcut((Join-Path $destFolder "Japamine.lnk"))
    $folderShortcut.TargetPath = $targetExe
    $folderShortcut.WorkingDirectory = $destFolder
    $folderShortcut.IconLocation = "$iconPath,0"
    $folderShortcut.Description = "Japamine Audio Player"
    $folderShortcut.Save()
    Write-Host "-> Creado en carpeta Japamine: $destFolder\Japamine.lnk"
}

Write-Host "Proceso completado exitosamente."
