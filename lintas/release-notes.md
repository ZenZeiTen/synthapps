Lintas is a fast, secure desktop browser (Chromium engine) that works online and offline, with a built-in Translation Management System, Claude AI features, Chrome extensions and a Claude Desktop (MCP) connection.

## Download for Windows

Windows 10 or 11, 64-bit.

| File | What it is |
|---|---|
| `Lintas-Setup-<version>-x64.exe` | Installer for most PCs (Intel and AMD) |
| `Lintas-Setup-<version>-arm64.exe` | Installer for ARM PCs (Snapdragon) |
| `Lintas-Portable-<version>-x64.exe` | Runs without installing, Intel and AMD |
| `Lintas-Portable-<version>-arm64.exe` | Runs without installing, ARM |

The installer:
- installs for your user account only, without admin rights, unless you choose all users;
- adds Start menu and desktop shortcuts;
- lists Lintas in **Settings > Apps > Default apps**, so you can make it your default browser. You can also go to Lintas **Settings > General > Default browser**.

Uninstall from **Settings > Apps**. Your bookmarks, history, translation projects and offline pages stay in `%APPDATA%\Lintas` unless you delete that folder.

## Windows SmartScreen

These builds are not code-signed yet, so Windows may show "Windows protected your PC" the first time. Choose **More info > Run anyway**. Check the file first against the SHA-256 checksums below, for example in PowerShell:

```powershell
Get-FileHash .\Lintas-Setup-<version>-x64.exe -Algorithm SHA256
```

## Known limits

- No automatic updates yet: download the new version from this page and install it over the old one. Your data is kept.
- Chrome extensions: most work, but not all. Background workers get Lintas's extra Chrome APIs only with the normal sandbox. Smartling Context Capture loads and captures pages; signing in to Smartling has not been tested.
- AI features need your own Claude API key (Settings > AI).

Full details: [lintas/README.md](https://github.com/ZenZeiTen/synthapps/blob/main/lintas/README.md).
