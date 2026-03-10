import os
import sys
import json
import zipfile
import re
import xml.etree.ElementTree as ET
from bs4 import BeautifulSoup
import whisper
from difflib import SequenceMatcher

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)


def split_into_sentences(text: str):
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []

    placeholders = {
        "Mr.": "Mr<prd>",
        "Mrs.": "Mrs<prd>",
        "Ms.": "Ms<prd>",
        "Dr.": "Dr<prd>",
        "Prof.": "Prof<prd>",
        "St.": "St<prd>",
        "etc.": "etc<prd>",
        "i.e.": "i<prd>e<prd>",
        "e.g.": "e<prd>g<prd>",
    }

    for k, v in placeholders.items():
        text = text.replace(k, v)

    parts = re.split(r'(?<=[.!?])\s+', text)
    parts = [p.strip() for p in parts if p.strip()]

    restored = []
    for p in parts:
        for k, v in placeholders.items():
            p = p.replace(v, k)
        restored.append(p)

    return restored

def extract_xhtml_files(epub_path: str):
    with zipfile.ZipFile(epub_path, "r") as zf:
        names = zf.namelist()
        xhtml_files = [
            name for name in names
            if name.endswith(".xhtml") or name.endswith(".html") or name.endswith(".htm")
        ]
        return xhtml_files


def trim_front_matter(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()

    chapter_patterns = [
        r"\bCHAPTER\s+[IVXLCDM]+\b",
        r"\bChapter\s+[IVXLCDM]+\b",
        r"\bCHAPTER\s+\d+\b",
        r"\bChapter\s+\d+\b",
        r"\bBOOK\s+[IVXLCDM]+\b",
        r"\bBook\s+[IVXLCDM]+\b",
        r"\bBOOK\s+\d+\b",
        r"\bBook\s+\d+\b",
    ]

    candidates = []
    for pattern in chapter_patterns:
        for m in re.finditer(pattern, text):
            start = m.start()
            snippet = text[start:start + 1200].lower()

            bad_signs = [
                "heading to chapter",
                "list of illustrations",
                "frontispiece",
                "title-page",
                "dedication",
                "page ",
                "the end",
            ]

            good_signs = [
                "mr. ",
                "mrs. ",
                "“",
                "\"",
                "however",
                "he replied",
                "she replied",
                "said his lady",
            ]

            bad_score = sum(1 for s in bad_signs if s in snippet)
            good_score = sum(1 for s in good_signs if s in snippet)

            candidates.append((start, good_score, bad_score))

    if candidates:
        candidates.sort(key=lambda x: (-x[1], x[2], x[0]))
        best_start = candidates[0][0]
        trimmed = text[best_start:].strip()
        if len(trimmed) > 200:
            return trimmed

    return text


def extract_text_from_epub(epub_path: str):
    chapters = []

    FRONT_MATTER_HINTS = [
        "project gutenberg",
        "copyright",
        "title page",
        "preface",
        "table of contents",
        "contents",
        "list of illustrations",
        "illustrations",
        "dedication",
        "colophon",
        "publisher",
        "isbn",
        "all rights reserved",
        "cover",
    ]

    with zipfile.ZipFile(epub_path, "r") as zf:
        xhtml_files = extract_xhtml_files(epub_path)

        for name in xhtml_files:
            try:
                raw = zf.read(name)
                soup = BeautifulSoup(raw, "html.parser")

                for tag in soup(["script", "style", "nav"]):
                    tag.decompose()

                text = soup.get_text(separator=" ", strip=True)
                text = re.sub(r"\s+", " ", text).strip()

                if len(text) < 200:
                    continue

                lower = text.lower()
                hint_count = sum(1 for hint in FRONT_MATTER_HINTS if hint in lower)

                if hint_count >= 2:
                    text = trim_front_matter(text)

                sentence_candidates = re.split(r'(?<=[.!?])\s+', text)
                long_sentences = [s for s in sentence_candidates if len(s.split()) >= 8]

                if len(long_sentences) < 3:
                    continue

                chapters.append({
                    "file": name,
                    "text": text,
                    "sentences": split_into_sentences(text)
                })

            except Exception as e:
                print(f"Skipping {name}: {e}")

    return chapters


def transcribe_audio(audio_path: str, model_name: str = "base"):
    print(f"Loading Whisper model: {model_name}")
    model = whisper.load_model(model_name)

    print(f"Transcribing audio: {audio_path}")
    result = model.transcribe(audio_path)

    segments = []
    for seg in result.get("segments", []):
        segments.append({
            "id": seg.get("id"),
            "start": seg.get("start"),
            "end": seg.get("end"),
            "text": (seg.get("text") or "").strip(),
        })

    return {
        "audio": os.path.basename(audio_path),
        "full_text": result.get("text", "").strip(),
        "segments": segments,
    }

def normalize_text(s: str) -> str:
    s = s.lower()
    s = s.replace("“", '"').replace("”", '"').replace("’", "'")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def flatten_epub_sentences(chapters):
    flat = []
    for chapter_idx, chapter in enumerate(chapters):
        for sentence_idx, sentence in enumerate(chapter["sentences"]):
            sentence = sentence.strip()
            if not sentence:
                continue
            flat.append({
                "chapter_index": chapter_idx,
                "chapter_file": chapter["file"],
                "sentence_index": sentence_idx,
                "sentence": sentence,
                "normalized": normalize_text(sentence),
            })
    return flat


def build_segment_window_text(segments, start_idx, window_size):
    chosen = segments[start_idx:start_idx + window_size]
    joined = " ".join(seg["text"] for seg in chosen).strip()
    return joined, chosen


def align_sentences_to_transcript(chapters, transcript_segments, lookahead=12, max_window=4, threshold=0.72):
    epub_sentences = flatten_epub_sentences(chapters)
    aligned = []

    seg_ptr = 0

    for item in epub_sentences:
        sentence_raw = item["sentence"]
        sentence_norm = item["normalized"]

        # skip tiny / unhelpful sentence units
        if len(sentence_norm.split()) < 3:
            continue

        best = None

        for cand_start in range(seg_ptr, min(seg_ptr + lookahead, len(transcript_segments))):
            for window_size in range(1, max_window + 1):
                window_text, chosen = build_segment_window_text(transcript_segments, cand_start, window_size)
                window_norm = normalize_text(window_text)
                if not window_norm:
                    continue

                ratio = SequenceMatcher(None, sentence_norm, window_norm).ratio()

                if best is None or ratio > best["ratio"]:
                    best = {
                        "ratio": ratio,
                        "cand_start": cand_start,
                        "window_size": window_size,
                        "segments": chosen,
                        "window_text": window_text,
                    }

        if best and best["ratio"] >= threshold:
            first_seg = best["segments"][0]
            last_seg = best["segments"][-1]

            aligned.append({
                "chapter_index": item["chapter_index"],
                "chapter_file": item["chapter_file"],
                "sentence_index": item["sentence_index"],
                "sentence": sentence_raw,
                "start": first_seg["start"],
                "end": last_seg["end"],
                "match_ratio": round(best["ratio"], 4),
                "matched_text": best["window_text"],
                "segment_ids": [seg["id"] for seg in best["segments"]],
            })

            seg_ptr = best["cand_start"]
        else:
            aligned.append({
                "chapter_index": item["chapter_index"],
                "chapter_file": item["chapter_file"],
                "sentence_index": item["sentence_index"],
                "sentence": sentence_raw,
                "start": None,
                "end": None,
                "match_ratio": 0.0,
                "matched_text": None,
                "segment_ids": [],
            })

    return aligned

def main():
    if len(sys.argv) < 3:
        print("Usage: python worker.py <epub_path> <audio_path>")
        sys.exit(1)

    epub_path = sys.argv[1]
    audio_path = sys.argv[2]

    if not os.path.exists(epub_path):
        print(f"EPUB not found: {epub_path}")
        sys.exit(1)

    if not os.path.exists(audio_path):
        print(f"Audio not found: {audio_path}")
        sys.exit(1)

    print(f"Extracting text from EPUB: {epub_path}")
    chapters = extract_text_from_epub(epub_path)

    sentences_output = {
        "epub": os.path.basename(epub_path),
        "chapter_count": len(chapters),
        "chapters": chapters,
    }

    sentences_path = os.path.join(OUTPUT_DIR, "sentences.json")
    with open(sentences_path, "w", encoding="utf-8") as f:
        json.dump(sentences_output, f, indent=2, ensure_ascii=False)

    print(f"Wrote sentence data to: {sentences_path}")

    transcript_output = transcribe_audio(audio_path, model_name="base")

    transcript_path = os.path.join(OUTPUT_DIR, "transcript.json")
    with open(transcript_path, "w", encoding="utf-8") as f:
        json.dump(transcript_output, f, indent=2, ensure_ascii=False)

    print(f"Wrote transcript data to: {transcript_path}")

    aligned_output = align_sentences_to_transcript(
        chapters,
        transcript_output["segments"],
        lookahead=12,
        max_window=4,
        threshold=0.72,
    )

    aligned_path = os.path.join(OUTPUT_DIR, "aligned_timings.json")
    with open(aligned_path, "w", encoding="utf-8") as f:
        json.dump(aligned_output, f, indent=2, ensure_ascii=False)

    print(f"Wrote aligned timings to: {aligned_path}")

if __name__ == "__main__":
    main()