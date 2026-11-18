"""Pydantic models shared by the API routes."""
from typing import Literal, Optional

from pydantic import BaseModel, Field


class SegmentRequest(BaseModel):
    source_text: str = Field(..., description="Raw source-language text")
    target_text: str = Field(..., description="Raw target-language text")
    source_lang: str = Field("en", description="ISO 639-1 code of the source language")
    target_lang: str = Field("id", description="ISO 639-1 code of the target language")
    align_method: Literal["sequential", "gale_church"] = "gale_church"


class AlignedSegment(BaseModel):
    id: str
    sourceText: str
    targetText: str
    status: Literal["auto", "manual_edit", "approved"] = "auto"


class SegmentResponse(BaseModel):
    segments: list[AlignedSegment]
    source_sentence_count: int
    target_sentence_count: int
    source_model: str
    target_model: str


class ExtractTermsRequest(BaseModel):
    source_text: str
    source_lang: str = "en"
    max_terms: int = Field(50, ge=1, le=500)


class ExtractedTerm(BaseModel):
    id: str
    sourceTerm: str
    targetTerm: str = ""
    frequency: int


class ExtractTermsResponse(BaseModel):
    terms: list[ExtractedTerm]
    model: str


class ExportSegmentsRequest(BaseModel):
    segments: list[AlignedSegment]
    source_lang: str = "en"
    target_lang: str = "id"


class TermForExport(BaseModel):
    sourceTerm: str
    targetTerm: str = ""
    frequency: int = 0


class ExportTermsRequest(BaseModel):
    terms: list[TermForExport]
    source_lang: str = "en"
    target_lang: str = "id"
    include_unmapped: bool = False


class LanguageInfo(BaseModel):
    code: str
    name: str
    model: Optional[str] = None
