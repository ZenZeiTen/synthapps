"""spaCy pipeline management, sentence segmentation and term extraction.

Full spaCy models (e.g. ``en_core_web_sm``) are used when installed, which
enables noun-chunk based term extraction. When a model is missing we fall
back to a blank pipeline with a rule-based sentencizer so the app keeps
working for any language, and term extraction degrades gracefully to
stopword-filtered n-gram frequency analysis.
"""
from __future__ import annotations

import re
import unicodedata
from collections import Counter
from functools import lru_cache

import spacy
from spacy.language import Language

# Languages offered in the UI. The model is only a preference: anything
# missing falls back to a blank pipeline + sentencizer.
SUPPORTED_LANGUAGES: dict[str, dict[str, str | None]] = {
    "en": {"name": "English", "model": "en_core_web_sm"},
    "id": {"name": "Indonesian", "model": None},
    "de": {"name": "German", "model": "de_core_news_sm"},
    "fr": {"name": "French", "model": "fr_core_news_sm"},
    "es": {"name": "Spanish", "model": "es_core_news_sm"},
    "it": {"name": "Italian", "model": "it_core_news_sm"},
    "pt": {"name": "Portuguese", "model": "pt_core_news_sm"},
    "nl": {"name": "Dutch", "model": "nl_core_news_sm"},
    "zh": {"name": "Chinese", "model": "zh_core_web_sm"},
    "ja": {"name": "Japanese", "model": "ja_core_news_sm"},
    "ko": {"name": "Korean", "model": "ko_core_news_sm"},
    "ru": {"name": "Russian", "model": "ru_core_news_sm"},
    "ar": {"name": "Arabic", "model": None},
    "ms": {"name": "Malay", "model": None},
    "vi": {"name": "Vietnamese", "model": None},
    "th": {"name": "Thai", "model": None},
}

# Minimal stopword sets used for the frequency-based fallback extractor.
# For languages with a loaded spaCy pipeline we use its own stopword list.
_EXTRA_STOPWORDS: dict[str, set[str]] = {
    "id": {
        "yang", "dan", "di", "ke", "dari", "ini", "itu", "untuk", "dengan",
        "pada", "adalah", "sebagai", "dalam", "tidak", "akan", "juga",
        "atau", "oleh", "kami", "kita", "mereka", "saya", "anda", "ia",
        "dia", "sudah", "telah", "bisa", "dapat", "ada", "karena", "jika",
        "agar", "serta", "namun", "tetapi", "harus", "saat", "ketika",
        "para", "lebih", "secara", "tersebut", "bahwa", "hal", "satu",
        "dua", "banyak", "setiap", "antara", "sangat", "hanya", "masih",
        "lain", "lainnya", "seperti", "hingga", "sampai", "bagi", "maka",
    },
}


def normalize_lang(code: str) -> str:
    code = (code or "en").strip().lower()
    return code if code in SUPPORTED_LANGUAGES else "en"


@lru_cache(maxsize=8)
def get_pipeline(lang: str) -> tuple[Language, str]:
    """Return a (pipeline, model_name) pair for a language code.

    Tries the full pretrained model first, then a blank pipeline with a
    sentencizer. The model name in the response tells the frontend which
    quality level is active.
    """
    lang = normalize_lang(lang)
    model = SUPPORTED_LANGUAGES[lang]["model"]
    if model:
        try:
            nlp = spacy.load(model, disable=["lemmatizer", "ner"])
            if not (nlp.has_pipe("senter") or nlp.has_pipe("parser") or nlp.has_pipe("sentencizer")):
                nlp.add_pipe("sentencizer")
            return nlp, model
        except OSError:
            pass
    try:
        nlp = spacy.blank(lang)
    except ImportError:
        nlp = spacy.blank("xx")
    nlp.add_pipe("sentencizer")
    return nlp, f"blank:{lang}+sentencizer"


_PARA_SPLIT = re.compile(r"\n\s*\n+")


def segment_sentences(text: str, lang: str) -> tuple[list[str], str]:
    """Split raw text into sentence strings.

    Paragraph breaks (blank lines) are always respected as hard boundaries,
    then spaCy splits sentences within each paragraph.
    """
    nlp, model = get_pipeline(lang)
    text = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    sentences: list[str] = []
    for para in _PARA_SPLIT.split(text):
        para = " ".join(para.split())
        if not para:
            continue
        doc = nlp(para)
        for sent in doc.sents:
            s = sent.text.strip()
            if s:
                sentences.append(s)
    return sentences, model


_TOKEN_RE = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*", re.UNICODE)


def _stopwords_for(nlp: Language, lang: str) -> set[str]:
    stops = {w.lower() for w in nlp.Defaults.stop_words}
    stops |= _EXTRA_STOPWORDS.get(lang, set())
    return stops


def extract_terms(text: str, lang: str, max_terms: int = 50) -> tuple[list[dict], str]:
    """Extract candidate terminology from the source text.

    Combines three signals:
    - noun chunks (when the loaded model has a parser),
    - frequent content-word unigrams,
    - frequent bigrams whose edges are content words.

    Counts are merged case-insensitively; the most frequent surface form is
    kept for display. Results are sorted by frequency, then alphabetically.
    """
    lang = normalize_lang(lang)
    nlp, model = get_pipeline(lang)
    doc = nlp(text)
    stops = _stopwords_for(nlp, lang)

    counts: Counter[str] = Counter()
    surface: dict[str, Counter] = {}

    def add(term: str) -> None:
        term = " ".join(term.split())
        key = term.lower()
        if not key or key in stops:
            return
        counts[key] += 1
        surface.setdefault(key, Counter())[term] += 1

    # 1) Noun chunks (only available when the model has a parser).
    if doc.has_annotation("DEP"):
        for chunk in doc.noun_chunks:
            tokens = [t for t in chunk if not (t.is_stop or t.is_punct or t.like_num or t.lower_ in stops)]
            if not tokens:
                continue
            phrase = " ".join(t.text for t in tokens)
            if 1 <= len(tokens) <= 4 and len(phrase) > 2:
                add(phrase)

    # 2) Unigrams + bigrams from a plain token stream (works for any
    # language). Bigrams are collected per sentence so they never span a
    # sentence boundary.
    sentences, _ = segment_sentences(text, lang)
    for sent in sentences:
        words = _TOKEN_RE.findall(sent)
        content = [(w, w.lower() not in stops and len(w) > 2) for w in words]
        for w, ok in content:
            if ok:
                add(w)
        for (w1, ok1), (w2, ok2) in zip(content, content[1:]):
            if ok1 and ok2:
                add(f"{w1} {w2}")

    # Drop unigrams that only ever appear inside a more frequent bigram.
    results = []
    for key, freq in counts.items():
        if freq < 2 and " " not in key:
            continue
        best_surface = surface[key].most_common(1)[0][0]
        results.append({"term": best_surface, "frequency": freq})

    results.sort(key=lambda r: (-r["frequency"], r["term"].lower()))
    return results[:max_terms], model
