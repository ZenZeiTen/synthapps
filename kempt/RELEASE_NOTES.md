# Kempt 1.0.0

The first release.

- **Clean up**: temporary files, Windows temporary files, crash dumps, error reports, the
  thumbnail cache and the caches of Chrome, Edge, Brave and Firefox, each with an explanation and
  its largest files. Recent files and files in use are left alone; browser caches wait until the
  browser is closed. The Recycle Bin is emptied only when you choose it.
- **Overview** with a bar for the system drive and one-click **Tidy up** with a receipt.
- **Large files** and **Duplicates**, moved to the Recycle Bin, never deleted outright.
- **Startup** programs on or off with Task Manager's own switch.
- **App updates** through winget.
- **Health**: space, drive health, antivirus, firewall, updates, restart, battery, memory, and
  "Check and repair Windows" (SFC and DISM).
- **Privacy**: advertising ID, suggestions, tips and automatic installation of suggested apps.
- **Automatic care**, free, through Windows Task Scheduler.
- **History** of every change, with undo for startup and privacy changes.
- **Settings**: start at Windows startup, and open that startup window minimized on the taskbar.
  Both are off by default.
- A command line (`kempt-cli.exe`) and a Linux build.
