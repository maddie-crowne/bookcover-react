import os
import sys
import json
import zipfile
import re
from bs4 import BeautifulSoup
import whisper
from difflib import SequenceMatcher

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "output")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)


# -------------------------
# Basic text helpers
# -------------------------

def collapse_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def split_into_sentences(text: str):
    text = collapse_ws(text)
    if not text:
        return []

    split_work = text

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
        split_work = split_work.replace(k, v)

    split_work = re.sub(
        r'([.!?]["\'”’]?)\s+(?=[A-Z"\'“‘])',
        r'\1<SPLIT>',
        split_work
    )
    parts = [p.strip() for p in split_work.split("<SPLIT>") if p.strip()]

    restored = []
    for p in parts:
        for k, v in placeholders.items():
            p = p.replace(v, k)
        restored.append(p)

    return restored


def normalize_text(s: str) -> str:
    s = (s or "").lower()

    s = s.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    s = s.replace("—", " ").replace("–", " ")

    s = re.sub(r"\b([a-z])\s+([a-z]{1,2})\b", lambda m: m.group(1) + m.group(2), s)

    s = s.replace("nethfield", "netherfield")
    s = s.replace("bennet", "bennet")
    s = s.replace("bingley", "bingley")
    s = s.replace("darcy", "darcy")

    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# -------------------------
# Heading / non-spoken detection
# -------------------------

def is_heading_like(text: str) -> bool:
    s = collapse_ws(text)
    return bool(re.fullmatch(
        r'(chapter|book|part)\s+([ivxlcdm]+|\d+)\.?(?:\s*[:\-–]\s*.*)?',
        s,
        flags=re.IGNORECASE
    ))


def looks_like_chapter_heading_block(tag_name: str, text: str, classes: str = "", elem_id: str = "") -> bool:
    t = collapse_ws(text)
    cls = (classes or "").lower()
    eid = (elem_id or "").lower()

    if tag_name in {"h1", "h2", "h3", "h4"} and is_heading_like(t):
        return True

    if "chapter" in cls or "chapter" in eid:
        if len(t.split()) <= 12:
            return True

    if re.fullmatch(r'(chapter|book|part)\s+([ivxlcdm]+|\d+)\.?', t, flags=re.IGNORECASE):
        return True

    return False


def looks_like_nonspoken_line(s: str) -> bool:
    t = collapse_ws(s)
    lower = t.lower()

    if not t:
        return True

    if is_heading_like(t):
        return True

    if re.fullmatch(r"[ivxlcdm\d]+\.?", t, flags=re.IGNORECASE):
        return True

    if len(t.split()) <= 3 and not re.search(r'[.!?]["”’]?$', t):
        return True

    bad_terms = [
        "illustration",
        "frontispiece",
        "plate",
        "figure",
        "table of contents",
        "contents",
        "project gutenberg",
        "all rights reserved",
        "title page",
    ]
    if any(term in lower for term in bad_terms):
        return True

    return False


def should_merge_with_previous(sentence: str) -> bool:
    s = collapse_ws(sentence)
    if not s:
        return True

    word_count = len(s.split())

    if word_count <= 3:
        return True

    if re.match(r'^[\]\)\}"”\'‘’\-–,:;]+', s):
        return True

    if re.match(r'^(mr|mrs|ms|dr|prof|st)\.?$', s.lower()):
        return True

    if s[:1].islower():
        return True

    return False


def repair_leading_spacing(s: str) -> str:
    s = collapse_ws(s)
    if not s:
        return s

    s = re.sub(r'^((?:[A-Z]\s+){1,5}[A-Z])\b', lambda m: m.group(1).replace(" ", ""), s)
    s = re.sub(r'^([A-Z])\s+([A-Z]{1,3})(\b)', r"\1\2", s)

    return s


def split_embedded_dialogue(sentence: str):
    s = collapse_ws(sentence)
    if not s:
        return []

    parts = re.split(r'(?<=[.!?]["\'”’])\s+(?=["\'“‘])', s)
    parts = [collapse_ws(p) for p in parts if collapse_ws(p)]

    return parts if parts else [s]


def clean_sentences(sentences):
    cleaned = []

    for sentence in sentences:
        subparts = split_embedded_dialogue(sentence)

        for part in subparts:
            s = repair_leading_spacing(part)
            if not s:
                continue

            if looks_like_nonspoken_line(s):
                continue

            if cleaned and should_merge_with_previous(s):
                cleaned[-1] = cleaned[-1].rstrip() + " " + s.lstrip()
            else:
                cleaned.append(s)

    return cleaned


# -------------------------
# EPUB extraction helpers
# -------------------------

def extract_xhtml_files(epub_path: str):
    with zipfile.ZipFile(epub_path, "r") as zf:
        names = zf.namelist()
        return [
            name for name in names
            if name.endswith(".xhtml") or name.endswith(".html") or name.endswith(".htm")
        ]


def trim_front_matter(text: str) -> str:
    text = collapse_ws(text)

    chapter_patterns = [
        r"\bCHAPTER\s+[IVXLCDM]+\b",
        r"\bChapter\s+[IVXLCDM]+\b",
        r"\bCHAPTER\s+\d+\b",
        r"\bChapter\s+\d+\b",
        r"\bBOOK\s+[IVXLCDM]+\b",
        r"\bBook\s+[IVXLCDM]+\b",
        r"\bBOOK\s+\d+\b",
        r"\bBook\s+\d+\b",
        r"\bPART\s+[IVXLCDM]+\b",
        r"\bPart\s+[IVXLCDM]+\b",
        r"\bPART\s+\d+\b",
        r"\bPart\s+\d+\b",
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
                "contents",
                "project gutenberg",
            ]

            good_signs = [
                "mr. ",
                "mrs. ",
                "however",
                "he replied",
                "she replied",
                "said his lady",
                "it is a truth",
                "when",
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


def remove_noisy_elements(soup: BeautifulSoup):
    for tag in soup(["script", "style", "nav", "svg"]):
        tag.decompose()


def extract_blocks_from_soup(soup: BeautifulSoup):
    blocks = []

    for el in soup.find_all(["h1", "h2", "h3", "h4", "p", "blockquote", "div"]):
        text = collapse_ws(el.get_text(" ", strip=True))
        if not text:
            continue

        blocks.append({
            "tag": el.name,
            "text": text,
            "class": " ".join(el.get("class", [])).lower(),
            "id": str(el.get("id", "")).lower(),
        })

    return blocks


def split_blocks_into_logical_sections(blocks):
    if not blocks:
        return []

    sections = []
    current = []

    for block in blocks:
        is_boundary = looks_like_chapter_heading_block(
            tag_name=block["tag"],
            text=block["text"],
            classes=block["class"],
            elem_id=block["id"]
        )

        if is_boundary:
            if current:
                sections.append(current)
            current = [block]
        else:
            current.append(block)

    if current:
        sections.append(current)

    return sections


def make_logical_chapter_id(file_name: str, section_index: int):
    return f"{file_name}#section-{section_index}"


def build_section_text_from_blocks(section_blocks):
    text_parts = []
    heading_texts = []

    seen_non_heading_body = False

    for block in section_blocks:
        text = collapse_ws(block["text"])
        if not text:
            continue

        if looks_like_chapter_heading_block(block["tag"], text, block["class"], block["id"]):
            heading_texts.append(text)
            continue

        if looks_like_nonspoken_line(text):
            continue

        if block["tag"] in {"p", "blockquote", "div"}:
            text_parts.append(text)
            seen_non_heading_body = True
        elif not seen_non_heading_body and len(text.split()) >= 6:
            text_parts.append(text)

    section_text = collapse_ws(" ".join(text_parts))

    for heading in heading_texts:
        if heading:
            section_text = re.sub(
                rf'^(?:{re.escape(heading)}\s*)+',
                "",
                section_text,
                flags=re.IGNORECASE
            ).strip()

    section_text = collapse_ws(section_text)
    return heading_texts, section_text


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

                remove_noisy_elements(soup)

                file_text = collapse_ws(soup.get_text(" ", strip=True))
                if len(file_text) < 120:
                    continue

                lower = file_text.lower()
                hint_count = sum(1 for hint in FRONT_MATTER_HINTS if hint in lower)

                blocks = extract_blocks_from_soup(soup)
                if not blocks:
                    continue

                sections = split_blocks_into_logical_sections(blocks)
                trimmed_full_text = trim_front_matter(file_text) if hint_count >= 2 else file_text

                for section_idx, section_blocks in enumerate(sections):
                    headings, section_text = build_section_text_from_blocks(section_blocks)

                    if len(section_text.split()) < 30:
                        if section_idx == 0 and len(trimmed_full_text.split()) > 80:
                            section_text = trimmed_full_text

                    section_text = collapse_ws(section_text)

                    if len(section_text.split()) < 30:
                        continue

                    raw_sentences = split_into_sentences(section_text)
                    cleaned_sentences = clean_sentences(raw_sentences)

                    cleaned_sentences = [
                        s for s in cleaned_sentences
                        if len(normalize_text(s).split()) >= 2
                    ]

                    if cleaned_sentences:
                        cleaned_sentences[0] = re.sub(
                            r'^(chapter\s+\d+\s*)+',
                            "",
                            cleaned_sentences[0],
                            flags=re.IGNORECASE
                        ).strip()

                    cleaned_sentences = [s for s in cleaned_sentences if s]

                    if len(cleaned_sentences) < 2:
                        continue

                    chapters.append({
                        "file": make_logical_chapter_id(name, section_idx),
                        "source_file": name,
                        "section_index": section_idx,
                        "headings": headings,
                        "text": section_text,
                        "sentences": cleaned_sentences,
                    })

            except Exception as e:
                print(f"Skipping {name}: {e}")

    deduped = []
    seen = set()

    for chapter in chapters:
        key = normalize_text(" ".join(chapter["sentences"][:5]))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(chapter)

    return deduped


# -------------------------
# Transcript helpers
# -------------------------

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
            "text": collapse_ws(seg.get("text") or ""),
        })

    return {
        "audio": os.path.basename(audio_path),
        "full_text": collapse_ws(result.get("text", "")),
        "segments": segments,
    }


def split_transcript_text_into_units(text: str):
    text = collapse_ws(text)
    if not text:
        return []

    split_work = text.replace("“", '"').replace("”", '"').replace("’", "'").replace("‘", "'")
    split_work = re.sub(r'([.!?]["\']?)\s+(?=[A-Z"\'])', r"\1<SPLIT>", split_work)

    return [p.strip() for p in split_work.split("<SPLIT>") if p.strip()]


def explode_transcript_segments(segments):
    exploded = []
    new_id = 0

    for seg in segments:
        seg_text = collapse_ws(seg.get("text") or "")
        seg_start = seg.get("start")
        seg_end = seg.get("end")

        if not seg_text or seg_start is None or seg_end is None:
            continue

        units = split_transcript_text_into_units(seg_text)

        if len(units) <= 1:
            exploded.append({
                "id": new_id,
                "start": seg_start,
                "end": seg_end,
                "text": seg_text,
                "source_segment_id": seg.get("id"),
            })
            new_id += 1
            continue

        total_chars = sum(len(u) for u in units)
        duration = seg_end - seg_start
        running_start = seg_start

        for i, unit in enumerate(units):
            frac = len(unit) / total_chars if total_chars > 0 else 1 / len(units)
            unit_duration = duration * frac

            if i == len(units) - 1:
                unit_end = seg_end
            else:
                unit_end = running_start + unit_duration

            exploded.append({
                "id": new_id,
                "start": running_start,
                "end": unit_end,
                "text": unit,
                "source_segment_id": seg.get("id"),
            })
            new_id += 1
            running_start = unit_end

    return exploded


# -------------------------
# Alignment helpers
# -------------------------

def build_segment_window_text(segments, start_idx, window_size):
    chosen = segments[start_idx:start_idx + window_size]
    joined = " ".join(seg["text"] for seg in chosen).strip()
    return joined, chosen


def token_list(s: str):
    return [tok for tok in normalize_text(s).split() if tok]


def token_overlap_ratio(a_norm: str, b_norm: str) -> float:
    a = token_list(a_norm)
    b = token_list(b_norm)

    if not a or not b:
        return 0.0

    a_set = set(a)
    b_set = set(b)
    overlap = len(a_set & b_set)
    return overlap / max(1, len(a_set))


def prefix_overlap_ratio(a_norm: str, b_norm: str) -> float:
    a = token_list(a_norm)
    b = token_list(b_norm)

    if not a or not b:
        return 0.0

    limit = min(len(a), len(b))
    same = 0
    for i in range(limit):
        if a[i] == b[i]:
            same += 1
        else:
            break

    return same / max(1, min(len(a), 8))


def length_ratio(a_norm: str, b_norm: str) -> float:
    a_len = max(1, len(token_list(a_norm)))
    b_len = max(1, len(token_list(b_norm)))
    return min(a_len, b_len) / max(a_len, b_len)


def score_text_match(a_norm: str, b_norm: str) -> float:
    if not a_norm or not b_norm:
        return 0.0

    seq_ratio = SequenceMatcher(None, a_norm, b_norm).ratio()
    overlap = token_overlap_ratio(a_norm, b_norm)
    prefix = prefix_overlap_ratio(a_norm, b_norm)
    len_ratio = length_ratio(a_norm, b_norm)

    containment_bonus = 0.05 if (a_norm in b_norm or b_norm in a_norm) else 0.0

    return (
        0.45 * seq_ratio
        + 0.30 * overlap
        + 0.15 * prefix
        + 0.10 * len_ratio
        + containment_bonus
    )


def sentence_match_score(
    sentence_norm,
    window_norm,
    cand_start,
    seg_ptr,
    window_size,
    sentence_raw="",
    window_text="",
):
    if not sentence_norm or not window_norm:
        return 0.0

    base = score_text_match(sentence_norm, window_norm)

    distance_penalty = abs(cand_start - seg_ptr) * 0.008
    window_penalty = (window_size - 1) * 0.055

    sentence_words = len(token_list(sentence_norm))
    window_words = len(token_list(window_norm))
    extra_words = max(0, window_words - sentence_words)
    extra_word_penalty = extra_words * 0.012

    pointer_bonus = 0.02 if cand_start == seg_ptr else 0.0

    short_dialogue_bonus = 0.0
    if len(token_list(sentence_norm)) <= 8 and '"' in sentence_raw:
        if len(token_list(window_norm)) <= 12:
            short_dialogue_bonus = 0.03

    return (
        base
        + pointer_bonus
        + short_dialogue_bonus
        - distance_penalty
        - window_penalty
        - extra_word_penalty
    )


def build_chapter_anchor(sentences, min_words=6, max_sentences=3):
    chosen = []

    for s in sentences:
        s = collapse_ws(s)
        if not s or looks_like_nonspoken_line(s):
            continue

        norm = normalize_text(s)
        if len(norm.split()) < min_words:
            continue

        chosen.append(s)

        if len(chosen) >= max_sentences:
            break

    return " ".join(chosen).strip()


def find_best_chapter_start(anchor_text, transcript_segments, start_ptr, backtrack=20, lookahead=45, max_window=3):
    anchor_norm = normalize_text(anchor_text)
    if not anchor_norm:
        return None

    search_start = max(0, start_ptr - backtrack)
    search_end = min(len(transcript_segments), start_ptr + lookahead)

    best = None

    for cand_start in range(search_start, search_end):
        for window_size in range(1, max_window + 1):
            window_text, chosen = build_segment_window_text(transcript_segments, cand_start, window_size)
            window_norm = normalize_text(window_text)
            if not window_norm:
                continue

            score = sentence_match_score(
                anchor_norm,
                window_norm,
                cand_start,
                start_ptr,
                window_size,
                sentence_raw=anchor_text,
                window_text=window_text,
            )

            ratio = score_text_match(anchor_norm, window_norm)

            candidate = {
                "score": score,
                "ratio": ratio,
                "cand_start": cand_start,
                "window_size": window_size,
                "segments": chosen,
                "window_text": window_text,
            }

            if best is None or candidate["score"] > best["score"]:
                best = candidate

    return best


def next_seg_ptr_from_match(match_obj):
    if not match_obj or not match_obj["segments"]:
        return None

    last_seg = match_obj["segments"][-1]
    return last_seg["id"] + 1


def build_highlight_parts(sentence_raw: str, matched_text):
    sentence_raw = collapse_ws(sentence_raw)

    if not matched_text:
        return split_embedded_dialogue(sentence_raw)

    matched_text = collapse_ws(matched_text)

    parts = split_embedded_dialogue(sentence_raw)
    cleaned = []

    for p in parts:
        p = collapse_ws(p)
        if not p:
            continue

        p_norm = normalize_text(p)
        m_norm = normalize_text(matched_text)

        if not p_norm:
            continue

        if p_norm in m_norm or score_text_match(p_norm, m_norm) >= 0.72:
            cleaned.append(p)

    return cleaned if cleaned else split_embedded_dialogue(sentence_raw)


def choose_best_window(sentence_raw, sentence_norm, transcript_segments, seg_ptr, search_start, search_end, max_window):
    best = None

    for cand_start in range(search_start, search_end):
        for window_size in range(1, max_window + 1):
            window_text, chosen = build_segment_window_text(transcript_segments, cand_start, window_size)
            window_norm = normalize_text(window_text)
            if not window_norm:
                continue

            score = sentence_match_score(
                sentence_norm,
                window_norm,
                cand_start,
                seg_ptr,
                window_size,
                sentence_raw=sentence_raw,
                window_text=window_text,
            )

            ratio = score_text_match(sentence_norm, window_norm)

            candidate = {
                "score": score,
                "ratio": ratio,
                "cand_start": cand_start,
                "window_size": window_size,
                "segments": chosen,
                "window_text": window_text,
            }

            if best is None or candidate["score"] > best["score"]:
                best = candidate

    return best


def align_single_chapter_sentences(
    chapter,
    transcript_segments,
    seg_ptr,
    lookahead=6,
    max_window=3,
    threshold=0.80,
    fallback_threshold=0.74,
):
    aligned = []

    for sentence_idx, sentence_raw in enumerate(chapter["sentences"]):
        sentence_norm = normalize_text(sentence_raw)

        if len(sentence_norm.split()) < 2:
            aligned.append({
                "chapter_index": None,
                "chapter_file": chapter["file"],
                "sentence_index": sentence_idx,
                "sentence": sentence_raw,
                "highlight_text": sentence_raw,
                "highlight_parts": split_embedded_dialogue(sentence_raw),
                "start": None,
                "end": None,
                "match_ratio": 0.0,
                "matched_text": None,
                "segment_ids": [],
            })
            continue

        primary_start = max(0, seg_ptr - 1)
        primary_end = min(len(transcript_segments), seg_ptr + lookahead)

        best = choose_best_window(
            sentence_raw,
            sentence_norm,
            transcript_segments,
            seg_ptr,
            primary_start,
            primary_end,
            max_window=max_window,
        )

        accepted = best and best["ratio"] >= threshold

        if not accepted:
            fallback_start = max(0, seg_ptr - 2)
            fallback_end = min(len(transcript_segments), seg_ptr + 14)

            fallback_best = choose_best_window(
                sentence_raw,
                sentence_norm,
                transcript_segments,
                seg_ptr,
                fallback_start,
                fallback_end,
                max_window=2,
            )

            if fallback_best and fallback_best["ratio"] >= fallback_threshold:
                best = fallback_best
                accepted = True

        if accepted:
            first_seg = best["segments"][0]
            last_seg = best["segments"][-1]
            highlight_parts = build_highlight_parts(sentence_raw, best["window_text"])

            aligned.append({
                "chapter_index": None,
                "chapter_file": chapter["file"],
                "sentence_index": sentence_idx,
                "sentence": sentence_raw,
                "highlight_text": " ".join(highlight_parts).strip() if highlight_parts else sentence_raw,
                "highlight_parts": highlight_parts,
                "start": first_seg["start"],
                "end": last_seg["end"],
                "match_ratio": round(best["ratio"], 4),
                "matched_text": best["window_text"],
                "segment_ids": [seg["id"] for seg in best["segments"]],
            })

            new_ptr = next_seg_ptr_from_match(best)
            if new_ptr is not None:
                seg_ptr = new_ptr
        else:
            aligned.append({
                "chapter_index": None,
                "chapter_file": chapter["file"],
                "sentence_index": sentence_idx,
                "sentence": sentence_raw,
                "highlight_text": sentence_raw,
                "highlight_parts": split_embedded_dialogue(sentence_raw),
                "start": None,
                "end": None,
                "match_ratio": 0.0,
                "matched_text": None,
                "segment_ids": [],
            })

    return aligned, seg_ptr


def align_sentences_to_transcript(
    chapters,
    transcript_segments,
    lookahead=6,
    max_window=3,
    threshold=0.80,
    fallback_threshold=0.74,
):
    aligned = []
    seg_ptr = 0

    for chapter_index, chapter in enumerate(chapters):
        chapter_anchor = build_chapter_anchor(chapter["sentences"], min_words=6, max_sentences=3)

        anchor_match = None
        if chapter_anchor:
            anchor_match = find_best_chapter_start(
                chapter_anchor,
                transcript_segments,
                start_ptr=seg_ptr,
                backtrack=18 if chapter_index > 0 else 8,
                lookahead=45,
                max_window=3,
            )

        if anchor_match and anchor_match["ratio"] >= 0.68:
            seg_ptr = anchor_match["cand_start"]

        chapter_aligned, seg_ptr = align_single_chapter_sentences(
            chapter,
            transcript_segments,
            seg_ptr=seg_ptr,
            lookahead=lookahead,
            max_window=max_window,
            threshold=threshold,
            fallback_threshold=fallback_threshold,
        )

        for item in chapter_aligned:
            item["chapter_index"] = chapter_index
            item["chapter_anchor"] = chapter_anchor
            item["chapter_anchor_match_ratio"] = round(anchor_match["ratio"], 4) if anchor_match else None

        aligned.extend(chapter_aligned)

    return aligned


# -------------------------
# Main
# -------------------------

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

    transcript_units = explode_transcript_segments(transcript_output["segments"])

    transcript_units_path = os.path.join(OUTPUT_DIR, "transcript_units.json")
    with open(transcript_units_path, "w", encoding="utf-8") as f:
        json.dump(transcript_units, f, indent=2, ensure_ascii=False)

    print(f"Wrote transcript units to: {transcript_units_path}")

    aligned_output = align_sentences_to_transcript(
        chapters,
        transcript_units,
        lookahead=6,
        max_window=3,
        threshold=0.80,
        fallback_threshold=0.74,
    )

    aligned_path = os.path.join(OUTPUT_DIR, "aligned_timings.json")
    with open(aligned_path, "w", encoding="utf-8") as f:
        json.dump(aligned_output, f, indent=2, ensure_ascii=False)

    print(f"Wrote aligned timings to: {aligned_path}")


if __name__ == "__main__":
    main()