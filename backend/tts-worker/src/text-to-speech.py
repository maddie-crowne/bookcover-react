import sys
import os
import time
from gtts import gTTS

MAX_CHARS = 3000

def chunk_text(text, max_chars=MAX_CHARS):
    chunks = []
    current = ""

    for paragraph in text.split("\n"):
        paragraph = paragraph.strip()
        if not paragraph:
            continue

        if len(current) + len(paragraph) + 1 <= max_chars:
            current += paragraph + " "
        else:
            if current:
                chunks.append(current.strip())
            current = paragraph + " "

    if current:
        chunks.append(current.strip())

    return chunks

def main():
    if len(sys.argv) < 3:
        print("Usage: python text-to-speech.py <input.txt> <output.mp3>")
        sys.exit(1)

    input_text_path = sys.argv[1]
    output_mp3_path = sys.argv[2]

    with open(input_text_path, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        print("Error: input text file is empty")
        sys.exit(1)

    chunks = chunk_text(text)
    temp_files = []

    try:
        for i, chunk in enumerate(chunks):
            temp_path = f"{output_mp3_path}.part{i}.mp3"
            print(f"Generating chunk {i+1}/{len(chunks)}...")

            tts = gTTS(chunk, lang="en", tld="com", slow=False)
            tts.save(temp_path)
            temp_files.append(temp_path)

            time.sleep(2)

        concat_list = f"{output_mp3_path}.txt"
        with open(concat_list, "w", encoding="utf-8") as f:
            for temp_path in temp_files:
                f.write(f"file '{os.path.abspath(temp_path)}'\n")

        os.system(
            f"ffmpeg -y -f concat -safe 0 -i \"{concat_list}\" -c copy \"{output_mp3_path}\""
        )

        print(f"Saved as '{output_mp3_path}'")

    finally:
        for temp_path in temp_files:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        concat_list = f"{output_mp3_path}.txt"
        if os.path.exists(concat_list):
            os.remove(concat_list)

if __name__ == "__main__":
    main()