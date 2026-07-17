# PyInstaller spec for the TermExtrax single-file executable.
#
# Build (after copying the built frontend to backend/static — the
# build_exe scripts do this automatically):
#   pyinstaller TermExtrax.spec
#
# Produces dist/TermExtrax.exe on Windows, dist/TermExtrax on Linux/macOS.
from PyInstaller.utils.hooks import collect_all, collect_submodules

datas = [("static", "static")]
binaries = []
hiddenimports = []

# spaCy loads language modules and ML deps lazily, which PyInstaller's
# static analysis cannot see — collect them explicitly.
for pkg in ("spacy", "thinc", "blis", "cymem", "preshed", "srsly", "murmurhash", "wasabi", "catalogue"):
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h
hiddenimports += collect_submodules("spacy.lang")

a = Analysis(
    ["launcher.py"],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="TermExtrax",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
