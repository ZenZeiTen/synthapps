export type SegmentStatus = "auto" | "manual_edit" | "approved";

export interface AlignedSegment {
  id: string;
  sourceText: string;
  targetText: string;
  status: SegmentStatus;
}

export interface ExtractedTerm {
  id: string;
  sourceTerm: string;
  targetTerm: string; // empty string until the user maps it
  frequency: number;
}

export interface LanguageInfo {
  code: string;
  name: string;
  model: string | null;
}

export type Side = "source" | "target";
export type AlignMethod = "sequential" | "gale_church";
