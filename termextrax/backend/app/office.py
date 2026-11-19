"""Plain-text extraction from Microsoft Office OOXML files.

Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) are ZIP containers of
XML parts, so extraction uses only the standard library. Legacy binary
formats (.doc/.xls/.ppt) are not supported; callers get a clear error
asking the user to re-save in the modern format.

Extraction keeps paragraph structure: paragraphs (Word), table/spreadsheet
rows (Excel) and slide paragraphs (PowerPoint) are separated by blank
lines, which the segmenter treats as hard sentence boundaries.
"""
from __future__ import annotations

import re
import zipfile
from io import BytesIO
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

OFFICE_EXTENSIONS = {".docx", ".xlsx", ".pptx"}
LEGACY_EXTENSIONS = {".doc", ".xls", ".ppt"}


class OfficeParseError(ValueError):
    """Raised when a file cannot be parsed as the claimed Office format."""


def _read_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        return ET.fromstring(zf.read(name))
    except (KeyError, ET.ParseError) as exc:
        raise OfficeParseError(f"Could not read part '{name}' of the Office file.") from exc


def _docx_text(zf: zipfile.ZipFile) -> str:
    root = _read_xml(zf, "word/document.xml")
    paragraphs = []
    for p in root.iter(f"{W}p"):
        text = "".join(
            t.text or "" for t in p.iter() if t.tag in (f"{W}t", f"{W}tab")
        )
        # Tabs render as spaces so cell-like layouts stay readable.
        text = " ".join(text.split())
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def _pptx_text(zf: zipfile.ZipFile) -> str:
    slide_names = sorted(
        (n for n in zf.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
        key=lambda n: int(re.search(r"\d+", n.rsplit("/", 1)[1]).group()),
    )
    if not slide_names:
        raise OfficeParseError("No slides found in the PowerPoint file.")
    paragraphs = []
    for name in slide_names:
        root = _read_xml(zf, name)
        for p in root.iter(f"{A}p"):
            text = " ".join("".join(t.text or "" for t in p.iter(f"{A}t")).split())
            if text:
                paragraphs.append(text)
    return "\n\n".join(paragraphs)


def _xlsx_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = _read_xml(zf, "xl/sharedStrings.xml")
    return [
        "".join(t.text or "" for t in si.iter(f"{S}t"))
        for si in root.iter(f"{S}si")
    ]


def _xlsx_text(zf: zipfile.ZipFile) -> str:
    shared = _xlsx_shared_strings(zf)
    sheet_names = sorted(
        n for n in zf.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)
    )
    if not sheet_names:
        raise OfficeParseError("No worksheets found in the Excel file.")
    rows_out = []
    for name in sheet_names:
        root = _read_xml(zf, name)
        for row in root.iter(f"{S}row"):
            cells = []
            for c in row.iter(f"{S}c"):
                ctype = c.get("t", "n")
                if ctype == "s":
                    v = c.find(f"{S}v")
                    idx = int(v.text) if v is not None and v.text else -1
                    value = shared[idx] if 0 <= idx < len(shared) else ""
                elif ctype == "inlineStr":
                    value = "".join(t.text or "" for t in c.iter(f"{S}t"))
                else:
                    v = c.find(f"{S}v")
                    value = v.text or "" if v is not None else ""
                value = " ".join(value.split())
                if value:
                    cells.append(value)
            if cells:
                # One spreadsheet row per paragraph so each row segments
                # independently; cells are joined with a single space.
                rows_out.append(" ".join(cells))
    return "\n\n".join(rows_out)


_EXTRACTORS = {
    ".docx": ("word/document.xml", _docx_text),
    ".pptx": ("[Content_Types].xml", _pptx_text),
    ".xlsx": ("xl/workbook.xml", _xlsx_text),
}


def extract_text(raw: bytes, extension: str) -> str:
    """Extract plain text from a .docx / .xlsx / .pptx byte payload."""
    extension = extension.lower()
    if extension not in _EXTRACTORS:
        raise OfficeParseError(f"Unsupported Office format: {extension}")
    if not raw.startswith(b"PK"):
        raise OfficeParseError(
            f"This does not look like a valid {extension} file. If it is a legacy "
            f"Office file, re-save it in the modern format and try again."
        )
    marker, extractor = _EXTRACTORS[extension]
    try:
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            if marker not in zf.namelist():
                raise OfficeParseError(
                    f"The file is missing the expected {extension} structure."
                )
            text = extractor(zf)
    except zipfile.BadZipFile as exc:
        raise OfficeParseError("The file is corrupted or not an Office document.") from exc
    if not text.strip():
        raise OfficeParseError("No extractable text found in the document.")
    return text
