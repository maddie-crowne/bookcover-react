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

  const [page, setPage] = useState("reader");
  const [user, setUser] = useState(null);

  const [status, setStatus] = useState("Upload an EPUB and an MP3 to begin.");
  const [epubFile, setEpubFile] = useState(null);

  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [toc, setToc] = useState([]);
  const [progress, setProgress] = useState(0);

  const [remoteBook, setRemoteBook] = useState(null);
  const [epubUrl, setEpubUrl] = useState(null);

  const [hoverPrev, setHoverPrev] = useState(false);
  const [hoverNext, setHoverNext] = useState(false);
  const [hoverSave, setHoverSave] = useState(false);
  const [hoverBookshelf, setHoverBookshelf] = useState(false);

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [fontSize, setFontSize] = useState(100);
  const [spread, setSpread] = useState("none");
  const [darkMode, setDarkMode] = useState(false);

  // Sync state
  const [syncFile, setSyncFile] = useState(null);
  const [syncData, setSyncData] = useState([]);
  const [activeSyncIndex, setActiveSyncIndex] = useState(-1);

  const THEME = darkMode
    ? {
        canvas: "#1a1a2e",
        ink: "#e8e8f0",
        frame: "#4a9eba",
        mutedInk: "rgba(232,232,240,0.65)",
        white: "#16213e",
        border: "rgba(232,232,240,0.12)",
        sidebarBg: "#0f3460",
        highlight: "rgba(242, 201, 76, 0.35)",
      }
    : {
        canvas: COLORS.canvas,
        ink: COLORS.ink,
        frame: COLORS.frame,
        mutedInk: COLORS.mutedInk,
        white: COLORS.white,
        border: COLORS.border,
        sidebarBg: COLORS.frame,
        highlight: "rgba(242, 201, 76, 0.45)",
      };

  const log = (...args) => console.log("[Bookcover/EPUB]", ...args);

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

        if (data.epub_storage_path) {
          const url = await getDownloadURL(ref(storage, data.epub_storage_path));
          if (!cancelled) setEpubUrl(url);
        } else if (data.epub_link) {
          if (!cancelled) setEpubUrl(data.epub_link);
        } else {
          if (!cancelled) setEpubUrl(null);
        }

        if (data.audio_storage_path) {
          const url = await getDownloadURL(ref(storage, data.audio_storage_path));
          if (!cancelled) setAudioUrl(url);
        } else if (data.audio_link) {
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

  // ---------------- Load local sync JSON ----------------
  useEffect(() => {
    if (!syncFile) {
      setSyncData([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const text = await syncFile.text();
        const parsed = JSON.parse(text);
        if (!cancelled) {
          setSyncData(Array.isArray(parsed) ? parsed : []);
        }
      } catch (e) {
        console.error("[Bookcover/Sync] Failed to parse sync JSON:", e);
        if (!cancelled) setSyncData([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [syncFile]);

  const mmss = useMemo(() => {
    const s = Math.floor(currentTime);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }, [currentTime]);

  const activeSyncItem =
    activeSyncIndex >= 0 && activeSyncIndex < syncData.length
      ? syncData[activeSyncIndex]
      : null;

  // ---------------- Track active sentence from audio time ----------------
  useEffect(() => {
    if (!Array.isArray(syncData) || syncData.length === 0) {
      setActiveSyncIndex(-1);
      return;
    }

    const idx = syncData.findIndex((item) => {
      if (typeof item?.start !== "number" || typeof item?.end !== "number") {
        return false;
      }
      return currentTime >= item.start && currentTime < item.end;
    });

    setActiveSyncIndex(idx);
  }, [currentTime, syncData]);

  // ---------------- Save to Firestore ----------------
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

  // ---------------- Highlight helpers ----------------
  const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const normalizeForMatch = (text) =>
    (text || "")
      .replace(/\s+/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim()
      .toLowerCase();

  const clearHighlights = () => {
    const contents = renditionRef.current?.getContents?.() || [];

    contents.forEach((content) => {
      try {
        const doc = content.document;
        const oldMarks = doc.querySelectorAll(".bookcover-sync-block-highlight");

        oldMarks.forEach((el) => {
          el.classList.remove("bookcover-sync-block-highlight");
          el.style.background = "";
          el.style.borderRadius = "";
          el.style.boxShadow = "";
          el.style.transition = "";
        });
      } catch (e) {
        console.error("[Bookcover/Sync] clearHighlights error:", e);
      }
    });
  };

  const highlightActiveSentenceInView = (sentence) => {
    if (!sentence || !renditionRef.current) return;

    const target = normalizeForMatch(sentence);
    if (!target) return;

    clearHighlights();

    const contents = renditionRef.current.getContents?.() || [];

    for (const content of contents) {
      try {
        const doc = content.document;

        const candidates = doc.querySelectorAll("p, div, li, blockquote");

        for (const el of candidates) {
          const text = normalizeForMatch(el.textContent);
          if (!text) continue;

          const firstWords = target.split(" ").slice(0, 6).join(" ");
          const strongMatch =
            text.includes(target) ||
            target.includes(text) ||
            (firstWords.length > 20 && text.includes(firstWords));

          if (strongMatch) {
            el.classList.add("bookcover-sync-block-highlight");
            el.style.background = THEME.highlight;
            el.style.borderRadius = "6px";
            el.style.boxShadow = `0 0 0 2px ${THEME.highlight}`;
            el.style.transition = "all 0.2s ease";
            return;
          }
        }
      } catch (e) {
        console.error("[Bookcover/Sync] highlight error:", e);
      }
    }
  };

  useEffect(() => {
    if (!activeSyncItem?.sentence) {
      clearHighlights();
      return;
    }

    highlightActiveSentenceInView(activeSyncItem.sentence);
  }, [activeSyncItem, darkMode]);

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
    setCurrentPage(0);
    setTotalPages(0);
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

      const rendition = book.renderTo(el, {
        width: "100%",
        height: "100%",
        spread,
        allowScriptedContent: true,
      });

      renditionRef.current = rendition;

      rendition.themes.default({
        body: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important`,
          "background-color": `${darkMode ? "#1a1a2e" : COLORS.canvas} !important`,
          "line-height": "1.7",
        },
        p: {
          "font-family": '"Libre Baskerville", Georgia, serif !important',
          "line-height": "1.7",
          color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important`,
        },
        span: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
        "*": { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
        h1: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
        h2: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
        h3: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      });

      rendition.on("relocated", (location) => {
        const pct = location?.start?.percentage;
        if (typeof pct === "number" && !isNaN(pct)) {
          setProgress(Math.round(pct * 100));
        }
        if (location?.start?.location) {
          setCurrentPage(location.start.location);
        }

        if (activeSyncItem?.sentence) {
          setTimeout(() => {
            highlightActiveSentenceInView(activeSyncItem.sentence);
          }, 100);
        }
      });

      book.locations.generate(1024).then(() => {
        setTotalPages(book.locations.total);
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
  }, [epubFile, epubUrl, darkMode, spread]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.spread(spread);
  }, [spread]);

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

  if (page === "bookshelf") {
    return <Dashboard onBack={() => setPage("reader")} user={user} />;
  }

  return (
    <div style={{ ...styles.page, background: THEME.canvas, color: THEME.ink }}>
      <button
        onClick={() => navigate("/")}
        onMouseEnter={() => setHoverBookshelf(true)}
        onMouseLeave={() => setHoverBookshelf(false)}
        style={{
          ...styles.bookshelfBtn,
          fontFamily: FONTS.headings,
          fontWeight: "bold",
          background: COLORS.frame,
          color: COLORS.white,
          transform: hoverBookshelf ? "translateY(-4px)" : "translateY(0)",
          boxShadow: hoverBookshelf
            ? "0 10px 20px rgba(26, 75, 93, 0.45)"
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

      <button
        onClick={() => setDarkMode((d) => !d)}
        style={{
          position: "fixed",
          top: 16,
          right: 148,
          padding: "10px 14px",
          borderRadius: 14,
          border: "none",
          background: darkMode ? COLORS.status : COLORS.ink,
          color: darkMode ? COLORS.ink : COLORS.white,
          cursor: "pointer",
          zIndex: 9999,
          fontWeight: 700,
          fontFamily: FONTS.ui,
          fontSize: 13,
          boxShadow: "0 4px 14px rgba(18,38,48,0.08)",
        }}
      >
        {darkMode ? "☀ Light" : "☾ Dark"}
      </button>

      <h1 style={{ ...styles.title, color: THEME.ink }}>Reader</h1>
      <p style={{ ...styles.subtitle, color: THEME.mutedInk }}>
        {status}
        {remoteBook?.title ? ` — ${remoteBook.title}` : ""}
      </p>

      <div style={styles.grid}>
        <div
          style={{
            ...styles.readerCard,
            background: THEME.white,
            border: `1px solid ${THEME.border}`,
          }}
        >
          <div style={{ ...styles.readerTopBar, background: THEME.canvas }}>
            <button
              onClick={prevPage}
              onMouseEnter={() => setHoverPrev(true)}
              onMouseLeave={() => setHoverPrev(false)}
              style={{
                ...styles.btn,
                transform: hoverPrev ? "translateY(-3px)" : "translateY(0)",
                boxShadow: hoverPrev
                  ? "0 8px 20px rgba(230, 126, 126, 0.4)"
                  : styles.btn.boxShadow,
                transition: "all 0.2s ease",
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
                boxShadow: hoverNext
                  ? "0 8px 20px rgba(230, 126, 126, 0.4)"
                  : styles.btn.boxShadow,
                transition: "all 0.2s ease",
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
                boxShadow: hoverSave
                  ? "0 8px 20px rgba(230, 126, 126, 0.4)"
                  : styles.btn.boxShadow,
                transition: "all 0.2s ease",
              }}
            >
              Save to Bookshelf
            </button>

            <div
              style={{
                ...styles.progress,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                minWidth: 180,
                color: THEME.ink,
                background: darkMode
                  ? "rgba(255,255,255,0.08)"
                  : "rgba(242,201,76,0.25)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>
                  <b>Page</b> {currentPage}
                  {totalPages > 0 ? ` / ${totalPages}` : ""}
                </span>
                <span>
                  <b>{progress}%</b>
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "rgba(18,38,48,0.12)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progress}%`,
                    background: COLORS.frame,
                    borderRadius: 999,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setFontSize((f) => Math.max(60, f - 10))}
                style={{ ...styles.btn, padding: "6px 10px", fontSize: 16 }}
              >
                A−
              </button>
              <span style={{ fontSize: 12, color: THEME.ink, fontFamily: FONTS.ui }}>
                {fontSize}%
              </span>
              <button
                onClick={() => setFontSize((f) => Math.min(200, f + 10))}
                style={{ ...styles.btn, padding: "6px 10px", fontSize: 16 }}
              >
                A+
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 4,
                background: "rgba(18,38,48,0.06)",
                borderRadius: 8,
                padding: 3,
              }}
            >
              <button
                onClick={() => setSpread("none")}
                style={{
                  ...styles.btn,
                  padding: "6px 10px",
                  fontSize: 12,
                  background: spread === "none" ? COLORS.frame : "transparent",
                  color: spread === "none" ? COLORS.white : COLORS.ink,
                  boxShadow: "none",
                }}
                title="Single page"
              >
                ▭
              </button>
              <button
                onClick={() => setSpread("always")}
                style={{
                  ...styles.btn,
                  padding: "6px 10px",
                  fontSize: 12,
                  background: spread === "always" ? COLORS.frame : "transparent",
                  color: spread === "always" ? COLORS.white : COLORS.ink,
                  boxShadow: "none",
                }}
                title="Two pages"
              >
                ▭▭
              </button>
            </div>

            <label style={{ ...styles.fileLabel, color: THEME.ink }}>
              <span>Text (EPUB)</span>
              <input
                type="file"
                accept=".epub"
                onChange={(e) => setEpubFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div
            ref={viewerRef}
            style={{
              ...styles.viewer,
              background: THEME.canvas,
              borderLeft: `6px solid ${THEME.frame}`,
            }}
          />
        </div>

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

          <div
            style={{
              color: COLORS.white,
              fontSize: 14,
              marginBottom: 6,
              fontWeight: 600,
            }}
          >
            Upload alignment JSON
          </div>

          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => setSyncFile(e.target.files?.[0] || null)}
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
              <b>Sync status:</b>{" "}
              {activeSyncItem ? `Sentence ${activeSyncIndex + 1}` : "No active sentence"}
            </div>

            <div
              style={{
                marginTop: 8,
                fontSize: 14,
                lineHeight: 1.5,
                color: "rgba(255,255,255,0.92)",
              }}
            >
              {activeSyncItem?.sentence ||
                "Upload aligned_timings.json and play audio to test sentence sync."}
            </div>

            {activeSyncItem && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "rgba(255,255,255,0.7)",
                }}
              >
                {activeSyncItem.start?.toFixed?.(2)}s – {activeSyncItem.end?.toFixed?.(2)}s
              </div>
            )}
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
    fontFamily: FONTS.headings,
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