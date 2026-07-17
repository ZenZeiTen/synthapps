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

# Bundle any pretrained spaCy model packages installed at build time
# (e.g. after `python -m spacy download en_core_web_sm`) so the packaged
# app gets full-quality segmentation and noun-chunk term extraction.
for model in (
    "en_core_web_sm", "de_core_news_sm", "fr_core_news_sm", "es_core_news_sm",
    "it_core_news_sm", "pt_core_news_sm", "nl_core_news_sm", "zh_core_web_sm",
    "ja_core_news_sm", "ko_core_news_sm", "ru_core_news_sm",
):
    try:
        d, b, h = collect_all(model)
    except Exception:
        continue
    datas += d
    binaries += b
    hiddenimports += h

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
