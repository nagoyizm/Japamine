$releaseDir = "C:\Users\aaaa\Dopamine-mejorado\Dopamine\release"
$destFolder = Join-Path $releaseDir "Japamine"
$winUnpacked = Join-Path $releaseDir "win-unpacked"

Write-Host "1. Preparando carpeta Japamine..."
if (Test-Path $destFolder) {
    Remove-Item -Path $destFolder -Recurse -Force
}
Copy-Item -Path $winUnpacked -Destination $destFolder -Recurse -Force

Write-Host "2. Copiando ejecutable portable..."
$portableSrc = Join-Path $releaseDir "Japamine-Portable-3.0.11.exe"
$portableDest = Join-Path $releaseDir "Japamine-Portable.exe"
if (Test-Path $portableSrc) {
    Copy-Item -Path $portableSrc -Destination $portableDest -Force
}

Write-Host "3. Creando accesos directos..."
$targetExe = Join-Path $destFolder "Japamine.exe"
$iconPath = Join-Path $destFolder "Japamine.exe"

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

# Acceso directo en la raiz del repositorio
$rootShortcut = $WshShell.CreateShortcut("C:\Users\aaaa\Dopamine-mejorado\Dopamine\Japamine.lnk")
$rootShortcut.TargetPath = $targetExe
$rootShortcut.WorkingDirectory = $destFolder
$rootShortcut.IconLocation = "$iconPath,0"
$rootShortcut.Description = "Japamine Audio Player"
$rootShortcut.Save()
Write-Host "-> Creado en raiz del proyecto: C:\Users\aaaa\Dopamine-mejorado\Dopamine\Japamine.lnk"

Write-Host "Proceso completado exitosamente."
