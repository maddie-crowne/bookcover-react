import sys
import asyncio
import edge_tts
import os
import subprocess
import tempfile

DEFAULT_VOICE = "en-US-GuyNeural"
MAX_CHARS = 2500


def chunk_text(text, max_chars=MAX_CHARS):
    text = text.strip()
    if not text:
        return []

    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    chunks = []
    current = ""

    for p in paragraphs:
        if len(current) + len(p) + 1 <= max_chars:
            current += p + "\n"
        else:
            if current.strip():
                chunks.append(current.strip())
            current = p + "\n"

    if current.strip():
        chunks.append(current.strip())

    return chunks


async def generate_one(text: str, output_mp3: str, voice: str):
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(output_mp3)


def main():
    if len(sys.argv) < 3:
        print("Usage: python chapter-to-mp3.py <input.txt> <output.mp3> [voice]")
        sys.exit(1)

    input_txt = sys.argv[1]
    output_mp3 = sys.argv[2]
    voice = sys.argv[3] if len(sys.argv) > 3 else DEFAULT_VOICE

    with open(input_txt, "r", encoding="utf-8") as f:
        text = f.read().strip()

    if not text:
        print("Input text file is empty")
        sys.exit(1)

    chunks = chunk_text(text)
    if not chunks:
        print("No usable text chunks found")
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        temp_mp3s = []

        for i, chunk in enumerate(chunks, start=1):
            part_path = os.path.join(tmpdir, f"part_{i:03}.mp3")
            print(f"Generating chunk {i}/{len(chunks)}")
            try:
                asyncio.run(generate_one(chunk, part_path, voice))
            except Exception as e:
                print(f"Edge-TTS failed on chunk {i}: {e}")
                sys.exit(1)
            temp_mp3s.append(part_path)

        concat_txt = os.path.join(tmpdir, "concat.txt")
        with open(concat_txt, "w", encoding="utf-8") as f:
            for part in temp_mp3s:
                f.write(f"file '{part}'\n")

        try:
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    concat_txt,
                    "-c",
                    "copy",
                    output_mp3,
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=120,
            )
        except subprocess.TimeoutExpired:
            print("ffmpeg timed out while combining chunk MP3s")
            sys.exit(1)
        except subprocess.CalledProcessError as e:
            print("ffmpeg failed:")
            print(e.stdout)
            print(e.stderr)
            sys.exit(1)

    print(f"Saved MP3: {output_mp3} using voice {voice}")


if __name__ == "__main__":
    main()