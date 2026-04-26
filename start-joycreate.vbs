' JoyCreate launcher - shows brief splash, then starts app silently
' Usage: wscript.exe start-joycreate.vbs

Set sh = CreateObject("WScript.Shell")

projectDir = "C:\Users\Wise AI\joycreate\JoyCreate"
sh.CurrentDirectory = projectDir

' Check if already running - if so, do nothing (don't double-launch)
Set procs = GetObject("winmgmts:\\.\root\cimv2").ExecQuery( _
  "SELECT CommandLine FROM Win32_Process WHERE Name='electron.exe'")
For Each p In procs
  If InStr(LCase(p.CommandLine), "joycreate") > 0 Then
    sh.Popup "JoyCreate is already running.", 3, "JoyCreate", 64
    WScript.Quit 0
  End If
Next

' Brief auto-dismiss splash so the user gets feedback
sh.Popup "Starting JoyCreate..." & vbCrLf & vbCrLf & _
  "First launch may take ~30 seconds while the app builds." & vbCrLf & _
  "A new window will open when ready.", 4, "JoyCreate", 64

' Run hidden, don't wait
sh.Run "cmd /c npm run start", 0, False
