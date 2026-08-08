param(
    [Parameter(Mandatory=$true)]
    [string]$TargetApp
)

$targetName = $TargetApp.ToLower().Replace('.exe', '')

$procs = Get-Process -Name $targetName -ErrorAction SilentlyContinue
if (-not $procs) {
    exit 1
}

$global:pidSet = New-Object System.Collections.Generic.HashSet[int]
foreach ($p in $procs) {
    [void]$global:pidSet.Add($p.Id)
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@

$global:found = $false

$enumProc = {
    param($hWnd, $lParam)
    if ([Win32]::IsWindowVisible($hWnd)) {
        [uint]$windowPid = 0
        [Win32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid) | Out-Null
        
        if ($global:pidSet.Contains([int]$windowPid)) {
            [Win32]::ShowWindowAsync($hWnd, 2) | Out-Null
            $global:found = $true
        }
    }
    return $true
}

[Win32]::EnumWindows($enumProc, [IntPtr]::Zero) | Out-Null

if ($global:found) { exit 0 } else { exit 1 }
