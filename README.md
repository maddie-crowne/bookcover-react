# Bookcover
**Bookcover** is a <b>personal library</b> web application that allows authenticated users to lookup (leveraging Gutenberg and Librivox APIs), upload, store, and read EPUBs and MP3 files;
generate the audio for an EPUB; and sync a (manually uploaded or generated) audio with an EPUB. It is not a distribution platform, or a public-facing service.

## Getting Started: (Step 1/3) Run the UI

The front-end was built using React. To launch the UI and use your library follow these instructions tailored for Virtual Studio Code:

### How To: Run React
1.  Open a Terminal.
2.  Install dependencies:
    ```
    npm install
    ```
3.  Run the development server:
    ```
    npm run dev
    ```
4.  Open your browser to the local address provided ( `http://localhost:<WHICHEVER PORT NUMBER>`).

### How To: Usage Guide
- Pick your display size (SMALL, MEDIUM, LARGE).
- Access Dark Mode on the top right bar.
- Sort by your bookshelf.
- **Add text/audio files:** Press on the Add new book tile and follow along.
- **Read/Listen:** Hover over the EPUB/Audio you'd like to access and use the Reader or Player button.
---

## Getting Started: (Step 2/3) Audio Generation
To enable the "Generate Audio" functionality within the UI, you must first have the generation backend running. 

### How To: Enable Audio Generation
`TODO: `
### How To: Link an EPUB with an Audio file 
`TODO: `


## Getting Started: (Step 3/3) Audio Synchronization Section
Please note that while the React UI contains a **Sync** button when you hover over any book with an associated audio file, clicking it within the browser currently **does not trigger the synchronization process**. 

To sync an EPUB with an audio file, you must run the process through its **Docker container**.

### How To: Sync

To synchronize your audio and text manually and generate the alignment JSON used by the Bookcover Reader, follow these steps:

1. Make sure Docker is running on your machine.

2. From the project root, start the synchronization services:

   ```bash
   docker compose up --build
   ```

3. In a separate terminal, start the React frontend:

   ```bash
   npm install
   npm run dev
   ```

4. Open the Bookcover app in your browser using the localhost address shown in the terminal.

5. Upload an **EPUB** file and a matching **audio** file.

6. Ensure both are linked to the same book entry in Bookcover.

7. Run the synchronization pipeline through the Docker/backend setup, not through the UI Sync button.

8. After processing completes, locate the generated alignment output file, typically:

   ```bash
   sentences.json
   ```

9. This file contains sentence-level timestamps used for synchronized highlighting in the reader.

### Example Output

```json
[
  {
    "sentence": "It is a truth universally acknowledged...",
    "start": 12.41,
    "end": 15.96
  }
]
```

### Notes

- Best results happen when EPUB text and audio closely match.
- LibriVox audio may include intros that cause early misalignment.
- Multi-chapter audio files can reduce accuracy.
