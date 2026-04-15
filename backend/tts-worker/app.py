import os
import tempfile
import subprocess
import traceback
import requests
import json
import zipfile
from flask import Flask, request, jsonify
from flask_cors import CORS
import sys

import firebase_admin
from firebase_admin import credentials, firestore, storage

app = Flask(__name__)
CORS(app)

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred, {
    "storageBucket": "bookcover-muc-26.firebasestorage.app"
})

db = firestore.client()
bucket = storage.bucket()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "src")


def get_book_doc(uid, book_id):
    ref = db.collection("Users").document(uid).collection("Books").document(book_id)
    snap = ref.get()
    if not snap.exists:
        return None, None
    return ref, snap.to_dict()


def download_from_url(url, out_path):
    r = requests.get(url, stream=True, timeout=120)
    r.raise_for_status()
    with open(out_path, "wb") as f:
        for chunk in r.iter_content(1024 * 512):
            if chunk:
                f.write(chunk)


def download_from_storage(storage_path, out_path):
    blob = bucket.blob(storage_path)
    blob.download_to_filename(out_path)


def unzip_file(zip_path, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(out_dir)


def find_mp3_files(folder):
    mp3_files = []
    for root, _, files in os.walk(folder):
        for file in files:
            if file.lower().endswith(".mp3"):
                mp3_files.append(os.path.join(root, file))
    mp3_files.sort()
    return mp3_files


@app.post("/generate-audio")
def generate_audio():
    data = request.get_json()
    uid = data.get("uid")
    book_id = data.get("bookId")

    if not uid or not book_id:
        return jsonify({"error": "Missing uid or bookId"}), 400

    ref, book = get_book_doc(uid, book_id)
    if not book:
        return jsonify({"error": "Book not found"}), 404

    try:
        ref.set({
            "generated_audio_status": "running",
            "generated_audio_progress": 0,
            "generated_audio_current": 0,
            "generated_audio_total": 0,
            "generated_audio_error": None
        }, merge=True)

        with tempfile.TemporaryDirectory() as tmpdir:
            epub_path = os.path.join(tmpdir, "input.epub")

            if book.get("epub_storage_path"):
                download_from_storage(book["epub_storage_path"], epub_path)
            elif book.get("epub_link"):
                download_from_url(book["epub_link"], epub_path)
            else:
                raise Exception("No EPUB source found")

            chapters_dir = os.path.join(tmpdir, "chapters")
            os.makedirs(chapters_dir, exist_ok=True)

            extract_script = os.path.join(SRC_DIR, "extract-chapters-from-epub.py")
            tts_script = os.path.join(SRC_DIR, "chapter-to-mp3.py")

            if not os.path.exists(extract_script):
                raise Exception(f"Missing script: {extract_script}")
            if not os.path.exists(tts_script):
                raise Exception(f"Missing script: {tts_script}")

            extract_result = subprocess.run(
                [sys.executable, extract_script, epub_path, chapters_dir],
                capture_output=True,
                text=True
            )

            print("EXTRACT STDOUT:")
            print(extract_result.stdout)
            print("EXTRACT STDERR:")
            print(extract_result.stderr)

            if extract_result.returncode != 0:
                raise Exception(f"Chapter extract failed:\n{extract_result.stderr}")

            manifest_path = os.path.join(chapters_dir, "chapters.json")
            if not os.path.exists(manifest_path):
                raise Exception("Missing chapters.json after extraction")

            with open(manifest_path, "r", encoding="utf-8") as f:
                chapters = json.load(f)

            total_chapters = len(chapters)
            voice = book.get("generated_audio_voice", "en-US-GuyNeural")
            print("Using voice:", voice, "for book:", book_id)

            ref.set({
                "generated_audio_status": "running",
                "generated_audio_progress": 0,
                "generated_audio_current": 0,
                "generated_audio_total": total_chapters,
                "generated_audio_error": None,
                "generated_audio_voice": voice
            }, merge=True)

            audio_tracks = []

            for chapter in chapters:
                txt_path = os.path.join(chapters_dir, chapter["file"])
                mp3_filename = chapter["file"].replace(".txt", ".mp3")
                mp3_path = os.path.join(chapters_dir, mp3_filename)
                ref.set({
                    "generated_audio_status": "running",
                    "generated_audio_progress": int(((chapter["index"] - 1) / total_chapters) * 100),
                    "generated_audio_current": chapter["index"],
                    "generated_audio_total": total_chapters,
                    "generated_audio_step": f"Generating chapter {chapter['index']} of {total_chapters}"
                }, merge=True)

                try:
                    tts_result = subprocess.run(
                        [sys.executable, tts_script, txt_path, mp3_path, voice],
                        capture_output=True,
                        text=True,
                        timeout=300
                    )
                except subprocess.TimeoutExpired:
                    raise Exception(f"TTS timed out for chapter {chapter['index']}")

                print(f"TTS chapter {chapter['index']} STDOUT:")
                print(tts_result.stdout)
                print(f"TTS chapter {chapter['index']} STDERR:")
                print(tts_result.stderr)
                if tts_result.returncode != 0:
                    raise Exception(
                        f"TTS failed for chapter {chapter['index']}:\n{tts_result.stderr}"
                    )
                if not os.path.exists(mp3_path):
                    raise Exception(f"MP3 file was not created: {mp3_path}")

                storage_path = f"generated_audio/{uid}/{book_id}/chapter_{chapter['index']:03}.mp3"
                blob = bucket.blob(storage_path)
                blob.upload_from_filename(mp3_path)
                print("Uploaded MP3:", mp3_path)
                print("Storage path:", storage_path)

                audio_tracks.append({
                    "index": chapter["index"],
                    "title": chapter["title"],
                    "storage_path": storage_path
                })

                progress = int((chapter["index"] / total_chapters) * 100)

                ref.set({
                    "generated_audio_status": "running",
                    "generated_audio_progress": progress,
                    "generated_audio_current": chapter["index"],
                    "generated_audio_total": total_chapters,                        
                    "generated_audio_voice": voice
                }, merge=True)

            if not audio_tracks:
                raise Exception("No generated audio tracks were created")

            print("FINAL audio_tracks:", audio_tracks)

            ref.set({
                "generated_audio_status": "ready",
                "generated_audio_tracks": audio_tracks,
                "generated_audio_progress": 100,
                "generated_audio_current": len(audio_tracks),
                "generated_audio_total": len(audio_tracks),
                "generated_audio_error": None,
                "generated_audio_voice": voice
            }, merge=True)
            print("Firestore updated successfully with generated_audio_tracks")

        return jsonify({
            "status": "ok",
            "tracks": audio_tracks,
            "voice": voice
        })

    except Exception as e:
        traceback.print_exc()
        ref.set({
            "generated_audio_status": "error",
            "generated_audio_error": str(e)
        }, merge=True)
        return jsonify({
            "error": str(e),
            "trace": traceback.format_exc()
        }), 500

@app.post("/prepare-librivox-audio")
def prepare_librivox_audio():
    data = request.get_json()
    uid = data.get("uid")
    book_id = data.get("bookId")

    if not uid or not book_id:
        return jsonify({"error": "Missing uid or bookId"}), 400

    ref, book = get_book_doc(uid, book_id)
    if not book:
        return jsonify({"error": "Book not found"}), 404

    audio_link = book.get("audio_link")
    if not audio_link:
        return jsonify({"error": "No audio_link found"}), 400

    if not audio_link.lower().endswith(".zip"):
        return jsonify({"error": "audio_link is not a zip file"}), 400

    try:
        ref.set({
            "librivox_audio_status": "running",
            "librivox_audio_error": None,
            "librivox_audio_progress": 0,
            "librivox_audio_current": 0,
            "librivox_audio_total": 0
        }, merge=True)

        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = os.path.join(tmpdir, "audio.zip")
            extracted_dir = os.path.join(tmpdir, "audio_extracted")
            os.makedirs(extracted_dir, exist_ok=True)

            download_from_url(audio_link, zip_path)
            unzip_file(zip_path, extracted_dir)

            mp3_files = find_mp3_files(extracted_dir)
            if not mp3_files:
                raise Exception("No MP3 files found after unzipping")

            total_tracks = len(mp3_files)

            ref.set({
                "librivox_audio_status": "running",
                "librivox_audio_progress": 0,
                "librivox_audio_current": 0,
                "librivox_audio_total": total_tracks
            }, merge=True)

            tracks = []

            for i, mp3_file in enumerate(mp3_files, start=1):
                storage_path = f"librivox_audio/{uid}/{book_id}/track_{i:03}.mp3"
                blob = bucket.blob(storage_path)
                blob.upload_from_filename(mp3_file)

                tracks.append({
                    "index": i,
                    "title": os.path.basename(mp3_file),
                    "storage_path": storage_path
                })

                progress = int((i / total_tracks) * 100)
                ref.set({
                    "librivox_audio_status": "running",
                    "librivox_audio_progress": progress,
                    "librivox_audio_current": i,
                    "librivox_audio_total": total_tracks
                }, merge=True)

            ref.set({
                "librivox_audio_status": "ready",
                "librivox_audio_tracks": tracks,
                "librivox_audio_progress": 100,
                "librivox_audio_current": total_tracks,
                "librivox_audio_total": total_tracks,
                "librivox_audio_error": None
            }, merge=True)

            return jsonify({
                "status": "ok",
                "tracks": tracks
            })

    except Exception as e:
        traceback.print_exc()
        ref.set({
            "librivox_audio_status": "error",
            "librivox_audio_error": str(e)
        }, merge=True)
        return jsonify({
            "error": str(e),
            "trace": traceback.format_exc()
        }), 500

@app.get("/scrape-audio")
def scrape_audio():
    title = request.args.get("title", "").strip()
    if not title:
        return jsonify({"status": "error", "error": "Missing title"}), 400

    try:
        search_url = "https://librivox.org/api/feed/audiobooks"
        params = {
            "format": "json",
            "title": title,
        }

        r = requests.get(search_url, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()

        books = data.get("books", [])
        if not books:
            return jsonify({"status": "not_found"})

        book = books[0]

        candidates = [
            book.get("url_zip_file"),
            book.get("url_librivox"),
            book.get("url_iarchive"),
        ]

        audio_url = None
        for candidate in candidates:
            if candidate and candidate.lower().endswith(".zip"):
                audio_url = candidate
                break

        if not audio_url:
            return jsonify({"status": "not_found"})

        return jsonify({
            "status": "success",
            "audio_url": audio_url
        })

    except Exception as e:
        return jsonify({
            "status": "error",
            "error": str(e)
        }), 500
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002)