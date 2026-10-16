using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class IrisDaemon
{
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public UIntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern UIntPtr SetTimer(IntPtr hWnd, UIntPtr nIDEvent, uint uElapse, IntPtr lpTimerFunc);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool KillTimer(IntPtr hWnd, UIntPtr uIDEvent);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    private const uint WM_TIMER = 0x0113;
    private const uint WM_HOTKEY = 0x0312;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_CONTROL = 0x0002;
    private const uint MOD_SHIFT = 0x0004;
    private const uint MOD_WIN = 0x0008;
    private const uint MOD_NOREPEAT = 0x4000;
    private const uint VK_I = 0x49;

    private const int SW_RESTORE = 9;
    private const int SW_SHOW = 5;

    private static string rootDir;
    private static int lastHotkeyTick = 0;
    private static string logFile;

    private static bool reg1 = false;
    private static bool reg2 = false;
    private static bool reg3 = false;

    private static void Log(string msg)
    {
        try
        {
            if (string.IsNullOrEmpty(logFile))
            {
                logFile = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "daemon_debug.log");
            }
            File.AppendAllText(logFile, DateTime.Now.ToString("HH:mm:ss.fff") + " - " + msg + Environment.NewLine);
        }
        catch {}
    }

    private static void TryRegisterHotkeys()
    {
        if (!reg1)
        {
            reg1 = RegisterHotKey(IntPtr.Zero, 1, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_I);
            if (!reg1) reg1 = RegisterHotKey(IntPtr.Zero, 1, MOD_CONTROL | MOD_SHIFT, VK_I);
            if (reg1) Log("Registered Hotkey 1: Ctrl+Shift+I");
        }

        if (!reg2)
        {
            reg2 = RegisterHotKey(IntPtr.Zero, 2, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, VK_I);
            if (!reg2) reg2 = RegisterHotKey(IntPtr.Zero, 2, MOD_CONTROL | MOD_ALT, VK_I);
            if (reg2) Log("Registered Hotkey 2: Ctrl+Alt+I");
        }

        if (!reg3)
        {
            reg3 = RegisterHotKey(IntPtr.Zero, 3, MOD_WIN | MOD_CONTROL | MOD_NOREPEAT, VK_I);
            if (!reg3) reg3 = RegisterHotKey(IntPtr.Zero, 3, MOD_WIN | MOD_CONTROL, VK_I);
            if (reg3) Log("Registered Hotkey 3: Win+Ctrl+I");
        }
    }

    [STAThread]
    static void Main()
    {
        Log("IrisDaemon started");
        try
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "IrisHotkeyDaemonMutex_Win32", out createdNew))
            {
                if (!createdNew)
                {
                    Log("Another IrisDaemon instance is already running. Exiting.");
                    return;
                }

                rootDir = AppDomain.CurrentDomain.BaseDirectory;
                if (File.Exists(Path.Combine(rootDir, "launch-iris.bat")))
                {
                    rootDir = Path.GetFullPath(Path.Combine(rootDir, ".."));
                }
                else if (File.Exists(Path.Combine(rootDir, "scripts", "launch-iris.bat")))
                {
                    rootDir = Path.GetFullPath(rootDir);
                }
                Log("Target root directory: " + rootDir);

                // Initial hotkey registration
                TryRegisterHotkeys();

                // Periodic timer to retry registration if another app (like previous Electron) held it and later closed
                UIntPtr timerId = SetTimer(IntPtr.Zero, UIntPtr.Zero, 2000, IntPtr.Zero);

                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
                {
                    if (msg.message == WM_HOTKEY)
                    {
                        Log("WM_HOTKEY received! Triggering HandleHotkey()");
                        HandleHotkey();
                    }
                    else if (msg.message == WM_TIMER)
                    {
                        if (!reg1 || !reg2 || !reg3)
                        {
                            TryRegisterHotkeys();
                        }
                    }
                    TranslateMessage(ref msg);
                    DispatchMessage(ref msg);
                }

                KillTimer(IntPtr.Zero, timerId);
                UnregisterHotKey(IntPtr.Zero, 1);
                UnregisterHotKey(IntPtr.Zero, 2);
                UnregisterHotKey(IntPtr.Zero, 3);
            }
        }
        catch (Exception ex)
        {
            Log("Fatal error in IrisDaemon: " + ex.ToString());
        }
        Log("IrisDaemon stopped");
    }

    private static void HandleHotkey()
    {
        try
        {
            int now = Environment.TickCount;
            if (Math.Abs(now - lastHotkeyTick) < 1500)
            {
                return;
            }
            lastHotkeyTick = now;

            // 1. Check if Electron or Iris is running and has a window
            IntPtr targetHwnd = IntPtr.Zero;
            string[] procNames = new string[] { "electron", "iris", "Iris" };

            bool anyProcessRunning = false;
            foreach (string name in procNames)
            {
                try
                {
                    Process[] procs = Process.GetProcessesByName(name);
                    if (procs.Length > 0)
                    {
                        anyProcessRunning = true;
                        foreach (Process p in procs)
                        {
                            if (p.MainWindowHandle != IntPtr.Zero)
                            {
                                targetHwnd = p.MainWindowHandle;
                                break;
                            }
                        }
                    }
                }
                catch { }
                if (targetHwnd != IntPtr.Zero) break;
            }

            // 2. If process exists but MainWindowHandle was 0 (frameless Electron window), search top-level windows
            if (targetHwnd == IntPtr.Zero && anyProcessRunning)
            {
                EnumWindows(new EnumWindowsProc(delegate(IntPtr hWnd, IntPtr lParam)
                {
                    int len = GetWindowTextLength(hWnd);
                    if (len > 0)
                    {
                        StringBuilder sb = new StringBuilder(len + 1);
                        GetWindowText(hWnd, sb, sb.Capacity);
                        string title = sb.ToString();
                        if (string.Equals(title, "Iris", StringComparison.OrdinalIgnoreCase) ||
                            title.StartsWith("Iris ", StringComparison.OrdinalIgnoreCase))
                        {
                            targetHwnd = hWnd;
                            return false;
                        }
                    }
                    return true;
                }), IntPtr.Zero);
            }

            // 3. If window found, restore and focus it
            if (targetHwnd != IntPtr.Zero)
            {
                Log("Bringing existing Iris window to foreground (HWND: " + targetHwnd + ")");
                if (IsIconic(targetHwnd))
                    ShowWindow(targetHwnd, SW_RESTORE);
                else
                    ShowWindow(targetHwnd, SW_SHOW);

                SetForegroundWindow(targetHwnd);
                return;
            }

            // 4. If no running process or window found, launch Iris completely
            string batPath = Path.Combine(rootDir, "scripts", "launch-iris.bat");
            if (!File.Exists(batPath))
            {
                batPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launch-iris.bat");
            }

            Log("No active Iris process found. Launching Iris with visible CMD from: " + batPath);
            if (File.Exists(batPath))
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + batPath + "\"\"");
                psi.WorkingDirectory = rootDir;
                psi.WindowStyle = ProcessWindowStyle.Normal;
                psi.CreateNoWindow = false;
                psi.UseShellExecute = true;
                Process.Start(psi);
                Log("Launched cmd.exe with visible console");
            }
        }
        catch (Exception ex)
        {
            Log("Exception in HandleHotkey: " + ex.ToString());
        }
    }
}
