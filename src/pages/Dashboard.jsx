import React, { useEffect, useMemo, useState } from "react";
import { auth, db, storage } from "../firebase";
import { signOut } from "firebase/auth";
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes } from "firebase/storage";
import Modal from "../components/Modal";
import { useNavigate } from "react-router-dom";

const SCRAPER_BASE_URL = "http://localhost:5050";
const COLORS = {
  canvas: "#F9EAEA",
  ink: "#122630",
  frame: "#1A4B5D",
  spark: "#E67E7E",
  status: "#F2C94C",
  accent: "#8E2424",
  white: "#FFFFFF",
  border: "rgba(18, 38, 48, 0.12)",
  mutedInk: "rgba(18, 38, 48, 0.72)",
};

const FONTS = {
  headings: '"Merriweather", serif',
  ui: '"Inter", sans-serif',
  reading: '"Source Serif 4", serif',
  //ui: '"Inter", "Helvetica Neue", Arial, sans-serif',
  //reading: '"Libre Baskerville", Georgia, serif',
};


const GRID_CONFIGS = {
  small: { width: 110, height: 165, gap: 16, fontSize: 11, lineClamp: 2 },
  medium: { width: 160, height: 240, gap: 24, fontSize: 14, lineClamp: 3 },
  large: { width: 210, height: 315, gap: 32, fontSize: 18, lineClamp: 3 },
};

const generateBookId = (title) =>
  title.toLowerCase().trim().replace(/[^a-z0-9]/g, "-");

const coverFromGutendex = (formats) => formats?.["image/jpeg"] || "";
const epubFromGutendex = (formats) => formats?.["application/epub+zip"] || "";

export default function Dashboard({ user }) {
  const [gridSize, setGridSize] = useState("medium"); 
  const [sortBy, setSortBy] = useState("recent");
  const [books, setBooks] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("upload"); // upload/search

  // upload state
  const [upTitle, setUpTitle] = useState("");
  const [upAudioFile, setUpAudioFile] = useState(null);
  const [upAuthor, setUpAuthor] = useState("");
  const [upFile, setUpFile] = useState(null);
  const [upStatus, setUpStatus] = useState("");
  
  const [isUploadHovered, setIsUploadHovered] = useState(false);
  const [isSearchHovered, setIsSearchHovered] = useState(false);
  const [isLogoutHovered, setIsLogoutHovered] = useState(false);

  // dark mode
  const [darkMode, setDarkMode] = useState(false);
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

  // search state
  const [q, setQ] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [results, setResults] = useState([]);

  // edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editBook, setEditBook] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editEpubFile, setEditEpubFile] = useState(null);
  const [editAudioFile, setEditAudioFile] = useState(null);
  const [editStatus, setEditStatus] = useState("");

  const booksCol = useMemo(() => collection(db, "Users", user.uid, "Books"), [user.uid]);
  const sortedBooks = useMemo(() => {
    const list = [...books];
    if (sortBy === "title-asc") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    if (sortBy === "title-desc") list.sort((a, b) => (b.title || "").localeCompare(a.title || ""));
    if (sortBy === "author-asc") list.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
    if (sortBy === "author-desc") list.sort((a, b) => (b.author || "").localeCompare(a.author || ""));
    if (sortBy === "recent") list.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    if (sortBy === "epub") return list.filter(b => !!b.epub_link || !!b.epub_storage_path);
    if (sortBy === "audio") return list.filter(b => !!b.audio_link || !!b.audio_storage_path);
    return list;
  }, [books, sortBy]);
  const loadBooks = async () => {
    const snap = await getDocs(booksCol);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    setBooks(list);
  };

  useEffect(() => {
    loadBooks();
  }, []);

  const logout = async () => {
    await signOut(auth);
  };

  const openEditModal = (book) => {
    setEditBook(book);
    setEditTitle(book.title || "");
    setEditAuthor(book.author || "");
    setEditEpubFile(null);
    setEditAudioFile(null);
    setEditStatus("");
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
  };

  const saveEditedBook = async () => {
    if (!editBook) return;

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
        const epubRef = ref(storage, epubPath);
        await uploadBytes(epubRef, editEpubFile);

        updates.epub_storage_path = epubPath;
        updates.epub_source = "upload";
      }

      if (editAudioFile) {
        setEditStatus("Uploading new audio...");
        const audioPath = `audio/${user.uid}/${editBook.id}/${editAudioFile.name}`;
        const audioRef = ref(storage, audioPath);
        await uploadBytes(audioRef, editAudioFile);

        updates.audio_storage_path = audioPath;
        updates.audio_source = "upload";
      }

      setEditStatus("Saving changes...");
      await setDoc(doc(db, "Users", user.uid, "Books", editBook.id), updates, { merge: true });

      await loadBooks();
      closeEditModal();
    } catch (e) {
      setEditStatus("Edit failed: " + e.message);
    }
  };

  const deleteBook = async (book) => {
    const confirmed = window.confirm(
      `Delete "${book.title || "this book"}" from your bookshelf?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "Users", user.uid, "Books", book.id));
      await loadBooks();
    } catch (e) {
      alert("Delete failed: " + e.message);
    }
  };

  // upload manually
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
      const baseDoc = {
        title: upTitle.trim(),
        author: upAuthor.trim() || "Unknown",
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      setUpStatus("Saving book…");
      await setDoc(doc(db, "Users", user.uid, "Books", bookId), baseDoc, { merge: true });

      if (upFile) {
        setUpStatus("Uploading EPUB…");
        const epubPath = `epubs/${user.uid}/${bookId}.epub`;
        const epubRef = ref(storage, epubPath);
        await uploadBytes(epubRef, upFile);

        await setDoc(
          doc(db, "Users", user.uid, "Books", bookId),
          {
            epub_storage_path: epubPath,
            epub_source: "upload",
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      if (upAudioFile) {
        setUpStatus("Uploading audio…");
        const audioPath = `audio/${user.uid}/${bookId}/${upAudioFile.name}`;
        const audioRef = ref(storage, audioPath);
        await uploadBytes(audioRef, upAudioFile);

        await setDoc(
          doc(db, "Users", user.uid, "Books", bookId),
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
      setUpTitle("");
      setUpAuthor("");
      setUpFile(null);
      setUpAudioFile(null);
      await loadBooks();
    } catch (e) {
      setUpStatus("Upload failed: " + e.message);
    }
  };

  const searchGutenberg = async () => {
    setSearchStatus("");
    setResults([]);
    if (!q.trim()) {
      setSearchStatus("Enter a search term.");
      return;
    }

    try {
      setSearchStatus("Searching Gutenberg…");
      const res = await fetch(`https://gutendex.com/books/?search=${encodeURIComponent(q.trim())}`);
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
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
    await loadBooks();
  };

  const findAudio = async (title) => {
    const res = await fetch(`${SCRAPER_BASE_URL}/scrape-audio?title=${encodeURIComponent(title)}`);
    return await res.json();
  };

  const addAudio = async (book, audioUrl) => {
    const id = generateBookId(book.title);
    await setDoc(
      doc(db, "Users", user.uid, "Books", id),
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
    await loadBooks();
  };

  const addBoth = async (book, setRowStatus) => {
    try {
      setRowStatus("Adding EPUB…");
      if (book.epub_link) await addEpub(book);

      setRowStatus("Searching audio…");
      const audio = await findAudio(book.title);
      if (audio.status === "success" && audio.audio_url) {
        await addAudio(book, audio.audio_url);
        setRowStatus("Done ✓ (EPUB + Audio)");
      } else {
        setRowStatus("Done ✓ (EPUB only, no audio found)");
      }
    } catch (e) {
      setRowStatus("Failed: " + e.message);
    }
  };

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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: THEME.white,
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
                color: THEME.mutedInk,
                maxWidth: 280,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: FONTS.ui,
              }}
            >
              {user.email}
            </span>
            <button
              onClick={logout}
              onMouseEnter={() => setIsLogoutHovered(true)}
              onMouseLeave={() => setIsLogoutHovered(false)}
              style={{
                background: COLORS.frame, // Midnight Navy default
                color: COLORS.white,

                fontFamily: FONTS.ui,
                //fontSize: 14,
                fontWeight: 500,
                
                // Shape & Spacing
                border: "none",
                borderRadius: 12,
                padding: "10px 18px",
                cursor: "pointer",

                /*display: "flex",
                alignItems: "center",
                gap: 10,
                background: COLORS.white,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 14,
                padding: "10px 12px",*/
                
                // Interaction & Animation
                transition: "all 0.3s ease",
                transform: isLogoutHovered ? "translateY(-3px)" : "translateY(0)",
                
                // Blue Shadow Highlight
                boxShadow: isLogoutHovered 
                  ? "0 8px 20px rgba(26, 75, 93, 0.4)" // Navy highlight
                  : "0 2px 8px rgba(18, 38, 48, 0.08)",
                
              }}
            >
              Logout
            </button>

            <button
              onClick={() => setDarkMode(d => !d)}
              style={{
                background: darkMode ? COLORS.status : COLORS.ink,
                color: darkMode ? COLORS.ink : COLORS.white,
                border: "none",
                borderRadius: 12,
                padding: "10px 14px",
                cursor: "pointer",
                fontFamily: FONTS.ui,
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {darkMode ? "☀ Light" : "☾ Dark"}
            </button>
          </div>
        </div>
        
        <div style={{ margin: "18px 0 12px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}> 
          <h2 style={{ margin: 0, fontSize: 18, color: THEME.ink, fontFamily: FONTS.headings }}>
            My Bookshelf
          </h2>
          <p style={{ margin: "6px 0 0", color: COLORS.mutedInk, fontSize: 13, fontFamily: FONTS.ui }}>
          </p>
        </div>

        <div style={{ display: "flex", gap: 6, background: darkMode ? "rgba(255,255,255,0.05)" : "rgba(18, 38, 48, 0.05)", padding: 4, borderRadius: 10 }}>
          {["small", "medium", "large"].map((size) => (
            <button
              key={size}
              onClick={() => setGridSize(size)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                borderRadius: 7,
                cursor: "pointer",
                border: "none",
                background: gridSize === size ? THEME.white : "transparent",
                color: THEME.ink,
                fontWeight: gridSize === size ? "700" : "400",
                boxShadow: gridSize === size ? "0 2px 5px rgba(0,0,0,0.1)" : "none",
                transition: "all 0.2s ease",
                fontFamily: FONTS.ui,
              }}
            >
              {size.toUpperCase()}
            </button>
          ))}
        </div>

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

        <div style={{ 
          display: "grid", 
          gridTemplateColumns: `repeat(auto-fill, ${GRID_CONFIGS[gridSize].width}px)`, 
          gap: GRID_CONFIGS[gridSize].gap,
          justifyContent: "center" 
        }}>
          <AddTile
            size={gridSize}
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
              onEdit={openEditModal}
              onDelete={deleteBook}
              darkMode={darkMode}
            />
          ))}
        </div>

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
                    onAddBoth={(setRowStatus) => addBoth(r, setRowStatus)}
                  />
                ))}
              </div>
            </div>
          )}
        </Modal>

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

            <Field label="Replace EPUB file">
              <input
                style={inputStyle}
                type="file"
                accept=".epub"
                onChange={(e) => setEditEpubFile(e.target.files?.[0] || null)}
              />
            </Field>

            <Field label="Replace audio file">
              <input
                style={inputStyle}
                type="file"
                accept=".mp3,.zip,.m4b,.m4a,.ogg,.wav"
                onChange={(e) => setEditAudioFile(e.target.files?.[0] || null)}
              />
            </Field>

            <button onClick={saveEditedBook} style={{ ...btnWide, background: COLORS.spark }}>
              Save Changes
            </button>

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
      </div>
    </div>
  );
}

function AddTile({ onClick, size }) {
  const [isHovered, setIsHovered] = useState(false);
  const config = GRID_CONFIGS[size];

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}  
      onMouseLeave={() => setIsHovered(false)}
      style={{
        //background: "rgba(255,255,255,0.28)",
        //border: "2px dashed rgba(26,75,93,0.16)",
        //borderRadius: 16,
        //boxShadow: "0 2px 10px rgba(18,38,48,0.04)",
        //minHeight: 210,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        width: config.width, //"160px",
        //height: "335px",
        cursor: "pointer",
        transition: "transform 0.3s ease", 
        transform: isHovered ? "translateY(-4px)" : "translateY(0)",
        //alignItems: "center",
        //justifyContent: "center",
        //textAlign: "center",
      }}
    >
      <div style={{
        width: config.width, //"160px",
        height: config.height, //"240px",
        //aspectRatio: "2 / 3",
        background: "rgba(255,255,255,0.28)",
        border: isHovered ? `2px solid ${COLORS.frame}` : `2px dashed ${COLORS.border}`, //border: `2px dashed ${COLORS.border}`, //"2px dashed rgba(26,75,93,0.2)",
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
              //lineHeight: "58px",
              //lineHeight: 1,
              fontSize: size === "small" ? 24 : 34, //34,
              // dynamic colors
              background: isHovered ? COLORS.frame : "rgba(18, 38, 48, 0.05)",
              border: `2px solid ${isHovered ? COLORS.frame : COLORS.ink}`,
              color: isHovered ? "#FFFFFF" : COLORS.ink, 
              
              // THE ANIMATION:
              transition: "all 0.3s ease",
              
              
              /*margin: "0",
              background: "rgba(230,126,126,0.10)",
              border: "1px solid rgba(230,126,126,0.28)",
              color: COLORS.frame,*/
              //fontFamily: FONTS.ui,
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
          color: isHovered ? COLORS.frame : COLORS.ink }}>
            Add new book
        </b>
        {size !== "small" && (
          <div style={{ fontSize: 12, color: COLORS.mutedInk, fontFamily: FONTS.ui }}>
            Upload or search
          </div>
        )}
      </div>
    </div>
  );
}

function BookTile({ book, onEdit, onDelete, size , darkMode}) {
  const navigate = useNavigate();
  const config = GRID_CONFIGS[size] || GRID_CONFIGS["medium"];
  const inkColor = darkMode ? "#e8e8f0" : COLORS.ink;
  const mutedColor = darkMode ? "rgba(232,232,240,0.65)" : "#6b7280";

  const hasEpub = !!book.epub_link || !!book.epub_storage_path;
  const hasAudio = !!book.audio_link || !!book.audio_storage_path;

  const badgeText = hasEpub && hasAudio ? "EPUB + Audio" : hasEpub ? "EPUB" : hasAudio ? "Audio" : "Book";

  const actionButtonStyle = {
    border: "1px solid rgba(255,255,255,0.18)",
    background: COLORS.ink,
    color: "#fff",
    padding: "7px 10px",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 11,
    backdropFilter: "blur(4px)",
    transition: "all 0.2s ease",
  };

  const deleteButtonStyle = {
    ...actionButtonStyle,
    background: "rgba(127,29,29,0.82)",
    border: "1px solid rgba(254,202,202,0.35)",
  };

  const confirmOpen = (label, url) => {
    if (!url) return;
    const ok = window.confirm(`Open ${label}?\n\nThis may download a file.`);
    if (ok) window.open(url, "_blank", "noopener,noreferrer");
  };

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

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          position: "relative",
          //width: "160px", //"100%",
          //aspectRatio: "2 / 3",
          width: config.width,
          height: config.height,
          borderRadius: "2px 8px 8px 2px", //14,
          overflow: "hidden",
          boxShadow: "6px 8px 15px rgba(0,0,0,0.3), -1px 0 2px rgba(0,0,0,0.1)", //"0 10px 24px rgba(0,0,0,0.18)",
          cursor: "pointer",
          transition: "transform 0.18s ease, box-shadow 0.18s ease",
          ...coverStyle,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
        onClick={() => navigate(`/reader/${book.id}`)}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-4px)";
          e.currentTarget.style.boxShadow = "0 16px 30px rgba(0,0,0,0.24)";
          const overlay = e.currentTarget.querySelector(".book-hover-overlay");
          if (overlay) overlay.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.boxShadow = "0 10px 24px rgba(0,0,0,0.18)";
          const overlay = e.currentTarget.querySelector(".book-hover-overlay");
          if (overlay) overlay.style.opacity = "0";
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            //background:
            //  "linear-gradient(to top, rgba(17,24,39,0.72) 0%, rgba(17,24,39,0.18) 36%, rgba(17,24,39,0.04) 60%)",
            //background: "linear-gradient(to right, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0) 4%, rgba(255,255,255,0.1) 5%, rgba(0,0,0,0) 10%)",
            pointerEvents: "none",
            zIndex: 1
          }}
        />

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
          }}
        >
          {badgeText}
        </div>

        <div
          className="book-hover-overlay"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            transition: "opacity 0.18s ease",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 12,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            <button 
              style={actionButtonStyle} 
              onClick={() => navigate(`/reader/${book.id}`)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = COLORS.frame; // Switch to #8E2424
                e.currentTarget.style.transform = "scale(1.05)";  // pop animation
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = COLORS.ink;    
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Read
            </button>

            {hasEpub && (
              <button
                style={actionButtonStyle}
                onClick={() => confirmOpen("EPUB", book.epub_link)}
                onMouseEnter={(e) => {
                e.currentTarget.style.background = COLORS.frame; // Switch to #8E2424
                e.currentTarget.style.transform = "scale(1.05)";  // pop animation
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = COLORS.ink;    
                e.currentTarget.style.transform = "scale(1)";
              }}
              >
                EPUB
              </button>
            )}

            {hasAudio && (
              <button
                style={actionButtonStyle}
                onClick={() => confirmOpen("Audiobook", book.audio_preview_url || book.audio_link)}
              >
                Audio
              </button>
            )}

            <button 
              style={actionButtonStyle} 
              onClick={() => onEdit(book)}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = COLORS.frame; // Switch to #8E2424
                e.currentTarget.style.transform = "scale(1.05)";  // pop animation
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = COLORS.ink;    
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Edit
            </button>

            <button 
              style={deleteButtonStyle} 
              onClick={() => onDelete(book)}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = "brightness(1.5)"; // Makes the #8E2424 glow
                e.currentTarget.style.transform = "scale(1.08)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = "brightness(1)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      <div style={{ 
        //minHeight: 44 
        width: config.width, //"160px", 
        //height: "85px", 
        marginTop: "10px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start"
      }}>
        <div
          style={{
            fontSize: config.fontSize, //14,
            fontWeight: 800,
            lineHeight: 1.2,
            color: inkColor, //COLORS.ink,
            fontFamily: FONTS.headings,
            marginBottom: 4,
            display: "-webkit-box",
            WebkitLineClamp: "3",
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            //height: "54px",
            WebkitLineClamp: config.lineClamp,
          }}
        >
          {book.title || "(Untitled)"}
        </div>

        <div
          style={{
            fontSize: config.fontSize - 2, //12,
            color: mutedColor, //"#6b7280",
            lineHeight: 1.3,
          }}
        >
          {book.author || "Unknown"}
        </div>
      </div>
    </div>
  );
}

function SearchResultCard({ book, onAddEpub, onFindAudio, onAddAudio, onAddBoth }) {
  const [rowStatus, setRowStatus] = useState("");
  const [audioLink, setAudioLink] = useState("");

  const hasEpub = !!book.epub_link;

  const coverFallback =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='180'%3E%3Crect width='100%25' height='100%25' fill='%23f3f4f6'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-family='Arial' font-size='14'%3ENo%20Cover%3C/text%3E%3C/svg%3E";

  const findAudioClick = async () => {
    setRowStatus("Checking LibriVox…");
    try {
      const audio = await onFindAudio();
      if (audio.status === "success" && audio.audio_url) {
        setAudioLink(audio.audio_url);
        setRowStatus("Audio found ✓");
      } else {
        setRowStatus("No audio found.");
      }
    } catch (e) {
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
    await onAddBoth(setRowStatus);
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

        {rowStatus && <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>{rowStatus}</div>}
      </div>
    </div>
  );
}

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

function Row({ children }) {
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, margin: "10px 0", flex: 1, minWidth: 220 }}>
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
  /*display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
  gap: 24,
  alignItems: "start",*/
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: "40px 24px", // Increased vertical gap to make room for the shelf
  alignItems: "end", // Aligns books to sit "on" the shelf
  paddingBottom: "10px",
  // This adds a dark wooden line under every row of books
  borderBottom: "8px solid #3d2b1f",
};

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
  border: "none",
  borderRadius: 16,
  padding: "14px 16px",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  marginTop: 10,
  fontFamily: FONTS.ui,
  fontSize: 15,
  boxShadow: "0 10px 24px rgba(18,38,48,0.10)",
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