Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W3 {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc proc, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc proc, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr p);
}
"@
$targetPid = (Get-Process JoyCreate -EA 0 | Select -First 1).Id
"PID: $targetPid"
$dialogHandle = [IntPtr]::Zero
$cb = [W3+EnumProc]{ param($h, $p)
  $sb = New-Object System.Text.StringBuilder 256
  [W3]::GetClassName($h, $sb, 256) | Out-Null
  $cls = $sb.ToString()
  $pid2 = 0
  [W3]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
  if ($pid2 -eq $targetPid -and $cls -eq "#32770") {
    $script:dialogHandle = $h
    return $false
  }
  return $true
}
[W3]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
"Dialog handle: $dialogHandle"
if ($dialogHandle -ne [IntPtr]::Zero) {
  $cb2 = [W3+EnumProc]{ param($h, $p)
    $sb = New-Object System.Text.StringBuilder 1024
    [W3]::GetClassName($h, $sb, 256) | Out-Null
    $cls = $sb.ToString()
    $sb.Clear() | Out-Null
    [W3]::GetWindowText($h, $sb, 1024) | Out-Null
    $txt = $sb.ToString()
    Write-Host "  cls=$cls text='$txt'"
    return $true
  }
  [W3]::EnumChildWindows($dialogHandle, $cb2, [IntPtr]::Zero) | Out-Null
}
