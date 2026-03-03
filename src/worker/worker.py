import os
import sys
import requests
from urllib.parse import urlparse

DATA_DIR = os.environ.get("DATA_DIR", "/data")
os.makedirs(DATA_DIR, exist_ok=True)

# create download name
def filename_from_url(url: str, default: str) -> str:
    try:
        path = urlparse(url).path
        name = os.path.basename(path)
        return name if name else default
    except Exception:
        return default

#write contents to file
def download(url: str, out_path: str) -> None:
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(out_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1024 * 512):
                if chunk:
                    f.write(chunk)

def main():
    if len(sys.argv) < 3:
        print("Usage: python worker.py <epub_url_or_dash> <audio_url_or_dash>")
        sys.exit(1)

    epub_url = sys.argv[1]
    audio_url = sys.argv[2]

    if epub_url != "-":
        epub_name = filename_from_url(epub_url, "book.epub")
        book_dir = os.path.join(DATA_DIR, uid, bookId)
        os.makedirs(book_dir, exist_ok=True)
        epub_path = os.path.join(book_dir, epub_name)
        print(f"Downloading EPUB -> {epub_path}")
        download(epub_url, epub_path)
        print("EPUB done.")

    if audio_url != "-":
        audio_name = filename_from_url(audio_url, "audio.zip")
        audio_path = os.path.join(DATA_DIR, audio_name)
        print(f"Downloading audio -> {audio_path}")
        download(audio_url, audio_path)
        print("Audio done.")

    print("All downloads complete.")
    print("Files in /data:", os.listdir(DATA_DIR))

if __name__ == "__main__":
    main()