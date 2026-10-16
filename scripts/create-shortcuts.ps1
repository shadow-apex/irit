$ws = New-Object -ComObject WScript.Shell
$startup = $ws.SpecialFolders("Startup")
$programs = $ws.SpecialFolders("Programs")
$desktop = $ws.SpecialFolders("Desktop")
$rootDir = (Get-Item $PSScriptRoot).Parent.FullName
$vbsPath = "$rootDir\scripts\launch-iris.vbs"
$daemonExe = "$rootDir\scripts\IrisDaemon.exe"
$iconPath = "$rootDir\build\icon.ico"
if (-not (Test-Path $iconPath)) { $iconPath = "$rootDir\build\icon.png" }

# 1. Startup Registry for IrisDaemon (runs silently in background on Windows boot, 0% CPU, <2MB RAM)
if (Test-Path $daemonExe) {
  try {
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "IrisDaemon" -Value "`"$daemonExe`"" -Force
  } catch {}

  # Ensure daemon is currently running (detached)
  try {
    if (-not (Get-Process -Name "IrisDaemon" -ErrorAction SilentlyContinue)) {
      Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine = "`"$daemonExe`""} | Out-Null
    }
  } catch {
    try { Start-Process $daemonExe -WindowStyle Hidden } catch {}
  }
}

# 2. Startup folder shortcut (launch app on boot)
if ($startup -and (Test-Path $startup)) {
  $s1 = $ws.CreateShortcut("$startup\Iris.lnk")
  $s1.TargetPath = "wscript.exe"
  $s1.Arguments = "`"$vbsPath`""
  $s1.WorkingDirectory = $rootDir
  $s1.IconLocation = "$iconPath,0"
  $s1.Description = "Iris AI Assistant (Ctrl+Shift+I / Ctrl+Alt+I)"
  $s1.Hotkey = "CTRL+ALT+I"
  $s1.Save()
}

# 3. Desktop shortcuts
if ($desktop -and (Test-Path $desktop)) {
  $s2 = $ws.CreateShortcut("$desktop\Iris.lnk")
  $s2.TargetPath = "wscript.exe"
  $s2.Arguments = "`"$vbsPath`""
  $s2.WorkingDirectory = $rootDir
  $s2.IconLocation = "$iconPath,0"
  $s2.Description = "Iris AI Assistant (Ctrl+Shift+I / Ctrl+Alt+I)"
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
    $s2b.Description = "Iris AI Assistant (Ctrl+Shift+I / Ctrl+Alt+I)"
    $s2b.Hotkey = "CTRL+ALT+I"
    $s2b.Save()
  } catch {}
}

# 4. Programs (Start Menu)
if ($programs -and (Test-Path $programs)) {
  $s3 = $ws.CreateShortcut("$programs\Iris.lnk")
  $s3.TargetPath = "wscript.exe"
  $s3.Arguments = "`"$vbsPath`""
  $s3.WorkingDirectory = $rootDir
  $s3.IconLocation = "$iconPath,0"
  $s3.Description = "Iris AI Assistant (Ctrl+Shift+I / Ctrl+Alt+I)"
  $s3.Hotkey = "CTRL+ALT+I"
  $s3.Save()
}

Write-Output "Shortcuts and IrisDaemon registered successfully"
