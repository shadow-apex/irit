import subprocess
import argparse
import sys
import io

# Đảm bảo in tiếng Việt không bị lỗi trên Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def move_window_with_powershell(window_title, x, y, width=None, height=None):
    """
    Sử dụng PowerShell để tìm và di chuyển cửa sổ ứng dụng trên Windows.
    Hỗ trợ tìm kiếm theo một phần tên cửa sổ (không phân biệt hoa thường).
    """
    
    # Mã C# để nhúng vào PowerShell nhằm tương tác với Windows API
    csharp_code = """
    using System;
    using System.Runtime.InteropServices;
    using System.Diagnostics;

    public class WindowHelper {
        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        public static void MoveWindow(string titleContains, int x, int y, int width, int height) {
            IntPtr hWnd = IntPtr.Zero;
            Process[] processes = Process.GetProcesses();
            foreach (Process p in processes) {
                if (!string.IsNullOrEmpty(p.MainWindowTitle) && p.MainWindowTitle.ToLower().Contains(titleContains.ToLower())) {
                    hWnd = p.MainWindowHandle;
                    Console.WriteLine("Đã tìm thấy cửa sổ: " + p.MainWindowTitle);
                    break;
                } else if (p.ProcessName.ToLower().Contains(titleContains.ToLower()) && p.MainWindowHandle != IntPtr.Zero) {
                    hWnd = p.MainWindowHandle;
                    Console.WriteLine("Đã tìm thấy cửa sổ thông qua tiến trình: " + p.ProcessName);
                    break;
                }
            }

            if (hWnd != IntPtr.Zero) {
                // Nếu width hoặc height = 0, giữ nguyên kích thước cũ của cửa sổ
                if (width == 0 || height == 0) {
                    RECT rect;
                    if (GetWindowRect(hWnd, out rect)) {
                        if (width == 0) width = rect.Right - rect.Left;
                        if (height == 0) height = rect.Bottom - rect.Top;
                    }
                }
                
                // 0x0040 = SWP_SHOWWINDOW (Hiển thị cửa sổ)
                SetWindowPos(hWnd, IntPtr.Zero, x, y, width, height, 0x0040);
                Console.WriteLine("Đã di chuyển thành công!");
            } else {
                Console.WriteLine("Không tìm thấy cửa sổ nào chứa từ khóa: " + titleContains);
            }
        }
    }
    """
    
    # Kích thước mặc định là 0 (giữ nguyên) nếu không truyền vào
    w = width if width is not None else 0
    h = height if height is not None else 0
    
    # Tập lệnh PowerShell
    ps_script = f"""
    Add-Type -TypeDefinition @"
    {csharp_code}
"@
    [WindowHelper]::MoveWindow('{window_title}', {x}, {y}, {w}, {h})
    """
    
    print(f"Đang gọi PowerShell để di chuyển '{window_title}' đến ({x}, {y})...")
    
    # Chạy lệnh PowerShell
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_script], 
        capture_output=True, 
        text=True,
        encoding="utf-8",
        errors="replace"
    )
    
    # In kết quả
    if result.stdout:
        print(result.stdout.strip())
    if result.stderr:
        print("Lỗi PowerShell:", result.stderr.strip())

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Di chuyển và thay đổi kích thước cửa sổ ứng dụng trên Windows")
    parser.add_argument("title", help="Tiêu đề (hoặc một phần tiêu đề) của cửa sổ ứng dụng")
    parser.add_argument("x", type=int, help="Tọa độ X trên màn hình")
    parser.add_argument("y", type=int, help="Tọa độ Y trên màn hình")
    parser.add_argument("--width", type=int, help="Chiều rộng mới (tùy chọn)", default=None)
    parser.add_argument("--height", type=int, help="Chiều cao mới (tùy chọn)", default=None)
    
    args = parser.parse_args()
    move_window_with_powershell(args.title, args.x, args.y, args.width, args.height)
