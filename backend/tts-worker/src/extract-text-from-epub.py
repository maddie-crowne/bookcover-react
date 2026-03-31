import sys
from ebooklib import epub
from bs4 import BeautifulSoup

def extract_text_from_epub(file_path):
    book = epub.read_epub(file_path)
    text_content = []

    for item in book.get_items():
        if item.get_type() == 9:
            soup = BeautifulSoup(item.content, "html.parser")
            text_content.append(soup.get_text())

    return "\n".join(text_content)

def main():
    if len(sys.argv) < 3:
        print("Usage: python extract-text-from-epub.py <input.epub> <output.txt>")
        sys.exit(1)

    epub_file_path = sys.argv[1]
    output_text_path = sys.argv[2]

    text = extract_text_from_epub(epub_file_path)

    with open(output_text_path, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"Text extracted and saved to '{output_text_path}'")

if __name__ == "__main__":
    main()