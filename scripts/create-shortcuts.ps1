$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
$programs = $ws.SpecialFolders("Programs")
$desktop = $ws.SpecialFolders("Desktop")
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
$vbsPath = "$rootDir\scripts\launch-iris.vbs"
$iconPath = "$rootDir\build\icon.ico"
if (-not (Test-Path $iconPath)) { $iconPath = "$rootDir\build\icon.png" }

# 1. Startup folder
if ($startup -and (Test-Path $startup)) {
  $s1 = $ws.CreateShortcut("$startup\Iris.lnk")
  $s1.TargetPath = "wscript.exe"
  $s1.Arguments = "`"$vbsPath`""
  $s1.WorkingDirectory = $rootDir
  $s1.IconLocation = "$iconPath,0"
  $s1.Description = "Iris AI Assistant (Ctrl+Alt+I)"
  $s1.Hotkey = "CTRL+ALT+I"
  $s1.Save()
}

# 2. Desktop
if ($desktop -and (Test-Path $desktop)) {
  $s2 = $ws.CreateShortcut("$desktop\Iris.lnk")
  $s2.TargetPath = "wscript.exe"
  $s2.Arguments = "`"$vbsPath`""
  $s2.WorkingDirectory = $rootDir
  $s2.IconLocation = "$iconPath,0"
  $s2.Description = "Iris AI Assistant (Ctrl+Alt+I)"
  $s2.Hotkey = "CTRL+ALT+I"
  $s2.Save()
}

# Also ensure local Desktop has Iris.lnk if OneDrive redirected Desktop
$localDesktop = "C:\Users\$env:USERNAME\Desktop"
if ((Test-Path $localDesktop) -and ($localDesktop -ne $desktop)) {
  try {
    $s2b = $ws.CreateShortcut("$localDesktop\Iris.lnk")
    $s2b.TargetPath = "wscript.exe"
    $s2b.Arguments = "`"$vbsPath`""
    $s2b.WorkingDirectory = $rootDir
    $s2b.IconLocation = "$iconPath,0"
    $s2b.Description = "Iris AI Assistant (Ctrl+Alt+I)"
    $s2b.Hotkey = "CTRL+ALT+I"
    $s2b.Save()
  } catch {}
}

# 3. Programs (Start Menu)
if ($programs -and (Test-Path $programs)) {
  $s3 = $ws.CreateShortcut("$programs\Iris.lnk")
  $s3.TargetPath = "wscript.exe"
  $s3.Arguments = "`"$vbsPath`""
  $s3.WorkingDirectory = $rootDir
  $s3.IconLocation = "$iconPath,0"
  $s3.Description = "Iris AI Assistant (Ctrl+Alt+I)"
  $s3.Hotkey = "CTRL+ALT+I"
  $s3.Save()
}

Write-Output "Shortcuts created successfully"
