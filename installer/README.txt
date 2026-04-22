JoyCreate - One Click Installer
================================

This ZIP contains everything you need to install JoyCreate on your computer.
No developer tools required.

------------------------------------------------------------
WINDOWS
------------------------------------------------------------
Files:  Install-JoyCreate.bat, Install-JoyCreate.ps1, JoyCreate-*-Setup.exe

1. Extract this ZIP (right-click -> Extract All).
2. Double-click  Install-JoyCreate.bat
3. Answer the prompts (Ollama / LibreOffice / Docker - all optional).
4. JoyCreate launches and a Desktop shortcut is created.

Unattended:  Install-JoyCreate.bat -Full           (install everything)
             Install-JoyCreate.bat -NoCompanions   (JoyCreate only)

Requires Windows 10 (1809+) or Windows 11 with winget.

------------------------------------------------------------
macOS
------------------------------------------------------------
Files:  Install-JoyCreate.command, JoyCreate-*.zip

1. Extract this ZIP (double-click).
2. Right-click  Install-JoyCreate.command  ->  Open
   (the right-click is required the first time so macOS lets it run).
3. Enter your password if it asks (needed to copy to /Applications).
4. Answer the prompts. JoyCreate opens from /Applications when done.

Unattended:  ./Install-JoyCreate.command --full
             ./Install-JoyCreate.command --no-companions

Companions are installed via Homebrew. If you don't have brew yet,
install it from https://brew.sh first, or skip the companion prompts.

------------------------------------------------------------
LINUX
------------------------------------------------------------
Files:  install-joycreate.sh, joycreate*.deb and/or joycreate*.rpm

1. Extract this ZIP.
2. Open a terminal in this folder and run:
       chmod +x install-joycreate.sh
       ./install-joycreate.sh
3. Enter your sudo password when asked.
4. Answer the prompts.

Supported package managers: apt, dnf, yum, zypper.
Arch users: convert the .deb with debtap or build from AUR.

Unattended:  ./install-joycreate.sh --full
             ./install-joycreate.sh --no-companions

------------------------------------------------------------
WHAT GETS INSTALLED
------------------------------------------------------------
* JoyCreate desktop app   (always)
* Ollama                  (optional - local AI models)
* LibreOffice             (optional - document export)
* Docker / Docker Desktop (optional - for n8n services and Celestia node)

n8n is started by JoyCreate itself on first launch using local SQLite -
no Docker required for that. OpenClaw runs on demand inside the app.
Docker is only needed for the Celestia node or the docker-based n8n stack.

------------------------------------------------------------
UNINSTALL
------------------------------------------------------------
Windows:  Settings -> Apps -> search "JoyCreate" -> Uninstall.
macOS:    Drag /Applications/JoyCreate.app to the Trash.
Linux:    sudo apt remove joycreate    (or dnf/yum/zypper equivalent)

The optional companions are removed the same way as any other app.
