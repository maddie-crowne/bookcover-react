import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db, storage, auth } from "../firebase";
import { ref, getDownloadURL } from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";

import Dashboard from "./Dashboard";

import { onAuthStateChanged } from "firebase/auth";
import { saveBookForUser } from "../services/saveBook";
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
};

export default function Reader() {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const audioRef = useRef(null);

  const [page, setPage] = useState("reader"); // "reader" | "bookshelf"
  const [user, setUser] = useState(null);

  const [status, setStatus] = useState("Upload an EPUB and an MP3 to begin.");
  const [epubFile, setEpubFile] = useState(null); // local fallback

  const [audioFile, setAudioFile] = useState(null); // local fallback
  const [audioUrl, setAudioUrl] = useState(null); // can be local object URL OR remote URL
  const [currentTime, setCurrentTime] = useState(0);

  const [toc, setToc] = useState([]);
  const [progress, setProgress] = useState(0);

  const [remoteBook, setRemoteBook] = useState(null);
  const [epubUrl, setEpubUrl] = useState(null); // remote epub URL (storage or external)

  const log = (...args) => console.log("[Bookcover/EPUB]", ...args);

  const [hoverPrev, setHoverPrev] = useState(false);
  const [hoverNext, setHoverNext] = useState(false);
  const [hoverSave, setHoverSave] = useState(false);
  const [hoverBookshelf, setHoverBookshelf] = useState(false);
  

  // ---------------- Auth ----------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // ---------------- Load book from Firestore when route has bookId ----------------
  useEffect(() => {
    if (!user || !bookId) return;

    let cancelled = false;

    (async () => {
      try {
        setStatus("Loading book from library…");
        const snap = await getDoc(doc(db, "Users", user.uid, "Books", bookId));
        if (!snap.exists()) {
          setStatus("Book not found in your library.");
          return;
        }

        const data = snap.data();
        if (cancelled) return;

        setRemoteBook(data);

        // EPUB resolve
        if (data.epub_storage_path) {
          const url = await getDownloadURL(ref(storage, data.epub_storage_path));
          if (!cancelled) setEpubUrl(url);
        } else if (data.epub_link) {
          if (!cancelled) setEpubUrl(data.epub_link);
        } else {
          if (!cancelled) setEpubUrl(null);
        }

        // AUDIO resolve (note: LibriVox zip won't play in <audio>)
        if (data.audio_storage_path) {
          const url = await getDownloadURL(ref(storage, data.audio_storage_path));
          if (!cancelled) setAudioUrl(url);
        } else if (data.audio_link) {
          // This might be a ZIP; we still set it so "Preview Audio" can exist elsewhere,
          // but playback may fail unless it's a direct audio file.
          if (!cancelled) setAudioUrl(data.audio_link);
        } else {
          if (!cancelled) setAudioUrl(null);
        }

        setStatus("Book loaded. Rendering EPUB…");
      } catch (e) {
        console.error("[Reader] loadBook failed:", e);
        setStatus("Failed to load book (see console).");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, bookId]);

  // ---------------- Audio: local file fallback ----------------
  useEffect(() => {
    if (!audioFile) return;

    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setCurrentTime(a.currentTime || 0);
    a.addEventListener("timeupdate", onTime);
    return () => a.removeEventListener("timeupdate", onTime);
  }, []);

  const mmss = useMemo(() => {
    const s = Math.floor(currentTime);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }, [currentTime]);

  // ---------------- Save to Firestore (prototype) ----------------
  const saveCurrentBook = async () => {
    if (!user) {
      alert("Please log in first.");
      return;
    }
    if (!epubFile) {
      alert("Upload an EPUB first (this save button is for the local-file prototype).");
      return;
    }

    const title = epubFile.name.replace(/\.epub$/i, "");
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    try {
      await saveBookForUser({
        uid: user.uid,
        bookId: id,
        data: {
          title,
          hasAudio: !!audioFile,
          updatedAtClient: Date.now(),
        },
      });

      alert(`Saved "${title}" to your bookshelf!`);
    } catch (e) {
      console.error("[Bookcover] save failed:", e);
      alert("Save failed (see console).");
    }
  };

  // ---------------- EPUB helpers ----------------
  const destroyReader = () => {
    try {
      renditionRef.current?.destroy?.();
    } catch {
      // ignore
    }
    renditionRef.current = null;

    try {
      bookRef.current?.destroy?.();
    } catch {
      // ignore
    }
    bookRef.current = null;

    if (viewerRef.current) viewerRef.current.innerHTML = "";
    setToc([]);
    setProgress(0);
  };

  const displayFirstWorkingSpineItem = async (book, rendition) => {
    const spineItems = book?.spine?.items || [];
    log("spine items:", spineItems.length);

    const candidates = spineItems
      .map((it, idx) => ({
        idx,
        href: it?.href,
        idref: it?.idref,
        linear: it?.linear,
      }))
      .filter((x) => typeof x.href === "string" && x.href.trim().length > 0)
      .filter((x) => {
        const h = x.href.toLowerCase();
        const id = (x.idref || "").toLowerCase();
        if (x.linear === "no") return false;
        if (h.includes("nav") || h.includes("toc") || h.includes("contents") || h.includes("cover")) return false;
        if (id.includes("nav") || id.includes("toc") || id.includes("cover")) return false;
        return true;
      });

    if (candidates.length === 0) {
      throw new Error("No valid spine hrefs found after filtering.");
    }

    const MAX_TRIES = Math.min(30, candidates.length);
    let lastErr = null;

    for (let i = 0; i < MAX_TRIES; i++) {
      const c = candidates[i];
      try {
        log(`TRY display idx=${c.idx} href=`, c.href);
        await rendition.display(c.href);
        log("SUCCESS display href:", c.href);
        return c.href;
      } catch (err) {
        lastErr = err;
        console.error("[Bookcover/EPUB] display failed for", c.href, err);
      }
    }

    throw lastErr || new Error("Failed to display any spine item.");
  };
  
const proxiedUrl = (url) => {
  // url like: https://www.gutenberg.org/ebooks/64317.epub3.images
  const u = new URL(url);
  return `/gutenberg${u.pathname}${u.search}`;
};

const isGutenberg = (url) =>
    typeof url === "string" && url.includes("gutenberg.org");
  
  const getEpubArrayBuffer = async () => {
    if (epubUrl) {
      const finalUrl = isGutenberg(epubUrl)
        ? `/epub-proxy?url=${encodeURIComponent(epubUrl)}`
        : epubUrl;
  
      const res = await fetch(finalUrl);
      if (!res.ok) throw new Error(`Failed to fetch EPUB: ${res.status}`);
      return await res.arrayBuffer();
    }
  
    if (epubFile) return await epubFile.arrayBuffer();
    return null;
  };

  // ---------------- EPUB main effect ----------------
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    destroyReader();

    // If neither remote nor local exists, stop.
    if (!epubUrl && !epubFile) {
      setStatus("Upload an EPUB to begin, or open a book from your library.");
      return;
    }

    let cancelled = false;

    (async () => {
      setStatus("Loading EPUB…");

      const buf = await getEpubArrayBuffer();
      if (!buf) return;

      const book = ePub();
      bookRef.current = book;

      log("book.open(buf, 'binary')…");
      await book.open(buf, "binary");
      await book.ready;

      // Create rendition
      const rendition = book.renderTo(el, {
        width: "100%",
        height: "100%",
        spread: "none",
        allowScriptedContent: true,
      });
      renditionRef.current = rendition;
      rendition.themes.default({
        body: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          color: COLORS.ink,
          "background-color": COLORS.canvas,
          "line-height": "1.7",
        },
        p: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          "line-height": "1.7",
        },
        h1: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          color: COLORS.ink,
        },
        h2: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          color: COLORS.ink,
        },
        h3: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          color: COLORS.ink,
        },
      });

      rendition.on("relocated", (location) => {
        const pct =
          typeof location?.start?.percentage === "number"
            ? Math.round(location.start.percentage * 100)
            : 0;
        setProgress(pct);
      });

      try {
        const nav = await book.loaded.navigation;
        const tocItems = nav?.toc || [];
        setToc(tocItems);
      } catch {
        setToc([]);
      }

      if (cancelled) return;

      await displayFirstWorkingSpineItem(book, rendition);

      if (!cancelled) setStatus("EPUB loaded.");
    })().catch((err) => {
      console.error("[Bookcover/EPUB] LOAD ERROR:", err);
      if (!cancelled) setStatus("Failed to display EPUB (see console).");
    });

    return () => {
      cancelled = true;
      destroyReader();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epubFile, epubUrl]);

  // ---------------- Controls ----------------
  const nextPage = async () => {
    try {
      await renditionRef.current?.next();
    } catch (e) {
      console.error("[Bookcover/EPUB] next error:", e);
    }
  };

  const prevPage = async () => {
    try {
      await renditionRef.current?.prev();
    } catch (e) {
      console.error("[Bookcover/EPUB] prev error:", e);
    }
  };

  const goToToc = async (href) => {
    if (!href) return;
    try {
      await renditionRef.current?.display(href);
    } catch (e) {
      console.error("[Bookcover/EPUB] toc display error:", e);
    }
  };

  // ---------------- Page switch ----------------
  if (page === "bookshelf") {
    return <Dashboard onBack={() => setPage("reader")} user={user} />;
  }

  // ---------------- UI ----------------
  return (
    <div style={styles.page}>
      <button
        onClick={() => navigate("/")}
        onMouseEnter={() => setHoverBookshelf(true)}
        onMouseLeave={() => setHoverBookshelf(false)}
        style={{
          ...styles.bookshelfBtn,
          // --- BRAND TYPOGRAPHY ---
          fontFamily: FONTS.headings, 
          fontWeight: "bold",

          background: COLORS.frame, // Always Blue
          color: COLORS.white,      // White text for contrast
          
          // --- HOVER TRANSFORM & COLOR ---
          
          transform: hoverBookshelf ? "translateY(-4px)" : "translateY(0)",
          
          // --- CORAL SHADOW ---
          boxShadow: hoverBookshelf 
            ? "0 10px 20px rgba(26, 75, 93, 0.45)" // Stronger Blue highlight on hover
            : "0 4px 14px rgba(18, 38, 48, 0.15)",
            
          transition: "all 0.3s ease",
          border: "none",
          cursor: "pointer",
          zIndex: 9999,
        }}
        title="Go to your bookshelf"
      >
        My Bookshelf
      </button>

      <h1 style={styles.title}>Reader</h1>
      <p style={styles.subtitle}>
        {status}
        {remoteBook?.title ? ` — ${remoteBook.title}` : ""}
      </p>

      <div style={styles.grid}>
        {/* LEFT: Reader */}
        <div style={styles.readerCard}>
          <div style={styles.readerTopBar}>
            <button 
              onClick={prevPage}
              onMouseEnter={() => setHoverPrev(true)}
              onMouseLeave={() => setHoverPrev(false)}
              style={{
                ...styles.btn,
                transform: hoverPrev ? "translateY(-3px)" : "translateY(0)",
                boxShadow: hoverPrev ? "0 8px 20px rgba(230, 126, 126, 0.4)" : styles.btn.boxShadow,
                transition: "all 0.2s ease"
              }}  
            >
              Prev
            </button>
            <button 
              onClick={nextPage}
              onMouseEnter={() => setHoverNext(true)}
              onMouseLeave={() => setHoverNext(false)}
              style={{
                ...styles.btn,
                transform: hoverNext ? "translateY(-3px)" : "translateY(0)",
                boxShadow: hoverNext ? "0 8px 20px rgba(230, 126, 126, 0.4)" : styles.btn.boxShadow,
                transition: "all 0.2s ease"
              }}
            >
              Next
            </button>

            <button 
              onClick={saveCurrentBook}
              onMouseEnter={() => setHoverSave(true)}
              onMouseLeave={() => setHoverSave(false)}
              style={{
                ...styles.btn,
                transform: hoverSave ? "translateY(-3px)" : "translateY(0)",
                boxShadow: hoverSave ? "0 8px 20px rgba(230, 126, 126, 0.4)" : styles.btn.boxShadow,
                transition: "all 0.2s ease"
              }}
            >
              Save to Bookshelf
            </button>

            <div style={styles.progress}>
              <b style={{ fontFamily: FONTS.headings }}>Progress:</b> {progress}%
            </div>

            <label style={styles.fileLabel}>
              <span>Text (EPUB)</span>
              <input
                type="file"
                accept=".epub"
                onChange={(e) => setEpubFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div ref={viewerRef} style={styles.viewer} />
        </div>

        {/* RIGHT: Sidebar */}
        <div style={styles.sidebarCard}>
          <h2 style={styles.h2}>Audio</h2>

          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
            style={{
              marginBottom: 10,
              color: "#fff",
            }}
          />

          <audio
            ref={audioRef}
            controls
            src={audioUrl || undefined}
            style={{ width: "100%" }}
          />

          <div
            style={{
              marginTop: 12,
              color: COLORS.white,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.14)",
              borderRadius: 14,
              padding: 12,
            }}
          >
            <div>
              <b>Current time:</b> {mmss}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.8)" }}>
              Note: LibriVox links are often ZIPs and won’t play in-browser unless extracted to an MP3.
            </div>
          </div>

          <hr style={styles.hr} />

          <h2 style={styles.h2}>Chapters</h2>
          {toc.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
              No TOC detected for this EPUB (common).
            </div>
          ) : (
            <div
              style={{
                maxHeight: 340,
                overflow: "auto",
                display: "grid",
                gap: 8,
              }}
            >
              {toc.map((item) => (
                <button
                  key={item.id || item.href}
                  onClick={() => goToToc(item.href)}
                  style={styles.tocBtn}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: {
    fontFamily: FONTS.ui,
    padding: 20,
    background: COLORS.canvas,
    minHeight: "100vh",
    color: COLORS.ink,
  },

  bookshelfBtn: {
    fontFamily: FONTS.ui,
    position: "fixed",
    top: 16,
    right: 16,
    padding: "10px 14px",
    borderRadius: 14,
    border: `1px solid ${COLORS.border}`,
    background: COLORS.white,
    color: COLORS.ink,
    cursor: "pointer",
    zIndex: 9999,
    fontWeight: 700,
    boxShadow: "0 4px 14px rgba(18,38,48,0.08)",
  },

  title: {
    fontFamily: FONTS.headings, //FONTS.ui,
    margin: 0,
    color: COLORS.ink,
    fontSize: 56,
    letterSpacing: -1,
    lineHeight: 1,
  },

  subtitle: {
    fontFamily: FONTS.ui,
    marginTop: 10,
    color: COLORS.mutedInk,
    fontSize: 18,
  },

  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(520px, 1fr) 360px",
    gap: 18,
    marginTop: 18,
    alignItems: "start",
  },

  readerCard: {
    border: `1px solid ${COLORS.border}`,
    borderRadius: 20,
    overflow: "hidden",
    background: COLORS.white,
    boxShadow: "0 10px 24px rgba(18,38,48,0.08)",
  },

  readerTopBar: {
    padding: 14,
    borderBottom: `1px solid ${COLORS.border}`,
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
    background: COLORS.canvas,
  },

  btn: {
    fontFamily: FONTS.ui,
    padding: "10px 16px",
    borderRadius: 14,
    border: "none",
    background: COLORS.spark,
    color: COLORS.white,
    cursor: "pointer",
    fontWeight: 700,
    boxShadow: "0 4px 10px rgba(230,126,126,0.25)",
  },

  progress: {
    fontFamily: FONTS.ui,
    marginLeft: 8,
    color: COLORS.ink,
    fontSize: 14,
    background: "rgba(242,201,76,0.25)",
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(242,201,76,0.35)",
  },

  fileLabel: {
    fontFamily: FONTS.ui,
    marginLeft: "auto",
    color: COLORS.ink,
    display: "flex",
    gap: 8,
    alignItems: "center",
    fontWeight: 600,
  },

  viewer: {
    height: "70vh",
    width: "100%",
    background: COLORS.canvas,
    overflow: "hidden",
    borderLeft: `6px solid ${COLORS.frame}`,
    fontFamily: '"Libre Baskerville", Georgia, serif',
  },

  sidebarCard: {
    border: "none",
    borderRadius: 20,
    padding: 16,
    background: COLORS.frame,
    boxShadow: "0 10px 24px rgba(18,38,48,0.16)",
  },

  h2: {
    fontFamily: FONTS.ui,
    marginTop: 0,
    color: COLORS.white,
    fontSize: 24,
    marginBottom: 12,
  },

  hr: {
    margin: "18px 0",
    border: "none",
    borderTop: "1px solid rgba(255,255,255,0.18)",
  },

  tocBtn: {
    fontFamily: FONTS.ui,
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(18,38,48,0.18)",
    color: COLORS.white,
    cursor: "pointer",
    fontWeight: 500,
  },
};