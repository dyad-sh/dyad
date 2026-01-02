# Create Desktop Shortcut for JoyCreate
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\JoyCreate.lnk")
$Shortcut.TargetPath = "$PSScriptRoot\start-joycreate.bat"
$Shortcut.WorkingDirectory = $PSScriptRoot
$Shortcut.Description = "Start JoyCreate AI Agent Builder"
$Shortcut.WindowStyle = 7  # Minimized
$Shortcut.Save()

Write-Host "Desktop shortcut created successfully!" -ForegroundColor Green
Write-Host "You can now double-click 'JoyCreate' on your desktop to start the app."
