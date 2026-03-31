import sys
import os
import json
from ebooklib import epub
from bs4 import BeautifulSoup

def html_to_text(content):
    soup = BeautifulSoup(content, "html.parser")
    text = soup.get_text(separator=" ", strip=True)
    return text

def main():
    if len(sys.argv) < 3:
        print("Usage: python extract-chapters-from-epub.py <input.epub> <output_dir>")
        sys.exit(1)

    epub_path = sys.argv[1]
    output_dir = sys.argv[2]

    os.makedirs(output_dir, exist_ok=True)

    book = epub.read_epub(epub_path)

    chapters = []
    index = 1

    for item in book.get_items():
        if item.get_type() == 9:
            text = html_to_text(item.get_content())
            if text and len(text.strip()) > 200:
                chapter_filename = f"chapter_{index:03}.txt"
                chapter_path = os.path.join(output_dir, chapter_filename)

                with open(chapter_path, "w", encoding="utf-8") as f:
                    f.write(text)

                chapters.append({
                    "index": index,
                    "title": item.get_name(),
                    "file": chapter_filename
                })
                index += 1

    manifest_path = os.path.join(output_dir, "chapters.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(chapters, f, indent=2)

    print(f"Extracted {len(chapters)} chapters")
    print(f"Manifest written to {manifest_path}")

if __name__ == "__main__":
    main()