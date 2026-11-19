"""Single-process launcher for the packaged TermExtrax executable.

Serves the API and the built frontend from one uvicorn server on a free
local port and opens the default browser. This is the PyInstaller entry
point; it also works from a source checkout after `npm run build`.
"""
from __future__ import annotations

import os
import socket
import threading
import webbrowser

import uvicorn

from app.main import app, _static_dir


def _free_port(preferred: int = 8000) -> int:
    for port in (preferred, 0):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
        except OSError:
            continue
    return preferred


def main() -> None:
    if _static_dir() is None:
        print(
            "WARNING: built frontend not found — only the API will be served.\n"
            "Run 'npm run build' in frontend/ first (the build script does this for you)."
        )
    port = _free_port()
    url = f"http://127.0.0.1:{port}"
    print(f"TermExtrax running at {url}  (close this window to stop)")
    if not os.environ.get("TERMEXTRAX_NO_BROWSER"):
        threading.Timer(1.5, webbrowser.open, args=(url,)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
