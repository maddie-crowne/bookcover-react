import React, { useEffect, useMemo, useState } from "react";
import { auth, db, storage } from "../firebase";
import { signOut } from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import Modal from "../components/Modal";
import { useNavigate } from "react-router-dom";

const SCRAPER_BASE_URL = "http://localhost:5002";
const AUDIO_SERVICE_BASE_URL = "http://127.0.0.1:5002";

const COLORS = {
  canvas: "#F9EAEA",
  ink: "#122630",
  frame: "#1A4B5D", // "rgb(26, 75, 93)",
  spark: "#E67E7E",
  status: "#F2C94C",
  accent: "#8E2424",
  white: "#FFFFFF",
  border: "rgba(18, 38, 48, 0.12)",
  mutedInk: "rgba(18, 38, 48, 0.72)",
};
const AUDIO_VOICES = [
    { value: "en-US-GuyNeural", label: "US Male Narrator" },
    { value: "en-US-JennyNeural", label: "US Female Narrator" },
    { value: "en-GB-RyanNeural", label: "UK Male Narrator" },
    { value: "en-GB-SoniaNeural", label: "UK Female Narrator" },
  ];

const FONTS = {
  headings: '"Merriweather", serif', // serif font used for book titles and section headers
  ui: '"Inter", sans-serif', // clean sans-serif for all UI chrome
  reading: '"Source Serif 4", serif',
  //ui: '"Inter", "Helvetica Neue", Arial, sans-serif',
  //reading: '"Libre Baskerville", Georgia, serif',
};

// width/height are the book card dimensions. 
// lineClamp caps how many lines of the book title are shown
const GRID_CONFIGS = {
  small: { width: 110, height: 165, gap: 16, fontSize: 11, lineClamp: 2 },
  medium: { width: 160, height: 240, gap: 24, fontSize: 14, lineClamp: 3 },
  large: { width: 210, height: 315, gap: 32, fontSize: 18, lineClamp: 3 },
};

const DEFAULT_GENERATED_AUDIO_FIELDS = {
  generated_audio_status: "idle", // idle, running, ready, error
  generated_audio_progress: 0, // 0-100 percent, shown in the progress bar
  generated_audio_current: 0, // how many chunks have been processed so far
  generated_audio_total: 0, // total number of chunks in the book
  generated_audio_tracks: [], // array of storage paths, one per generated audio chunk
  generated_audio_error: null,
};

// turns a book title into a Firestore ID eg "Pride & Prejudice"  "pride--prejudice"
const generateBookId = (title) =>
  title.toLowerCase().trim().replace(/[^a-z0-9]/g, "-");

// Gutendex is a "JSON web API for Project Gutenberg ebook metadata" 
const coverFromGutendex = (formats) => formats?.["image/jpeg"] || "";
const epubFromGutendex = (formats) => formats?.["application/epub+zip"] || "";

// looks up the label for a voice ID 
const getVoiceLabel = (value) =>
    AUDIO_VOICES.find((v) => v.value === value)?.label || value;

const getBookDocRef = (uid, bookId) => doc(db, "Users", uid, "Books", bookId);

export default function Dashboard({ user, darkMode, setDarkMode }) {
  const navigate = useNavigate();
  const [gridSize, setGridSize] = useState("medium");  // deafult layout choice: "small" "medium" "large"
  const [sortBy, setSortBy] = useState("recent");
  const [books, setBooks] = useState([]); // live-synced array of the user's books from Firestore
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("upload"); // upload/search IS THIS USED?

  // Manual Upload tab inputs
  const [upTitle, setUpTitle] = useState("");
  const [upAuthor, setUpAuthor] = useState("");
  const [upFile, setUpFile] = useState(null); // the selected .epub File object
  const [upAudioFile, setUpAudioFile] = useState(null); // the selected audio File object (mp3 for us)
  const [upStatus, setUpStatus] = useState("");
  
  // Hover states of buttons
  const [isUploadHovered, setIsUploadHovered] = useState(false);
  const [isGenerateHovered, setIsGenerateHovered] = useState(false);
  const [isSyncHovered, setIsSyncHovered] = useState(false);
  const [isSearchHovered, setIsSearchHovered] = useState(false);
  //const [isLogoutHovered, setIsLogoutHovered] = useState(false);
  //const [isDarkToggleHovered, setIsDarkToggleHovered] = useState(false);
  const [isSaveHovered, setIsSaveHovered] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState("en-US-GuyNeural");
  const [hoveredSize, setHoveredSize] = useState(null);   // tracks which grid-size pill button the mouse is hovering 

  const [editPendingLibrivoxLink, setEditPendingLibrivoxLink] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const THEME = darkMode ? {
    canvas: "#1a1a2e",
    ink: "#e8e8f0",
    frame: "#4a9eba",
    mutedInk: "rgba(232,232,240,0.65)",
    white: "#16213e",
    border: "rgba(232,232,240,0.12)",
  } : {
    canvas: COLORS.canvas,
    ink: COLORS.ink,
    frame: COLORS.frame,
    mutedInk: COLORS.mutedInk,
    white: COLORS.white,
    border: COLORS.border,
  };

  // "Add a new book" tab states: used when the user searches Gutenberg by title/author
  const [q, setQ] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [results, setResults] = useState([]);

  // "Edit" states
  const [editOpen, setEditOpen] = useState(false);
  const [editBook, setEditBook] = useState(null); // the book object currently being edited
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editEpubFile, setEditEpubFile] = useState(null); // new EPUB to replace the existing one, or null if unchanged
  const [editAudioFile, setEditAudioFile] = useState(null); // new audio file, or null if unchanged
  const [editStatus, setEditStatus] = useState("");
  const [editAudioMode, setEditAudioMode] = useState("upload"); // "upload" or "librivox"
  const [editAudioSearch, setEditAudioSearch] = useState("");
  const [editAudioSearchStatus, setEditAudioSearchStatus] = useState("");
  const [editFoundAudioLink, setEditFoundAudioLink] = useState("");
    
  // "Audio" states: used when the user picks an AI voice to generate audio for an EPUB 
  const [audioOpen, setAudioOpen] = useState(false);
  const [audioBook, setAudioBook] = useState(null);
  const [selectedVoiceLocal, setSelectedVoiceLocal] = useState("en-US-GuyNeural");
  
  // "Sync" states: user can choose whether to sync the manually uploaded audio or the AI-generated audio
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncBook, setSyncBook] = useState(null);
  const [syncSelection, setSyncSelection] = useState("default");

  const booksCol = useMemo(() => collection(db, "Users", user.uid, "Books"), [user.uid]);
  
  // derives a transformed list from 'books'. This block only re-runs if a book is added/removed or sortBy is modified
  const sortedBooks = useMemo(() => {
    const list = [...books];

    if (sortBy === "title-asc") {
      list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      return list;
    }

    if (sortBy === "title-desc") {
      list.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
      return list;
    }

    if (sortBy === "author-asc") {
      list.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
      return list;
    }

    if (sortBy === "author-desc") {
      list.sort((a, b) => (b.author || "").localeCompare(a.author || ""));
      return list;
    }

    if (sortBy === "recent") {
      list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      return list;
    }

    if (sortBy === "epub") {
      return list.filter((b) => !!b.epub_link || !!b.epub_storage_path);
    }

    if (sortBy === "audio") {
      return list.filter(
        (b) =>
          !!b.audio_link ||
          !!b.audio_storage_path ||
          (Array.isArray(b.librivox_audio_tracks) && b.librivox_audio_tracks.length > 0)
      );
    }

    return list;
  }, [books, sortBy]);
  // opens a real-time Firestore listener that keeps the books array in sync with the DB.
  useEffect(() => {
    const unsub = onSnapshot(booksCol, (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setBooks(list);
    });
  
    return () => unsub();
  }, [booksCol]);

  const resetUploadForm = () => {
    setUpTitle("");
    setUpAuthor("");
    setUpFile(null);
    setUpAudioFile(null);
    setUpStatus("");
    setSelectedVoice("en-US-GuyNeural");
  };

  const logout = async () => {
    const confirmed = window.confirm("Are you sure you want to log out?");

    if (confirmed) {
      try {
        await signOut(auth);
        navigate("/"); 
      } catch (error) {
        console.error("Logout failed:", error);
      }
    }
  };
  // EDIT MODAL
  const openEditModal = (book) => {
    setEditBook(book);
    setEditTitle(book.title || "");
    setEditAuthor(book.author || "");
    setEditEpubFile(null);
    setEditAudioFile(null);
    setEditStatus("");

    setEditAudioMode("upload");
    setEditAudioSearch(book.title || "");
    setEditAudioSearchStatus("");
    setEditFoundAudioLink("");
    setEditPendingLibrivoxLink("");

    setEditOpen(true);
  };

  const closeEditModal = () => {
    setEditOpen(false);
    setEditBook(null);
    setEditTitle("");
    setEditAuthor("");
    setEditEpubFile(null);
    setEditAudioFile(null);
    setEditStatus("");

    setEditAudioMode("upload");
    setEditAudioSearch("");
    setEditAudioSearchStatus("");
    setEditFoundAudioLink("");
    setEditPendingLibrivoxLink("");
    setIsSavingEdit(false);
  };
  const saveEditedBook = async () => {
    if (!editBook || isSavingEdit) return;

    setIsSavingEdit(true);
    setEditStatus("");

    try {
      const updates = {
        title: editTitle.trim() || "Untitled",
        author: editAuthor.trim() || "Unknown",
        updatedAt: serverTimestamp(),
      };

      if (editEpubFile) {
        setEditStatus("Uploading new EPUB...");
        const epubPath = `epubs/${user.uid}/${editBook.id}.epub`;
        await uploadBytes(ref(storage, epubPath), editEpubFile);
        updates.epub_storage_path = epubPath;
        updates.epub_source = "upload";
      }

      if (editAudioMode === "upload" && editAudioFile) {
        setEditStatus("Uploading new audio...");
        const audioPath = `audio/${user.uid}/${editBook.id}/${editAudioFile.name}`;
        await uploadBytes(ref(storage, audioPath), editAudioFile);

        updates.audio_storage_path = audioPath;
        updates.audio_link = null;
        updates.audio_source = "upload";
        updates.librivox_audio_tracks = [];
        
        updates.generated_audio_tracks = [];
        updates.generated_audio_status = "idle";
        updates.generated_audio_progress = 0;
        updates.generated_audio_current = 0;
        updates.generated_audio_total = 0;
        updates.generated_audio_error = null;

        updates.librivox_audio_status = "idle";
        updates.librivox_audio_progress = 0;
        updates.librivox_audio_current = 0;
        updates.librivox_audio_total = 0;
        updates.librivox_audio_error = null;
      }

      if (editAudioMode === "librivox" && editPendingLibrivoxLink) {
        setEditStatus("Saving LibriVox audio...");
        updates.audio_link = editPendingLibrivoxLink;
        updates.audio_storage_path = null;
        updates.audio_source = "librivox";

        
        updates.generated_audio_tracks = [];
        updates.generated_audio_status = "idle";
        updates.generated_audio_progress = 0;
        updates.generated_audio_current = 0;
        updates.generated_audio_total = 0;
        updates.generated_audio_error = null;
      }

      setEditStatus("Saving changes...");
      await setDoc(getBookDocRef(user.uid, editBook.id), updates, { merge: true });

      if (editAudioMode === "librivox" && editPendingLibrivoxLink) {
        setEditStatus("Starting LibriVox audio prep...");
        prepareLibrivoxAudio(editBook.id).catch((e) => {
          console.error("LibriVox prep failed:", e);
        });
      }

      closeEditModal();
    } catch (e) {
      setEditStatus("Edit failed: " + e.message);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // AUDIO MODAL
  const openAudioModal = (book) => {
    setAudioBook(book);
    // pre-select whichever voice was last saved to this book, defaulting to US Male
    setSelectedVoiceLocal(book.generated_audio_voice || "en-US-GuyNeural");
    setAudioOpen(true);
  };
  const closeAudioModal = () => {
    setAudioOpen(false);
    setAudioBook(null);
  };

  // SYNC MODAL
  const openSyncModal = (book) => {
    setSyncBook(book);
    setSyncSelection("default");
    setSyncOpen(true);
  };

  const closeSyncModal = () => {
    setSyncOpen(false);
    setSyncBook(null);
  };

  const deleteBook = async (book) => {
    const confirmed = window.confirm(
      `Delete "${book.title || "this book"}" from your bookshelf?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    try {
      // note: this only removes the Firestore document — the actual files in Firebase Storage are NOT deleted
      await deleteDoc(getBookDocRef(user.uid, book.id));
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  };

  // UPLOAD TAB - ie upload manually
  const uploadManualFiles = async () => {
    setUpStatus("");

    if (!upTitle.trim()) {
      setUpStatus("Please provide a title.");
      return;
    }

    if (!upFile && !upAudioFile) {
      setUpStatus("Upload an EPUB and/or an audio file.");
      return;
    }

    try {
      const bookId = generateBookId(upTitle);
      const bookRef = getBookDocRef(user.uid, bookId);

      const baseDoc = {
        title: upTitle.trim(),
        author: upAuthor.trim() || "Unknown",
        ...DEFAULT_GENERATED_AUDIO_FIELDS,
        generated_audio_voice: selectedVoice,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      setUpStatus("Saving book…");
      await setDoc(bookRef, baseDoc, { merge: true });

      if (upFile) {
        setUpStatus("Uploading EPUB…");
        const epubPath = `epubs/${user.uid}/${bookId}.epub`;
        await uploadBytes(ref(storage, epubPath), upFile);

        await setDoc(
          bookRef,
          {
            epub_storage_path: epubPath,
            epub_source: "upload",
            generated_audio_status: "idle",
            generated_audio_voice: selectedVoice,
            generated_audio_storage_path: null,
            generated_audio_error: null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (upAudioFile) {
        setUpStatus("Uploading audio…");
        const audioPath = `audio/${user.uid}/${bookId}/${upAudioFile.name}`;
        await uploadBytes(ref(storage, audioPath), upAudioFile);

        await setDoc(
          bookRef,
          {
            audio_storage_path: audioPath,
            audio_source: "upload",
            updatedAt: serverTimestamp(),

          },
          { merge: true }
        );
      }

      setUpStatus("Saved ✓");
      setModalOpen(false);
      resetUploadForm();
    } catch (e) {
      setUpStatus("Upload failed: " + e.message);
    }
  };

  // gutenberg search
  const searchGutenberg = async () => {
    setSearchStatus("");
    setResults([]);

    if (!q.trim()) {
      setSearchStatus("Enter a search term.");
      return;
    }

    try {
      setSearchStatus("Searching Gutenberg…");
      const res = await fetch(
        `https://gutendex.com/books/?search=${encodeURIComponent(q.trim())}`
      );
      const data = await res.json();
      const raw = data?.results || [];

      if (!raw.length) {
        setSearchStatus("No results found.");
        return;
      }

      const mapped = raw.slice(0, 10).map((b) => ({
        gutenberg_id: b.id,
        title: b.title,
        author: b.authors?.[0]?.name || "Unknown",
        epub_link: epubFromGutendex(b.formats),
        cover_url: coverFromGutendex(b.formats),
        epub_preview_url: `https://www.gutenberg.org/ebooks/${b.id}`,
      }));

      setResults(mapped);
      setSearchStatus(`Found ${mapped.length} result(s).`);
    } catch (e) {
      setSearchStatus("Search failed: " + e.message);
    }
  };
  const prepareLibrivoxAudio = async (bookId) => {
    try {
      const res = await fetch(`${AUDIO_SERVICE_BASE_URL}/prepare-librivox-audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          uid: user.uid,
          bookId
        })
      });
  
      const data = await res.json();
      console.log("prepare-librivox-audio:", data);
  
      if (!res.ok) {
        throw new Error(data.error || "Failed to prepare LibriVox audio.");
      }

      return data;
    } catch (e) {
      console.error("prepareLibrivoxAudio fetch error:", e);
      alert("Could not reach LibriVox audio processor: " + e.message);
      throw e;
    }
  };

  // GENERATE AUDIO
  const generateAudiobook = async (bookId) => {
    try {
      const res = await fetch(`${AUDIO_SERVICE_BASE_URL}/generate-audio`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          uid: user.uid,
          bookId
        })
      });
  
      const data = await res.json();
      console.log("generate-audio status:", res.status);
      console.log("generate-audio data:", data);
  
      if (!res.ok) {
        alert(data.error || "Audio generation failed.");
        return;
      }
  
      alert(`Audiobook generated with ${data.voice || "selected voice"}.`);
    } catch (e) {
      console.error("generateAudiobook error:", e);
      alert("Could not reach audio generator: " + e.message);
    }
  };
  
  const updateBookVoice = async (bookId, voice) => {
    await setDoc(
      doc(db, "Users", user.uid, "Books", bookId),
      {
        generated_audio_voice: voice,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };
  
  const addEpub = async (book) => {
    const id = generateBookId(book.title);

    await setDoc(
        doc(db, "Users", user.uid, "Books", id),
        {
          title: book.title,
          author: book.author,
          cover_url: book.cover_url || "",
          epub_link: book.epub_link,
          epub_preview_url: book.epub_preview_url || "",
          generated_audio_status: "idle",
          generated_audio_progress: 0,
          generated_audio_current: 0,
          generated_audio_total: 0,
          generated_audio_tracks: [],
          generated_audio_error: null,
          generated_audio_voice: selectedVoice,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
  };

  const findAudio = async (title) => {
    const res = await fetch(
      `${SCRAPER_BASE_URL}/scrape-audio?title=${encodeURIComponent(title)}`
    );
    return await res.json();
  };
  const searchEditLibrivox = async () => {
    if (!editAudioSearch.trim()) {
      setEditAudioSearchStatus("Enter a title to search.");
      return;
    }

    try {
      setEditAudioSearchStatus("Searching LibriVox...");
      setEditFoundAudioLink("");
      setEditPendingLibrivoxLink("");

      const audio = await findAudio(editAudioSearch.trim());

      if (audio.status === "success" && audio.audio_url) {
        setEditFoundAudioLink(audio.audio_url);
        setEditAudioSearchStatus("Audio found ✓");
      } else {
        setEditAudioSearchStatus("No audio found.");
      }
    } catch (e) {
      setEditAudioSearchStatus("Audio search failed: " + e.message);
    }
  };

  const addAudio = async (book, audioUrl) => {
    const id = generateBookId(book.title);

    await setDoc(
      getBookDocRef(user.uid, id),
      {
        title: book.title,
        author: book.author,
        cover_url: book.cover_url || "",
        audio_link: audioUrl,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const addBoth = async (book, setRowStatus) => {
    try {
      const bookId = generateBookId(book.title);
  
      setRowStatus("Adding EPUB…");
      if (book.epub_link) {
        await addEpub(book);
      }
  
      setRowStatus("Searching audio…");
      const audio = await findAudio(book.title);
  
      if (!(audio.status === "success" && audio.audio_url)) {
        setRowStatus("Done ✓ (EPUB only, no audio found)");
        return;
      }
  
      setRowStatus("Saving audio link…");
      await addAudio(book, audio.audio_url);
  
      setRowStatus("Preparing LibriVox audio…");
      await prepareLibrivoxAudio(bookId);
  
      setRowStatus("Done ✓ (EPUB + Audio)");
    } catch (e) {
      setRowStatus("Failed: " + e.message);
    }
  };

  const gridConfig = GRID_CONFIGS[gridSize];

  return (
    <div
      style={{
        background: THEME.canvas,
        minHeight: "100vh",
        color: THEME.ink,
        fontFamily: FONTS.ui,
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 40px" }}>
        {/* header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: 22, color: THEME.ink, fontFamily: FONTS.ui }}>
              Bookcover
            </h1>
            <p style={{ margin: "4px 0 0", color: THEME.mutedInk, fontSize: 13, fontFamily: FONTS.ui }}>
              Your personal bookshelf
            </p>          

            
          </div>

          <HeaderActions
            user={user}
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            onLogout={logout}
            theme={THEME}
          />
        </div>
        
        <div style={{ margin: "18px 0 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}> 
          <h2 style={{ margin: 0, fontSize: 18, color: THEME.ink, fontFamily: FONTS.headings }}>
            My Bookshelf
          </h2>
          <p style={{ margin: "6px 0 0", color: COLORS.mutedInk, fontSize: 13, fontFamily: FONTS.ui }}>
          </p>
        </div>
        {/* grid layout size picker */}
        <div style={{ display: "flex", width: "100%", boxSizing: "border-box", gap: 6, background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18, 38, 48, 0.06)", padding: 4, borderRadius: 10 }}>
          {["small", "medium", "large"].map((size) => (
            <button
              key={size}
              onClick={() => setGridSize(size)}
              onMouseEnter={() => setHoveredSize(size)}
              onMouseLeave={() => setHoveredSize(null)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                borderRadius: 999,
                cursor: "pointer",
                border: gridSize === size
                  ? "1px solid rgba(242, 201, 76, 0.55)"
                  : "1px solid transparent",
                background: gridSize === size
                  ? (darkMode ? COLORS.status : COLORS.frame)
                  : hoveredSize === size
                    ? darkMode ? "rgba(255,255,255,0.1)" : "rgba(18,38,48,0.08)"
                    : "transparent",
                color: gridSize === size
                  ? (darkMode ? COLORS.ink : COLORS.white)
                  : THEME.ink,
                fontWeight: gridSize === size ? "700" : "400",
                boxShadow: gridSize === size
                  ? "0 0 0 1px rgba(242, 201, 76, 0.18)"
                  : hoveredSize === size
                    ? "0 8px 20px rgba(26, 75, 93, 0.4)"
                    : "none",
                transition: "all 0.3s ease",
                transform: hoveredSize === size && gridSize !== size ? "translateY(-3px)" : "translateY(0)",
                fontFamily: FONTS.ui,
              }}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>
        {/* sort by ... */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0" }}>
          <span style={{ fontSize: 13, color: COLORS.mutedInk, fontFamily: FONTS.ui }}>Sort by:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              background: THEME.white,
              color: THEME.ink,
              fontFamily: FONTS.ui,
              fontSize: 13,
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="recent">Recently Added</option>
            <option value="title-asc">Title (A → Z)</option>
            <option value="title-desc">Title (Z → A)</option>
            <option value="author-asc">Author (A → Z)</option>
            <option value="author-desc">Author (Z → A)</option>
            <option value="epub">EPUB only</option>
            <option value="audio">Audio only</option>
          </select>
        </div>
        {/* book grid */}
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: `repeat(auto-fill, ${GRID_CONFIGS[gridSize].width}px)`, 
          gap: GRID_CONFIGS[gridSize].gap,
          justifyContent: "center" 
        }}>
          <AddTile
            size={gridSize}
            darkMode={darkMode}
            onClick={() => {
              setTab("upload");
              setModalOpen(true);
            }}
          />
        
        {sortedBooks.map((b) => (
            <BookTile
            key={b.id}
            size={gridSize}
            book={b}
            onGenerateAudiobook={generateAudiobook}
            onPrepareLibrivoxAudio={prepareLibrivoxAudio}
            onEdit={openEditModal}
            onDelete={deleteBook}
            onOpenAudio={() => openAudioModal(b)}
            onOpenSync={() => openSyncModal(b)}
            onUpdateVoice={updateBookVoice}
            darkMode={darkMode}
          />
            ))}
        </div>
        {/* Add book modal */}
        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add a new book">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
              Manual upload
            </TabButton>
            <TabButton active={tab === "search"} onClick={() => setTab("search")}>
              Search
            </TabButton>
          </div>

          {tab === "upload" && (
            <div>
              <Row>
                <Field label="Book title">
                  <input
                    style={inputStyle}
                    value={upTitle}
                    onChange={(e) => setUpTitle(e.target.value)}
                    placeholder="e.g., Pride and Prejudice"
                  />
                </Field>
                <Field label="Author">
                  <input
                    style={inputStyle}
                    value={upAuthor}
                    onChange={(e) => setUpAuthor(e.target.value)}
                    placeholder="e.g., Jane Austen"
                  />
                </Field>
                <Field label="Audio file (mp3/zip/m4b)">
                  <input
                    style={inputStyle}
                    type="file"
                    accept=".mp3,.zip,.m4b,.m4a,.ogg,.wav"
                    onChange={(e) => setUpAudioFile(e.target.files?.[0] || null)}
                  />
                </Field>
              </Row>

              <Field label="EPUB file">
                <input
                  style={inputStyle}
                  type="file"
                  accept=".epub"
                  onChange={(e) => setUpFile(e.target.files?.[0] || null)}
                />
              </Field>

              <button 
                onClick={uploadManualFiles} 
                onMouseEnter={() => setIsUploadHovered(true)}
                onMouseLeave={() => setIsUploadHovered(false)}
                style={{ 
                  ...btnWide, 
                  background: COLORS.frame, 
                  cursor: "pointer",
                  border: "none",
                  color: "#FFFFFF",
                  // --- HOVER LOGIC ---
                  transition: "all 0.3s ease",
                  transform: isUploadHovered ? "translateY(-4px)" : "translateY(0)",
                  boxShadow: isUploadHovered 
                    ? `0 10px 25px rgba(26, 75, 93, 0.35)` // Crimson Shadow
                    : "none",
                  }}
              >
                Upload EPUB / Audiobook
              </button>
              {upStatus && (
                <p
                style={{
                  marginTop: 12,
                  color: upStatus.startsWith("Upload failed") ? COLORS.accent : COLORS.mutedInk,
                  fontSize: 13,
                  fontFamily: FONTS.ui,
                }}
              >
                {upStatus}
                </p>
              )}
            </div>
          )}

          {tab === "search" && (
            <div>
              <Field label="Search Gutenberg (covers included)">
                <input
                  style={inputStyle}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by title, author…"
                />
              </Field>
              <button 
                onClick={searchGutenberg} 
                onMouseEnter={() => setIsSearchHovered(true)}
                onMouseLeave={() => setIsSearchHovered(false)}
                style={{ 
                  ...btnWide,
                  background: COLORS.frame,
                  cursor: "pointer",
                  border: "none",
                  color: "#FFFFFF",
                  // --- HOVER LOGIC ---
                  transition: "all 0.3s ease",
                  transform: isSearchHovered ? "translateY(-4px)" : "translateY(0)",
                  boxShadow: isSearchHovered 
                    ? `0 10px 25px rgba(26, 75, 93, 0.35)` // Navy Shadow
                    : "none", 
                }}
              >
                Search
              </button>
              {searchStatus && (
                <p
                  style={{
                    marginTop: 12,
                    color: searchStatus.includes("failed") ? COLORS.accent : COLORS.mutedInk,
                    fontSize: 13,
                    fontFamily: FONTS.ui,
                  }}
                >
                  {searchStatus}
                </p>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
                  gap: 12,
                  marginTop: 12,
                }}
              >
                {results.map((r) => (
                  <SearchResultCard
                    key={r.gutenberg_id}
                    book={r}
                    onAddEpub={() => addEpub(r)}
                    onFindAudio={() => findAudio(r.title)}
                    onAddAudio={(audioUrl) => addAudio(r, audioUrl)}
                    onAddBoth={(setRowStatus, audioUrl) => addBoth(r, setRowStatus, audioUrl)}
                  />
                ))}
              </div>
            </div>
          )}
        </Modal>
        {/* EDIT BOOK MODAL */}
        <Modal open={editOpen} onClose={closeEditModal} title="Edit book">
          <div>
            <Row>
              <Field label="Book title">
                <input
                  style={inputStyle}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Book title"
                />
              </Field>

              <Field label="Author">
                <input
                  style={inputStyle}
                  value={editAuthor}
                  onChange={(e) => setEditAuthor(e.target.value)}
                  placeholder="Author"
                />
              </Field>
            </Row>

            <Field label="EPUB file">
              
                <input
                  style={inputStyle}
                  type="file"
                  accept=".epub"
                  onChange={(e) => setEditEpubFile(e.target.files?.[0] || null)}
                />
            </Field>

            <Field label="Audio source">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <TabButton active={editAudioMode === "upload"} onClick={() => setEditAudioMode("upload")}>
                  Upload file
                </TabButton>
                <TabButton active={editAudioMode === "librivox"} onClick={() => setEditAudioMode("librivox")}>
                  Search LibriVox
                </TabButton>
              </div>

              {editAudioMode === "upload" ? (
                <input
                  style={inputStyle}
                  type="file"
                  accept=".mp3,.zip,.m4b,.m4a,.ogg,.wav"
                  onChange={(e) => setEditAudioFile(e.target.files?.[0] || null)}
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    style={inputStyle}
                    value={editAudioSearch}
                    onChange={(e) => setEditAudioSearch(e.target.value)}
                    placeholder="Search LibriVox by title..."
                  />

                  <button
                    onClick={searchEditLibrivox}
                    style={{
                      ...btnWide,
                      marginTop: 0,
                      background: COLORS.frame,
                      color: COLORS.white,
                      border: "none",
                    }}
                  >
                    Find Audio
                  </button>

                  {editAudioSearchStatus && (
                    <div style={{ fontSize: 13, color: COLORS.mutedInk }}>
                      {editAudioSearchStatus}
                    </div>
                  )}

                  {editFoundAudioLink && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <a
                          href={editFoundAudioLink}
                          target="_blank"
                          rel="noreferrer"
                          style={miniPreview}
                        >
                          Preview Audio
                        </a>

                        <button
                          type="button"
                          onClick={() => {
                            setEditPendingLibrivoxLink(editFoundAudioLink);
                            setEditAudioSearchStatus(
                              editBook?.audio_link || editBook?.audio_storage_path
                                ? "Replacement audio selected ✓"
                                : "Audio selected ✓"
                            );
                          }}
                          style={miniBtn(COLORS.frame, "white")}
                        >
                          {editBook?.audio_link || editBook?.audio_storage_path
                            ? "Replace Audio"
                            : "Add Audio"}
                        </button>
                      </div>

                      {editPendingLibrivoxLink && (
                        <div style={{ fontSize: 13, color: "#16a34a" }}>
                          LibriVox audio selected. Press Save Changes to attach it to this book ✓
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Field>

            <HoverButton 
              onClick={saveEditedBook} 
              onMouseEnter={() => setIsSaveHovered(true)}
              onMouseLeave={() => setIsSaveHovered(false)}
              style={{ 
                ...btnWide, 
                background: COLORS.frame,
                color: COLORS.white,
                border: "none",
                transition: "all 0.3s ease",
                transform: isSaveHovered ? "translateY(-3px)" : "translateY(0)",
                boxShadow: isSaveHovered
                  ? "0 8px 20px rgba(26, 75, 93, 0.4)"
                  : "0 2px 8px rgba(18, 38, 48, 0.08)",

              }}
            >
              Save Changes
            </HoverButton>

            {editStatus && (
              <p
                style={{
                  marginTop: 10,
                  color: editStatus.startsWith("Edit failed") ? "#b91c1c" : "#6b7280",
                  fontSize: 13,
                }}
              >
                {editStatus}
              </p>
            )}
          </div>
        </Modal>
        {/* AUDIO MODAL */}
        <Modal open={audioOpen} onClose={closeAudioModal} title="Audio Settings">
          {audioBook && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 800, color: THEME.mutedInk, textTransform: "uppercase", marginBottom: 8, display: "block" }}>
                  Current Audio File
                </label>
                <div style={{ ...inputStyle, background: "rgba(18, 38, 48, 0.03)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>
                    {audioBook.audio_storage_path?.split('/').pop() || audioBook.audio_link?.split('/').pop() || "No audio file"}
                  </span>
                  <button onClick={() => { closeAudioModal(); openEditModal(audioBook); }} style={{ background: COLORS.frame, color: 'white', border: 'none', padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>
                    Replace
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 800, color: THEME.mutedInk, textTransform: "uppercase", marginBottom: 8, display: "block" }}>
                  AI Voice Selection
                </label>
                <div style={{ display: "grid", gap: 8 }}>
                  {AUDIO_VOICES.map((v) => (
                    <div 
                      key={v.value}
                      onClick={() => setSelectedVoiceLocal(v.value)}
                      style={{
                        padding: "12px",
                        borderRadius: 12,
                        border: `2px solid ${selectedVoiceLocal === v.value ? COLORS.frame : COLORS.border}`,
                        background: selectedVoiceLocal === v.value ? "rgba(26, 75, 93, 0.05)" : "white",
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between"
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{v.label}</span>
                      {selectedVoiceLocal === v.value && <span>✓</span>}
                    </div>
                  ))}
                </div>
              </div>

              <button 
                style={{ 
                    ...btnWide, 
                    background: COLORS.frame,
                    transition: "all 0.3s ease",
                    transform: isGenerateHovered ? "translateY(-4px)" : "translateY(0)",
                    boxShadow: isGenerateHovered 
                    ? `0 10px 25px rgba(26, 75, 93, 0.35)` 
                    : "none", 
                }}
                onMouseEnter={() => setIsGenerateHovered(true)}
                onMouseLeave={() => setIsGenerateHovered(false)}
                onClick={async () => {
                  try {
                    const bookId = audioBook.id;
                    const voice = selectedVoiceLocal;

                    closeAudioModal();

                    // 🔥 CLEAR LIBRIVOX BEFORE GENERATING
                    await setDoc(
                      doc(db, "Users", user.uid, "Books", bookId),
                      {
                        generated_audio_voice: voice,

                        // remove librivox
                        audio_link: null,
                        audio_storage_path: null,
                        audio_source: "generated",
                        librivox_audio_tracks: [],
                        librivox_audio_status: "idle",
                        librivox_audio_progress: 0,
                        librivox_audio_current: 0,
                        librivox_audio_total: 0,
                        librivox_audio_error: null,

                        // reset generated audio
                        generated_audio_tracks: [],
                        generated_audio_status: "running",
                        generated_audio_progress: 0,
                        generated_audio_current: 0,
                        generated_audio_total: 0,
                        generated_audio_error: null,

                        updatedAt: serverTimestamp(),
                      },
                      { merge: true }
                    );

                    await generateAudiobook(bookId);
                  } catch (e) {
                    console.error("Generate audiobook failed:", e);
                    alert("Failed to generate audiobook: " + e.message);
                  }
                }}
                >
                Generate Audiobook
                </button>
            </div>
          )}
        </Modal>
        {/* SYNC MODAL */}
        <Modal open={syncOpen} onClose={closeSyncModal} title="Sync">
          {syncBook && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              
              {/* Current Text File Info */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 800, color: THEME.mutedInk, textTransform: "uppercase", marginBottom: 8, display: "block" }}>
                  Current Text File
                </label>
                <div style={{ ...inputStyle, background: "rgba(18, 38, 48, 0.03)", fontSize: 14 }}>
                  {syncBook.title ? `${syncBook.title}.epub` : "No EPUB file"}
                </div>
              </div>

              {/* Selecting Audio Source To Sync */}
              <div>
                <label style={{ fontSize: 12, fontWeight: 800, color: THEME.mutedInk, textTransform: "uppercase", marginBottom: 8, display: "block" }}>
                  Select Audio Source to Sync
                </label>
                <div style={{ display: "grid", gap: 8 }}>
                  
                  {/* Default Audio Option */}
                  <div 
                    onClick={() => setSyncSelection("default")}
                    style={{
                      padding: "12px",
                      borderRadius: 12,
                      border: `2px solid ${syncSelection === "default" ? COLORS.frame : COLORS.border}`,
                      background: syncSelection === "default" ? "rgba(26, 75, 93, 0.05)" : "white",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Default Audio</div>
                      <div style={{ fontSize: 12, color: COLORS.mutedInk }}>
                        {syncBook.audio_storage_path?.split('/').pop() || syncBook.audio_link?.split('/').pop() || "Not uploaded"}
                      </div>
                    </div>
                    {syncSelection === "default" && <span style={{ color: COLORS.frame, fontWeight: 900 }}>✓</span>}
                  </div>

                  {/* Generated Audio Option */}
                  <div 
                    onClick={() => setSyncSelection("generated")}
                    style={{
                      padding: "12px",
                      borderRadius: 12,
                      border: `2px solid ${syncSelection === "generated" ? COLORS.frame : COLORS.border}`,
                      background: syncSelection === "generated" ? "rgba(26, 75, 93, 0.05)" : "white",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      // Optional: Disable if no generated audio exists
                      opacity: syncBook.generated_audio_tracks?.length > 0 ? 1 : 0.6,
                      pointerEvents: syncBook.generated_audio_tracks?.length > 0 ? "auto" : "none"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>Generated AI Audio</div>
                      <div style={{ fontSize: 12, color: COLORS.mutedInk }}>
                        {syncBook.generated_audio_tracks?.length > 0 
                          ? `Voice: ${getVoiceLabel(syncBook.generated_audio_voice)}` 
                          : "No AI audio generated"}
                      </div>
                    </div>
                    {syncSelection === "generated" && <span style={{ color: COLORS.frame, fontWeight: 900 }}>✓</span>}
                  </div>

                </div>
              </div>

              {/* Sync Button */}
              <button 
                style={{ 
                  ...btnWide, 
                  background: COLORS.frame,
                  transition: "all 0.3s ease",
                  transform: isSyncHovered ? "translateY(-4px)" : "translateY(0)",
                  boxShadow: isSyncHovered 
                    ? `0 10px 25px rgba(26, 75, 93, 0.35)` 
                    : "none", 
                }}
                onMouseEnter={() => setIsSyncHovered(true)}
                onMouseLeave={() => setIsSyncHovered(false)}
                onClick={() => {
                  console.log(`Syncing ${syncSelection} for:`, syncBook.title);
                  closeSyncModal();
                }}
              >
                Sync
              </button>
            </div>
          )}
        </Modal>

      </div>
      {/* FOOTER */}
      <div style={{
        textAlign: "center",
        padding: "20px 0 32px",
        fontFamily: FONTS.ui,
        fontSize: 12,
        color: THEME.mutedInk, // Used THEME.mutedInk so it works in Dark Mode!
      }}>
        <a 
          href="/terms"
          style={{
            color: THEME.frame,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Terms of Use
        </a>
        {" · "}
        <span>{new Date().getFullYear()} Bookcover</span>
      </div>

    </div>
  );
}

// Sub-componentes
function HeaderActions({ user, darkMode, setDarkMode, onLogout, theme }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: theme.white,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "10px 12px",
        boxShadow: "0 4px 14px rgba(18,38,48,0.08)",
        fontFamily: FONTS.ui,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: theme.mutedInk,
          maxWidth: 280,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: FONTS.ui,
        }}
      >
        {user.email}
      </span>
      {/* logout icon */}
      <HoverButton
        onClick={onLogout}
        baseStyle={{
          background: COLORS.frame,
          color: COLORS.white,
          fontFamily: FONTS.ui,
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 2,
          border: "none",
          borderRadius: 12,
          width: 42,
          height: 42,
          padding: 0,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </HoverButton>

      <HoverButton
        onClick={() => setDarkMode((d) => !d)}
        baseStyle={{
          background: darkMode ? COLORS.status : COLORS.ink,
          color: darkMode ? COLORS.ink : COLORS.white,
          border: "none",
          borderRadius: 12,
          height: 42,
          padding: "0 14px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          cursor: "pointer",
          fontFamily: FONTS.ui,
          fontWeight: 600,
          fontSize: 13,
        }}
        hoverShadow={
          darkMode
            ? "0 8px 20px rgba(242, 201, 76, 0.5)"
            : "0 8px 20px rgba(26, 75, 93, 0.4)"
        }
      >
        {darkMode ? "☀ Light" : "☾ Dark"}
      </HoverButton>
    </div>
  );
}

/*function UploadTab({
  upTitle,
  setUpTitle,
  upAuthor,
  setUpAuthor,
  setUpAudioFile,
  setUpFile,
  uploadManualFiles,
  upStatus,
}) {
  return (
    <div>
      <Row>
        <Field label="Book title">
          <input
            style={inputStyle}
            value={upTitle}
            onChange={(e) => setUpTitle(e.target.value)}
            placeholder="e.g., Pride and Prejudice"
          />
        </Field>

        <Field label="Author">
          <input
            style={inputStyle}
            value={upAuthor}
            onChange={(e) => setUpAuthor(e.target.value)}
            placeholder="e.g., Jane Austen"
          />
        </Field>

        <Field label="Audio file (mp3/zip/m4b)">
          <input
            style={inputStyle}
            type="file"
            accept=".mp3,.zip,.m4b,.m4a,.ogg,.wav"
            onChange={(e) => setUpAudioFile(e.target.files?.[0] || null)}
          />
        </Field>
      </Row>

      <Field label="EPUB file">
        <input
          style={inputStyle}
          type="file"
          accept=".epub"
          onChange={(e) => setUpFile(e.target.files?.[0] || null)}
        />
      </Field>

      <HoverButton
        onClick={uploadManualFiles}
        baseStyle={{
          ...btnWide,
          background: COLORS.frame,
          cursor: "pointer",
          border: "none",
          color: "#FFFFFF",
        }}
        hoverShadow="0 10px 25px rgba(26, 75, 93, 0.35)"
      >
        Upload EPUB / Audiobook
      </HoverButton>

      {upStatus && (
        <p
          style={{
            marginTop: 12,
            color: upStatus.startsWith("Upload failed") ? COLORS.accent : COLORS.mutedInk,
            fontSize: 13,
            fontFamily: FONTS.ui,
          }}
        >
          {upStatus}
        </p>
      )}
    </div>
  );
}

function SearchTab({
  q,
  setQ,
  searchStatus,
  searchGutenberg,
  results,
  addEpub,
  findAudio,
  addAudio,
  addBoth,
}) {
  return (
    <div>
      <Field label="Search Gutenberg (covers included)">
        <input
          style={inputStyle}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title, author…"
        />
      </Field>

      <HoverButton
        onClick={searchGutenberg}
        baseStyle={{
          ...btnWide,
          background: COLORS.frame,
          cursor: "pointer",
          border: "none",
          color: "#FFFFFF",
        }}
        hoverShadow="0 10px 25px rgba(26, 75, 93, 0.35)"
      >
        Search
      </HoverButton>

      {searchStatus && (
        <p
          style={{
            marginTop: 12,
            color: searchStatus.includes("failed") ? COLORS.accent : COLORS.mutedInk,
            fontSize: 13,
            fontFamily: FONTS.ui,
          }}
        >
          {searchStatus}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        {results.map((r) => (
          <SearchResultCard
            key={r.gutenberg_id}
            book={r}
            onAddEpub={() => addEpub(r)}
            onFindAudio={() => findAudio(r.title)}
            onAddAudio={(audioUrl) => addAudio(r, audioUrl)}
            onAddBoth={(setRowStatus) => addBoth(r, setRowStatus)}
          />
        ))}
      </div>
    </div>
  );
}*/

// Generic lift-on-hover button — keeps hover logic out of call sites
function HoverButton({ onClick, children, baseStyle, style, hoverShadow }) {
  const [isHovered, setIsHovered] = useState(false);
  const getHoverLiftStyle = (hovered) => ({
    transform: hovered ? "translateY(-4px)" : "translateY(0)",
    transition: "all 0.2s ease",
    boxShadow: hovered
      ? hoverShadow || "0 8px 20px rgba(26, 75, 93, 0.4)"
      : (style?.boxShadow || baseStyle?.boxShadow),
  });

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...baseStyle,
        ...style,
        ...getHoverLiftStyle(isHovered, hoverShadow),
      }}
    >
      {children}
    </button>
  );
}
// function to add a nex book to the bookshelf
function AddTile({ onClick, size, darkMode }) {
  const [isHovered, setIsHovered] = useState(false);
  const config = GRID_CONFIGS[size];

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}  
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: config.width, //"160px",
        //height: "335px",
        cursor: "pointer",
        transition: "transform 0.3s ease", 
        transform: isHovered ? "translateY(-4px)" : "translateY(0)",

      }}
    >
      {/* dashed "add" box */}
      <div style={{
        width: config.width, //"160px",
        height: config.height, //"240px",
        //aspectRatio: "2 / 3",
        background: darkMode ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.28)",
        border: isHovered 
          ? darkMode ? `2px solid ${COLORS.status}` : `2px solid ${COLORS.frame}`
          : darkMode ? "2px dashed rgba(232,232,240,0.25)" : `2px dashed ${COLORS.border}`,
        borderRadius: 8, 
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.3s ease, box-shadow 0.3s ease",
        boxShadow: isHovered ? `0 20px 40px rgba(26, 75, 93, 0.12)` : "none",
        //position: "relative",
      }}> 
          <div
            style={{
              width: size === "small" ? 40 : 58, //58, 
              height: size === "small" ? 40 : 58, //58, 
              borderRadius: "50%", //999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: size === "small" ? 24 : 34, //34,
              // dynamic colors
              background: isHovered ? (darkMode ? COLORS.status : COLORS.frame) : darkMode ? "rgba(255,255,255,0.08)" : "rgba(18, 38, 48, 0.05)",
              border: `2px solid ${isHovered ? (darkMode ? COLORS.status : COLORS.frame) : (darkMode ? "#e8e8f0" : COLORS.ink)}`,
              color: isHovered ? (darkMode ? COLORS.ink : "#FFFFFF") : (darkMode ? "#e8e8f0" : COLORS.ink), 
              
              // THE ANIMATION:
              transition: "all 0.3s ease",
            }}
          >
            <span style={{ marginTop: "-4px" }}>+</span>
          </div>
        </div>

        <div style={{ 
          //height: "85px", 
          textAlign: "left", 
        }}>
        <b style={{ 
          fontSize: config.fontSize, // 14, 
          fontFamily: FONTS.ui, 
          transition: "color 0.3s ease",
          color: isHovered ? (darkMode ? COLORS.status : COLORS.frame) : (darkMode ? "#e8e8f0" : COLORS.ink) }}>
            Add new book
        </b>
        {size !== "small" && (
          <div style={{ fontSize: 12, color: darkMode ? "rgba(232,232,240,0.55)" : COLORS.mutedInk, fontFamily: FONTS.ui }}>
            Upload or search
          </div>
        )}
      </div>
    </div>
  );
}

function BookTile({
    book,
    onEdit,
    onDelete,
    onGenerateAudiobook,
    onPrepareLibrivoxAudio,
    onOpenAudio,
    onOpenSync,
    onUpdateVoice,
    size,
    darkMode,
  }) {
    const navigate = useNavigate();
    const config = GRID_CONFIGS[size] || GRID_CONFIGS["medium"];
    const inkColor = darkMode ? "#e8e8f0" : COLORS.ink;
    const mutedColor = darkMode ? "rgba(232,232,240,0.65)" : "#6b7280";
  
    const hasEpub = !!book.epub_link || !!book.epub_storage_path;
    const hasAudio =
      !!book.audio_link ||
      !!book.audio_storage_path ||
      (Array.isArray(book.librivox_audio_tracks) && book.librivox_audio_tracks.length > 0);
    const hasGeneratedAudio =
      Array.isArray(book.generated_audio_tracks) &&
      book.generated_audio_tracks.length > 0;
  
    const isGenerating = book.generated_audio_status === "running";
    const isReady = book.generated_audio_status === "ready" && hasGeneratedAudio;
    const isError = book.generated_audio_status === "error";
    const isLibrivoxGenerating = book.librivox_audio_status === "running";
    const isLibrivoxReady =
      book.librivox_audio_status === "ready" &&
      Array.isArray(book.librivox_audio_tracks) &&
      book.librivox_audio_tracks.length > 0;
    const isLibrivoxError = book.librivox_audio_status === "error";

    const librivoxProgress = book.librivox_audio_progress || 0;
    const librivoxCurrent = book.librivox_audio_current || 0;
    const librivoxTotal = book.librivox_audio_total || 0;
  
    const generationProgress = book.generated_audio_progress || 0;
    const generationCurrent = book.generated_audio_current || 0;
    const generationTotal = book.generated_audio_total || 0;
    // label for the top-left badge on the cover
    const badgeText =
      hasEpub && (hasAudio || hasGeneratedAudio)
        ? "EPUB + Audio"
        : hasEpub
        ? "EPUB"
        : hasAudio || hasGeneratedAudio
        ? "Audio"
        : "Book";
  
    // book size for each grid layout (small, medium, large)
    const btnSize = {
      small:  { fontSize: 9,  padding: "3px 6px",  borderRadius: 6,  gap: 3 },
      medium: { fontSize: 11, padding: "6px 10px", borderRadius: 8,  gap: 5 },
      large:  { fontSize: 13, padding: "8px 13px", borderRadius: 10, gap: 7 },
    }[size] || { fontSize: 11, padding: "6px 10px", borderRadius: 8, gap: 5 };

    const actionButtonStyle = {
      background: COLORS.frame,
      color: COLORS.white,
      border: "1px solid transparent",
      fontWeight: 700,
      fontFamily: FONTS.ui,
      fontSize: btnSize.fontSize,
      padding: btnSize.padding,
      borderRadius: 999,
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(18,38,48,0.08)",
      transition: "all 0.3s ease",
    };
  
    const deleteButtonStyle = {
      ...actionButtonStyle,
      background: COLORS.accent,
      color: COLORS.white,
      border: "1px solid transparent",
    };

    const disabledButtonStyle = {
      ...actionButtonStyle,
      background: "rgba(18,38,48,0.15)",
      color: "rgba(18,38,48,0.4)",
      boxShadow: "none",
    };
  
    const [hoveredBtn, setHoveredBtn] = useState(null);
    //const [activePanel, setActivePanel] = useState(null); // "audio" | "sync" | null
    const [selectedVoiceLocal, setSelectedVoiceLocal] = useState(
      book.generated_audio_voice || "en-US-GuyNeural"
    );
    // lift + shadow effect for a given button id
    const hoverStyle = (id) => ({
      //boxShadow: hoveredBtn === id ? "0 8px 20px rgba(26, 75, 93, 0.4)" : "none",
      transform: hoveredBtn === id ? "translateY(-3px)" : "translateY(0)",
      boxShadow: hoveredBtn === id
        ? id === "delete"
          ? "0 8px 20px rgba(142,36,36,0.4)"
          : "0 8px 20px rgba(26,75,93,0.4)"
        : "0 2px 8px rgba(18,38,48,0.08)",
    });
    // if the button has a cover image, use it as a background image, otherwise show a gradient pinkish bacgroudn
    const coverStyle = book.cover_url
      ? {
          backgroundImage: `url('${book.cover_url}')`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }
      : {
          background:
            "linear-gradient(160deg, rgb(194, 211, 236) 0%, rgb(215, 232, 228) 55%, rgb(184, 204, 230) 100%)",
        };

    /*const sectionLabelStyle = {
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: darkMode ? "rgba(232,232,240,0.5)" : COLORS.mutedInk,  // ← uses mutedInk
      fontFamily: FONTS.ui,
      marginBottom: 4,
    };

    const radioOptionStyle = {
      display: "flex",
      alignItems: "center",
      gap: 7,
      padding: "6px 8px",
      borderRadius: 8,
      cursor: "pointer",
      border: `1px solid ${COLORS.border}`,
      background: darkMode ? "rgba(255,255,255,0.05)" : "rgba(18,38,48,0.04)",
      marginBottom: 4,
      fontFamily: FONTS.ui,
      fontSize: btnSize.fontSize,
      color: darkMode ? "#f9fafb" : COLORS.ink,
      transition: "background 0.15s ease",
    };


    const audioFileName =
      book.audio_storage_path
        ? book.audio_storage_path.split("/").pop()
        : book.audio_link
        ? book.audio_link.split("/").pop()
        : null;

    const epubFileName =
      book.epub_storage_path
        ? book.epub_storage_path.split("/").pop()
        : book.epub_link
        ? book.epub_link.split("/").pop()
        : null;*/

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* cover of the book */}
        <div
          style={{
            position: "relative",
            width: config.width,
            height: config.height,
            borderRadius: "2px 8px 8px 2px",
            overflow: "hidden",
            boxShadow: "6px 8px 15px rgba(0,0,0,0.3), -1px 0 2px rgba(0,0,0,0.1)",
            cursor: "pointer",
            transition: "transform 0.18s ease, box-shadow 0.18s ease",
            ...coverStyle,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          onClick={() => hasEpub && navigate(`/reader/${book.id}`)}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "translateY(-8px)";
            e.currentTarget.style.boxShadow = "0 20px 40px rgba(18,38,48,0.35), 0 8px 16px rgba(18,38,48,0.2)";
            // directly toggles the overlay opacity using the DOM
            const overlay = e.currentTarget.querySelector(".book-hover-overlay");
            if (overlay) overlay.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow = "6px 8px 15px rgba(0,0,0,0.3), -1px 0 2px rgba(0,0,0,0.1)";
            const overlay = e.currentTarget.querySelector(".book-hover-overlay");
            if (overlay) overlay.style.opacity = "0";
            //setActivePanel(null);
          }}
        >
          {/* Badge that indicates if there's only EPUB/Audio/EPUB+Audio */}
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.02em",
              background: "rgba(255,255,255,0.82)",
              color: COLORS.ink,
              padding: "5px 8px",
              borderRadius: 999,
              border: "1px solid rgba(17,24,39,0.08)",
              zIndex: 2,
            }}
          >
            {badgeText}
          </div>
          
          {/* Hover overlay that fades in over the cover and shows the action buttons. stopPropagation on the overlay prevents clicking a button from also triggering
            the cover's onClick (which would navigate to the reader). */}
          <div
            className="book-hover-overlay"
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              transition: "opacity 0.18s ease",
              background: "linear-gradient(to top, rgba(249,234,234,0.97) 55%, rgba(249,234,234,0.5) 100%)", //"rgba(255, 255, 255, 0.1)",
              /*darkMode
                ? "rgba(26, 75, 93, 0.2)" // COLORS.canvas with opacity
                : "rgba(48, 50, 51, 0.2)" , // COLORS.canvas with */
              backdropFilter: "blur(4px)",
              WebkitBackdropFilter: "blur(8px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center", //"flex-end",
              justifyContent: "center", //"flex-start",
              padding: 10,
              zIndex: 3,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left button column — hidden when a panel is open */}
            {true && (
              <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", boxSizing: "border-box" }}>
                
                {/* Row 1: Reader + Player side by side, they are greyed out and unavailable to click if the file type isn't available */}
                <div style={{ display: "flex", gap: btnSize.gap }}>
                  <button
                    style={{ ...( hasEpub ? actionButtonStyle : disabledButtonStyle ), ...hoverStyle("reader"), flex: 1, textAlign: "center" }}
                    onMouseEnter={() => setHoveredBtn("reader")}
                    onMouseLeave={() => setHoveredBtn(null)}
                    onClick={() => hasEpub ? navigate(`/reader/${book.id}`) : onEdit(book)}
                  >
                    {hasEpub ? "Reader" : "Upload Text"}
                  </button>

                  <button
                    style={{ ...( (hasAudio || hasGeneratedAudio) ? actionButtonStyle : disabledButtonStyle ), ...hoverStyle("player"), flex: 1, textAlign: "center" }}
                    onMouseEnter={() => setHoveredBtn("player")}
                    onMouseLeave={() => setHoveredBtn(null)}
                    onClick={() => (hasAudio || hasGeneratedAudio) ? navigate(`/player/${book.id}`) : onEdit(book)}
                  >
                    {(hasAudio || hasGeneratedAudio) ? "Player" : "Upload Audio"}
                  </button>
                </div>

                <div style={{ flexGrow: 1 }} />

                {/* Row 2: Audio full width button that opens the pop-up */}
                <div style={{ display: "flex", flexDirection: "column", gap: btnSize.gap }}>
                <button
                  style={{ ...actionButtonStyle, ...hoverStyle("audio"), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
                  onMouseEnter={() => setHoveredBtn("audio")}
                  onMouseLeave={() => setHoveredBtn(null)}
                  onClick={(e) => { e.stopPropagation(); onOpenAudio(); }}
                >
                  {/* drawing the settings wheel icon */}
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    // This margin keeps the icon from touching the text
                    style={{ marginRight: '8px' }}
                  >
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Audio</span>
                </button>
                

                {/* Row 3: Sync full width */}
                <button
                  style={{ ...actionButtonStyle, ...hoverStyle("sync"), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}
                  onMouseEnter={() => setHoveredBtn("sync")}
                  onMouseLeave={() => setHoveredBtn(null)}
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent the reader from opening
                    onOpenSync();        // Trigger the modal
                  }}
                >
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round" 
                    style={{ marginRight: '8px' }}
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 16h5v5" />
                  </svg>
                  <span>Sync</span>
                </button>
                </div>

                <div style={{ flexGrow: 1 }} />

                {/* Row 4: Edit + Delete side by side */}
                <div style={{ display: "flex", gap: btnSize.gap }}>
                  <button
                    style={{ ...actionButtonStyle, ...hoverStyle("edit"), flex: 1, textAlign: "center" }}
                    onMouseEnter={() => setHoveredBtn("edit")}
                    onMouseLeave={() => setHoveredBtn(null)}
                    onClick={() => onEdit(book)}
                  >
                    Edit
                  </button>

                  <button
                    style={{ ...deleteButtonStyle, ...hoverStyle("delete"), flex: 1, textAlign: "center" }}
                    onMouseEnter={() => setHoveredBtn("delete")}
                    onMouseLeave={() => setHoveredBtn(null)}
                    onClick={() => onDelete(book)}
                  >
                    Delete
                  </button>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Below-card info: title author, and generation status */}
        <div
          style={{
            width: config.width,
            marginTop: "10px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
          }}
        >
          <div
            style={{
              fontSize: config.fontSize,
              fontWeight: 800,
              lineHeight: 1.2,
              color: inkColor,
              fontFamily: FONTS.headings,
              marginBottom: 4,
              display: "-webkit-box",
              WebkitLineClamp: config.lineClamp,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {book.title || "(Untitled)"}
          </div>

          <div style={{ fontSize: config.fontSize - 2, color: mutedColor, lineHeight: 1.3 }}>
            {book.author || "Unknown"}
          </div>
          {/* progress bar — only visible while the audio service is actively generating */}
          {isGenerating && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: mutedColor, marginBottom: 4 }}>
                Generating audiobook… {generationCurrent}/{generationTotal}
              </div>
              <div style={{
                width: "100%", height: 8,
                background: darkMode ? "rgba(255,255,255,0.12)" : "#e5e7eb",
                borderRadius: 999, overflow: "hidden",
              }}>
                <div style={{
                  width: `${generationProgress}%`, height: "100%",
                  background: COLORS.frame, transition: "width 0.3s ease",
                }} />
              </div>
            </div>
          )}

          {isReady && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#16a34a", fontWeight: 700 }}>
              Audiobook ready ✓
            </div>
          )}

          {isError && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#b91c1c" }}>
              Audio generation failed
            </div>
          )}
          {isLibrivoxGenerating && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11, color: mutedColor, marginBottom: 4 }}>
                Preparing LibriVox audio… {librivoxCurrent}/{librivoxTotal}
              </div>
              <div
                style={{
                  width: "100%",
                  height: 8,
                  background: darkMode ? "rgba(255,255,255,0.12)" : "#e5e7eb",
                  borderRadius: 999,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${librivoxProgress}%`,
                    height: "100%",
                    background: "#f59e0b",
                    transition: "width 0.3s ease",
                  }}
      />
    </div>
  </div>
)}

{isLibrivoxReady && (
  <div style={{ marginTop: 8, fontSize: 11, color: "#16a34a", fontWeight: 700 }}>
    LibriVox audio ready ✓
  </div>
)}

{isLibrivoxError && (
  <div style={{ marginTop: 8, fontSize: 11, color: "#b91c1c" }}>
    LibriVox audio preparation failed
  </div>
)}
        </div>
      </div>
    );
  }
          

   
// Renders a single result row in the Gutenberg search results list.
// Each card lets the user add just the EPUB, find matching LibriVox audio, or add both at once.
function SearchResultCard({ book, onAddEpub, onFindAudio, onAddAudio, onAddBoth }) {
  const [rowStatus, setRowStatus] = useState("");
  const [audioLink, setAudioLink] = useState("");

  const hasEpub = !!book.epub_link;
  // inline SVG used as a fallback when a Gutenberg book doesn't have a cover image
  const coverFallback =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='Arial' font-size='14'%3ENo%20Cover%3C/text%3E%3C/svg%3E";

  const findAudioClick = async () => {
    setRowStatus("Checking LibriVox…");
    try {
      const audio = await onFindAudio(audioLink);
      if (audio.status === "success" && audio.audio_url) {
        setAudioLink(audio.audio_url);
        setRowStatus("Audio found ✓");
      } else {
        setRowStatus("No audio found.");
      }
    } catch {
      setRowStatus("Audio search failed.");
    }
  };

  const addAudioClick = async () => {
    if (!audioLink) return;
    setRowStatus("Adding audio…");
    await onAddAudio(audioLink);
    setRowStatus("Audio added ✓");
  };

  const addBothClick = async () => {
    await onAddBoth(setRowStatus, audioLink);
  };

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 16,
        background: "#fff",
        boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
        display: "flex",
        gap: 12,
        padding: 12,
        alignItems: "flex-start",
      }}
    >
      <img
        src={book.cover_url || coverFallback}
        onError={(e) => {
          e.currentTarget.src = coverFallback;
        }}
        alt="Cover"
        style={{
          width: 74,
          height: 110,
          objectFit: "cover",
          borderRadius: 10,
          border: "1px solid rgba(17,24,39,0.08)",
        }}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <h4 style={{ margin: "0 0 6px", fontSize: 14, lineHeight: 1.2 }}>{book.title}</h4>
        <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>By {book.author}</p>

        

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {hasEpub && (
            <a href={book.epub_preview_url} target="_blank" rel="noreferrer" style={miniPreview}>
              Preview EPUB
            </a>
          )}

          <button
            disabled={!hasEpub}
            onClick={async () => {
              setRowStatus("Adding EPUB…");
              await onAddEpub();
              setRowStatus("EPUB added ✓");
            }}
            style={miniBtn("#16a34a", "white")}
          >
            {hasEpub ? "Add EPUB" : "No EPUB"}
          </button>

          <button onClick={findAudioClick} style={miniBtn("#f59e0b", COLORS.ink)}>
            Find audio
          </button>

          <button onClick={addBothClick} style={miniBtn(COLORS.ink, "white")}>
            Add both
          </button>

          {/* these only appear after findAudioClick succeeds and sets audioLink */}
          {audioLink && (
            <>
              <a href={audioLink} target="_blank" rel="noreferrer" style={miniPreview}>
                Preview Audio
              </a>
              <button onClick={addAudioClick} style={miniBtn("#16a34a", "white")}>
                Add audio
              </button>
            </>
          )}
        </div>

        {rowStatus && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>{rowStatus}</div>
        )}
      </div>
    </div>
  );
}

// Tab button at the top of the Add Book modal to switch between "Manual upload" and "Search" tabs
function TabButton({ active, onClick, children }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}

      style={{
        border: `1px solid ${
          active ? "rgba(242, 201, 76, 0.55)" : COLORS.border
        }`,
        background: active ? "rgba(242, 201, 76, 0.18)" : "rgba(255,255,255,0.55)",
        color: active ? COLORS.frame : COLORS.ink,
        padding: "10px 14px",
        borderRadius: 999,
        cursor: "pointer",
        fontWeight: 700,
        fontSize: 13,
        fontFamily: FONTS.ui,
        
        transition: "all 0.2s ease",
        transform: isHovered ? "translateY(-3px)" : "translateY(0)",
        boxShadow: isHovered 
          ? `0 6px 15px rgba(242, 201, 76, 0.4)` // Yellow (Status) Shadow
          : active ? "0 0 0 1px rgba(242, 201, 76, 0.18)" : "none",
      }}
    >
      {children}
    </button>
  );
}
// LAYOUT HELPERS
function Row({ children }) {
  // places fields side-by-side and allows them to wrap onto a new line on small screens
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  // for consistent spacing and label styling
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: "10px 0",
        flex: 1,
        minWidth: 220,
      }}
    >
      <label
        style={{
          fontSize: 14,
          color: COLORS.ink,
          fontWeight: 700,
          fontFamily: FONTS.reading,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: "40px 24px", // Increased vertical gap to make room for the shelf
  alignItems: "end", // Aligns books to sit "on" the shelf
  paddingBottom: "10px",
  // This adds a dark wooden line under every row of books
  borderBottom: "8px solid #3d2b1f",
};

// SHARED STYLE OBJECTS ACCROSS THE DASHBOARD
const inputStyle = {
  padding: "13px 14px",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 14,
  outline: "none",
  background: "rgba(255,255,255,0.78)",
  width: "100%",
  color: COLORS.ink,
  fontFamily: FONTS.ui,
  fontSize: 15,
  boxSizing: "border-box",
};

const btnWide = {
  width: "100%",
  borderRadius: 16,
  padding: "14px 16px",
  fontWeight: 800,
  cursor: "pointer",
  marginTop: 10,
  fontFamily: FONTS.ui,
  fontSize: 15,
};

const miniPreview = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 700,
  padding: "10px 12px",
  borderRadius: 12,
  border: `1px solid ${COLORS.border}`,
  background: "rgba(255,255,255,0.72)",
  color: COLORS.ink,
  fontFamily: FONTS.ui,
};

const miniBtn = (bg, color) => ({
  border: "none",
  borderRadius: 12,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 800,
  fontSize: 12,
  background: bg,
  color,
  fontFamily: FONTS.ui,
});