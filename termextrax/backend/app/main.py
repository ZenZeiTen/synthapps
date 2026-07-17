"""TermExtrax API: segmentation & alignment, term extraction, exports."""
from __future__ import annotations

import uuid

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import alignment, exports, nlp
from .schemas import (
    AlignedSegment,
    ExportSegmentsRequest,
    ExportTermsRequest,
    ExtractedTerm,
    ExtractTermsRequest,
    ExtractTermsResponse,
    LanguageInfo,
    SegmentRequest,
    SegmentResponse,
)

app = FastAPI(title="TermExtrax API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_ENCODINGS = ("utf-8", "utf-8-sig", "utf-16", "cp1252", "latin-1")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/languages", response_model=list[LanguageInfo])
def languages() -> list[LanguageInfo]:
    return [
        LanguageInfo(code=code, name=info["name"], model=info["model"])
        for code, info in nlp.SUPPORTED_LANGUAGES.items()
    ]


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict:
    """Decode an uploaded .txt file, trying several encodings."""
    raw = await file.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File larger than 5 MB")
    for enc in _ENCODINGS:
        try:
            text = raw.decode(enc)
            return {"filename": file.filename, "encoding": enc, "text": text}
        except (UnicodeDecodeError, UnicodeError):
            continue
    raise HTTPException(
        status_code=422,
        detail="Could not decode file. Please save it as UTF-8 plain text and retry.",
    )


@app.post("/api/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest) -> SegmentResponse:
    if not req.source_text.strip() or not req.target_text.strip():
        raise HTTPException(status_code=422, detail="Both source and target text are required.")

    src_sents, src_model = nlp.segment_sentences(req.source_text, req.source_lang)
    tgt_sents, tgt_model = nlp.segment_sentences(req.target_text, req.target_lang)

    if req.align_method == "gale_church":
        pairs = alignment.align_gale_church(src_sents, tgt_sents)
    else:
        pairs = alignment.align_sequential(src_sents, tgt_sents)

    segments = [
        AlignedSegment(id=str(uuid.uuid4()), sourceText=s, targetText=t, status="auto")
        for s, t in pairs
    ]
    return SegmentResponse(
        segments=segments,
        source_sentence_count=len(src_sents),
        target_sentence_count=len(tgt_sents),
        source_model=src_model,
        target_model=tgt_model,
    )


@app.post("/api/extract-terms", response_model=ExtractTermsResponse)
def extract_terms(req: ExtractTermsRequest) -> ExtractTermsResponse:
    if not req.source_text.strip():
        raise HTTPException(status_code=422, detail="Source text is required.")
    results, model = nlp.extract_terms(req.source_text, req.source_lang, req.max_terms)
    terms = [
        ExtractedTerm(
            id=str(uuid.uuid4()),
            sourceTerm=r["term"],
            targetTerm="",
            frequency=r["frequency"],
        )
        for r in results
    ]
    return ExtractTermsResponse(terms=terms, model=model)


def _file_response(content: str, filename: str, media_type: str) -> Response:
    return Response(
        content=content.encode("utf-8"),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/api/export/corpus/csv")
def export_corpus_csv(req: ExportSegmentsRequest) -> Response:
    content = exports.segments_to_csv([s.model_dump() for s in req.segments], req.source_lang, req.target_lang)
    return _file_response(content, "aligned_corpus.csv", "text/csv; charset=utf-8")


@app.post("/api/export/corpus/tmx")
def export_corpus_tmx(req: ExportSegmentsRequest) -> Response:
    content = exports.segments_to_tmx([s.model_dump() for s in req.segments], req.source_lang, req.target_lang)
    return _file_response(content, "aligned_corpus.tmx", "application/xml; charset=utf-8")


@app.post("/api/export/terms/csv")
def export_terms_csv(req: ExportTermsRequest) -> Response:
    terms = [t.model_dump() for t in req.terms if req.include_unmapped or t.targetTerm.strip()]
    content = exports.terms_to_csv(terms, req.source_lang, req.target_lang)
    return _file_response(content, "termbase.csv", "text/csv; charset=utf-8")


@app.post("/api/export/terms/tbx")
def export_terms_tbx(req: ExportTermsRequest) -> Response:
    terms = [t.model_dump() for t in req.terms if req.include_unmapped or t.targetTerm.strip()]
    content = exports.terms_to_tbx(terms, req.source_lang, req.target_lang)
    return _file_response(content, "termbase.tbx", "application/xml; charset=utf-8")
