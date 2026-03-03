import React, { useEffect, useMemo, useState } from "react";
import { auth, db, storage } from "../firebase";
import { signOut } from "firebase/auth";
import { collection, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import Modal from "../components/Modal";
import { useNavigate } from "react-router-dom";

const SCRAPER_BASE_URL = "http://localhost:5050";

const generateBookId = (title) =>
  title.toLowerCase().trim().replace(/[^a-z0-9]/g, "-");

const coverFromGutendex = (formats) => formats?.["image/jpeg"] || "";
const epubFromGutendex = (formats) => formats?.["application/epub+zip"] || "";

export default function Dashboard({ user }) {
  const [books, setBooks] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("upload"); // upload/search

  // upload state
  const [upTitle, setUpTitle] = useState("");
  const [upAudioFile, setUpAudioFile] = useState(null);
  const [upAuthor, setUpAuthor] = useState("");
  const [upFile, setUpFile] = useState(null);
  const [upStatus, setUpStatus] = useState("");

  // search state
  const [q, setQ] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [results, setResults] = useState([]);

  const booksCol = useMemo(() => collection(db, "Users", user.uid, "Books"), [user.uid]);

  const loadBooks = async () => {
    const snap = await getDocs(booksCol);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    setBooks(list);
  };

  useEffect(() => { loadBooks(); }, []);
  const logout = async () => {
    await signOut(auth);
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

      // EPUB upload
      if (upFile) {
        setUpStatus("Uploading EPUB…");
        const epubPath = `epubs/${user.uid}/${bookId}.epub`;
        const epubRef = ref(storage, epubPath);
        await uploadBytes(epubRef, upFile);

        await setDoc(doc(db, "Users", user.uid, "Books", bookId), {
          epub_storage_path: epubPath,
          epub_source: "upload",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      // Audio upload
      if (upAudioFile) {
        setUpStatus("Uploading audio…");
        const audioPath = `audio/${user.uid}/${bookId}/${upAudioFile.name}`;
        const audioRef = ref(storage, audioPath);
        await uploadBytes(audioRef, upAudioFile);

        await setDoc(doc(db, "Users", user.uid, "Books", bookId), {
          audio_storage_path: audioPath,
          audio_source: "upload",
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      setUpStatus("Saved ✓");
      setModalOpen(false);
      setUpTitle(""); setUpAuthor(""); setUpFile(null); setUpAudioFile(null);
      await loadBooks();
    } catch (e) {
      setUpStatus("Upload failed: " + e.message);
    }
  };

  // epub search
  const searchGutenberg = async () => {
    setSearchStatus("");
    setResults([]);
    if (!q.trim()) { setSearchStatus("Enter a search term."); return; }

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
    await setDoc(doc(db, "Users", user.uid, "Books", id), {
      title: book.title,
      author: book.author,
      cover_url: book.cover_url || "",
      epub_link: book.epub_link,
      epub_preview_url: book.epub_preview_url || "",
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true });
    await loadBooks();
  };

  const findAudio = async (title) => {
    const res = await fetch(`${SCRAPER_BASE_URL}/scrape-audio?title=${encodeURIComponent(title)}`);
    return await res.json();
  };

  const addAudio = async (book, audioUrl) => {
    const id = generateBookId(book.title);
    await setDoc(doc(db, "Users", user.uid, "Books", id), {
      title: book.title,
      author: book.author,
      cover_url: book.cover_url || "",
      audio_link: audioUrl,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true });
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
    <div style={{ background: "#f4f4f9", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22 }}>Bookcover</h1>
            <p style={{ margin: "4px 0 0", color: "#6b7280", fontSize: 13 }}>Your personal bookshelf</p>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "#fff", border: "1px solid #e5e7eb",
            borderRadius: 12, padding: "10px 12px",
            boxShadow: "0 2px 10px rgba(0,0,0,0.06)"
          }}>
            <span style={{
              fontSize: 12, color: "#6b7280", maxWidth: 280,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>
              {user.email}
            </span>
            <button onClick={logout} style={{
              border: "none", borderRadius: 10, padding: "10px 12px",
              cursor: "pointer", fontWeight: 700,
              background: "#fee2e2", color: "#991b1b"
            }}>
              Logout
            </button>
          </div>
        </div>

        <div style={{ margin: "18px 0 12px" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>My Bookshelf</h2>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>
            Add books, then attach EPUB and/or audio to the same entry.
          </p>
        </div>

        {/* library grid */}
        <div style={gridStyle}>
          <AddTile onClick={() => { setTab("upload"); setModalOpen(true); }} />

          {books.map((b) => (
            <BookTile key={b.id} book={b} />
          ))}
        </div>

        <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add a new book">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>Manual upload</TabButton>
            <TabButton active={tab === "search"} onClick={() => setTab("search")}>Search</TabButton>
          </div>

          {tab === "upload" && (
            <div>
              <Row>
                <Field label="Book title">
                  <input style={inputStyle} value={upTitle} onChange={(e)=>setUpTitle(e.target.value)} placeholder="e.g., Pride and Prejudice" />
                </Field>
                <Field label="Author">
                  <input style={inputStyle} value={upAuthor} onChange={(e)=>setUpAuthor(e.target.value)} placeholder="e.g., Jane Austen" />
                </Field>
                <Field label="Audio file (mp3/zip/m4b)">
                  <input
                    style={inputStyle}
                    type="file"
                    accept=".mp3,.zip,.m4b,.m4a,.ogg,.wav"
                    onChange={(e)=>setUpAudioFile(e.target.files?.[0] || null)}
                  />
                </Field>
              </Row>

              <Field label="EPUB file">
                <input style={inputStyle} type="file" accept=".epub" onChange={(e)=>setUpFile(e.target.files?.[0] || null)} />
              </Field>

              <button onClick={uploadManualFiles} style={{...btnWide, background:"#16a34a"}}>Upload EPUB/AudiBook</button>
              {upStatus && <p style={{ marginTop: 10, color: upStatus.startsWith("Upload failed") ? "#b91c1c" : "#6b7280", fontSize: 13 }}>{upStatus}</p>}
            </div>
          )}

          {tab === "search" && (
            <div>
              <Field label="Search Gutenberg (covers included)">
                <input style={inputStyle} value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search by title, author…" />
              </Field>
              <button onClick={searchGutenberg} style={{...btnWide, background:"#2563eb"}}>Search</button>
              {searchStatus && <p style={{ marginTop: 10, color: searchStatus.includes("failed") ? "#b91c1c" : "#6b7280", fontSize: 13 }}>{searchStatus}</p>}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(1, minmax(0, 1fr))", gap: 12, marginTop: 12 }}>
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
      </div>
    </div>
  );
}

function AddTile({ onClick }) {
  return (
    <div onClick={onClick} style={{
      background: "rgba(255,255,255,0.7)",
      border: "2px dashed #cbd5e1",
      borderRadius: 16,
      boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      minHeight: 210,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center"
    }}>
      <div style={{ padding: 18 }}>
        <div style={{
          width: 54, height: 54, borderRadius: 999,
          background: "rgba(37,99,235,0.12)",
          border: "1px solid rgba(37,99,235,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 34, color: "#2563eb", margin: "0 auto 10px"
        }}>+</div>
        <b style={{ fontSize: 14 }}>Add new book</b><br />
        <span style={{ fontSize: 12, color: "#6b7280" }}>Upload or search</span>
      </div>
    </div>
  );
}

function BookTile({ book }) {
  const navigate = useNavigate();

  // ✅ include uploads too
  const hasEpub = !!book.epub_link || !!book.epub_storage_path;
  const hasAudio = !!book.audio_link || !!book.audio_storage_path;

  const badgeText = hasEpub && hasAudio ? "EPUB + Audio" : hasEpub ? "EPUB" : hasAudio ? "Audio" : "Book";

  const linkButtonStyle = {
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    padding: "8px 12px",
    borderRadius: 10,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12
  };

  const confirmOpen = (label, url) => {
    if (!url) return;
    const ok = window.confirm(`Open ${label}?\n\nThis may download a file.`);
    if (ok) window.open(url, "_blank", "noopener,noreferrer");
  };

  const coverStyle = book.cover_url
    ? { backgroundImage: `url('${book.cover_url}')`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: "linear-gradient(135deg, rgba(37,99,235,0.15), rgba(22,163,74,0.12))" };

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: 16,
      boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      overflow: "hidden",
      minHeight: 210,
      display: "flex",
      flexDirection: "column"
    }}>
      <div style={{ height: 120, padding: 12, display: "flex", alignItems: "flex-end", ...coverStyle }}>
        <span style={{
          fontSize: 11,
          background: "rgba(17,24,39,0.08)",
          padding: "6px 8px",
          borderRadius: 999,
          border: "1px solid rgba(17,24,39,0.08)"
        }}>
          {badgeText}
        </span>
      </div>

      <div style={{ padding: "12px 12px 14px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <p style={{ margin: 0, fontWeight: 800, fontSize: 14, lineHeight: 1.25 }}>{book.title || "(Untitled)"}</p>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 12 }}>By {book.author || "Unknown"}</p>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
          {hasEpub && (
            <button
              style={linkButtonStyle}
              onClick={() => confirmOpen("EPUB", book.epub_link)}
            >
              Download EPUB
            </button>
          )}

          {hasAudio && (
            <button
              style={linkButtonStyle}
              onClick={() => confirmOpen("Audiobook", book.audio_preview_url || book.audio_link)}
            >
              Download Audio
            </button>
          )}

          <button
            style={linkButtonStyle}
            onClick={() => navigate(`/reader/${book.id}`)}
          >
            Open Reader
          </button>
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
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: 16,
      background: "#fff",
      boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
      display: "flex",
      gap: 12,
      padding: 12,
      alignItems: "flex-start"
    }}>
      <img
        src={book.cover_url || coverFallback}
        onError={(e) => { e.currentTarget.src = coverFallback; }}
        alt="Cover"
        style={{ width: 74, height: 110, objectFit: "cover", borderRadius: 10, border: "1px solid rgba(17,24,39,0.08)" }}
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
            onClick={async () => { setRowStatus("Adding EPUB…"); await onAddEpub(); setRowStatus("EPUB added ✓"); }}
            style={miniBtn("#16a34a", "white")}
          >
            {hasEpub ? "Add EPUB" : "No EPUB"}
          </button>

          <button onClick={findAudioClick} style={miniBtn("#f59e0b", "#111827")}>
            Find audio
          </button>

          <button onClick={addBothClick} style={miniBtn("#111827", "white")}>
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

        {rowStatus && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
            {rowStatus}
          </div>
        )}
      </div>
    </div>
  );
}

/* small UI helpers */
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "1px solid #e5e7eb",
        background: active ? "rgba(37,99,235,0.10)" : "#f9fafb",
        borderColor: active ? "rgba(37,99,235,0.35)" : "#e5e7eb",
        padding: "10px 12px",
        borderRadius: 999,
        cursor: "pointer",
        fontWeight: 800,
        fontSize: 12
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
    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0", flex: 1, minWidth: 220 }}>
      <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>{label}</label>
      {children}
    </div>
  );
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14,
};

const inputStyle = {
  padding: "10px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  outline: "none",
  background: "#fff",
  width: "100%",
};

const btnWide = {
  width: "100%",
  border: "none",
  borderRadius: 12,
  padding: "10px 12px",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  marginTop: 8,
};

const miniPreview = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 900,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#f3f4f6",
  color: "#111827",
};

const miniBtn = (bg, color) => ({
  border: "none",
  borderRadius: 10,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 900,
  fontSize: 12,
  background: bg,
  color,
});