# Text to speech (book to audiobook)
More details here https://dev.to/mallchel/text-to-speech-books-to-audio-ij8

### Requirements
- python 3

## How to
1. ```git clone ...repo...```
2. ```python -m venv .``` // create virtual environment
3. `source bin/activate` // activate virtual environment
4. `pip install -r requirements.txt`
5. `cd src`
6. `python extract-text-from-epub.py` // output -> assets/sample1.txt
7. `python text-to-speech.py` // output -> assets/sample1.mp3
