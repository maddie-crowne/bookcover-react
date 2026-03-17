import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db, storage, auth } from "../firebase";
import { ref, getDownloadURL } from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";

import Dashboard from "./Dashboard";


import { onAuthStateChanged, signOut } from "firebase/auth";
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

export default function Reader({ darkMode, setDarkMode }) {
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
  const [audioTracks, setAudioTracks] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

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
  const [hoverSinglePage, setHoverSinglePage] = useState(false); // ← add
  const [hoverDoublePage, setHoverDoublePage] = useState(false);
  const [hoverFontDec, setHoverFontDec] = useState(false);
  const [hoverFontInc, setHoverFontInc] = useState(false);
  const [hoverDarkMode, setHoverDarkMode] = useState(false);

  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  
  const [fontSize, setFontSize] = useState(100); 
  const [spread, setSpread] = useState("none");

  const [isLogoutHovered, setIsLogoutHovered] = useState(false);

  
  const THEME = darkMode ? {
    canvas: "#1a1a2e",
    ink: "#e8e8f0",
    frame: "#4a9eba",
    mutedInk: "rgba(232,232,240,0.65)",
    white: "#16213e",
    border: "rgba(232,232,240,0.12)",
    sidebarBg: "#0f3460",
  } : {
    canvas: COLORS.canvas,
    ink: COLORS.ink,
    frame: COLORS.frame,
    mutedInk: COLORS.mutedInk,
    white: COLORS.white,
    border: COLORS.border,
    sidebarBg: COLORS.frame,
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

        // AUDIO resolve
        if (data.generated_audio_tracks && data.generated_audio_tracks.length > 0) {
            const resolvedTracks = [];
        
            for (const track of data.generated_audio_tracks) {
            const url = await getDownloadURL(ref(storage, track.storage_path));
            resolvedTracks.push({
                ...track,
                url
            });
            }
        
            if (!cancelled) {
            setAudioTracks(resolvedTracks);
            setCurrentTrackIndex(0);
            setAudioUrl(resolvedTracks[0]?.url || null);
            }
        
        } else if (data.librivox_audio_tracks && data.librivox_audio_tracks.length > 0) {
            const resolvedTracks = [];
        
            for (const track of data.librivox_audio_tracks) {
            const url = await getDownloadURL(ref(storage, track.storage_path));
            resolvedTracks.push({
                ...track,
                url
            });
            }
        
            if (!cancelled) {
            setAudioTracks(resolvedTracks);
            setCurrentTrackIndex(0);
            setAudioUrl(resolvedTracks[0]?.url || null);
            }
        
        } else if (data.audio_storage_path) {
            const url = await getDownloadURL(ref(storage, data.audio_storage_path));
            if (!cancelled) setAudioUrl(url);
        
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
  
    const onEnded = () => {
      if (currentTrackIndex + 1 < audioTracks.length) {
        const next = currentTrackIndex + 1;
        setCurrentTrackIndex(next);
        setAudioUrl(audioTracks[next].url);
      }
    };
  
    a.addEventListener("ended", onEnded);
    return () => a.removeEventListener("ended", onEnded);
  }, [audioTracks, currentTrackIndex]);

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
        spread: spread,
        allowScriptedContent: true,
      })
      renditionRef.current = rendition;
      rendition.themes.default({
      body: {
        "font-family": '"Libre Baskerville", Georgia, serif !important',
        "color": `${darkMode ? "#e8e8f0" : COLORS.ink} !important`,
        "background-color": `${darkMode ? "#1a1a2e" : COLORS.canvas} !important`,
        "line-height": "1.7",
        
      },
      
      "p, span, div, section, article": {
        "font-family": '"Libre Baskerville", Georgia, serif !important',
        "line-height": "1.7",
        "color": "inherit !important",
        "font-size": "inherit !important", 
      },
      
      "h1, h2, h3, h4": {
        "color": "inherit !important",
        "font-family": '"Merriweather", serif !important',
      },
      
      "*": { 
        "color": `${darkMode ? "#e8e8f0" : COLORS.ink} !important`,
      },
    });

      rendition.on("relocated", (location) => {
        console.log("[relocated]", JSON.stringify(location, null, 2));
        const pct = location?.start?.percentage;
        if (typeof pct === "number" && !isNaN(pct)) {
          setProgress(Math.round(pct * 100));
        }
        // Page numbers via epubjs locations
        if (location?.start?.location) {
          setCurrentPage(location.start.location);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epubFile, epubUrl, darkMode]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.spread(spread);
  }, [spread]);

  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.default({
      body: {
        "background-color": `${darkMode ? "#1a1a2e" : COLORS.canvas} !important`,
        color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important`,
        "line-height": "1.7",
        "font-family": '"Libre Baskerville", Georgia, serif !important',
      },
      p: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      span: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      div: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      h1: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      h2: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      h3: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      h4: { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
      a: { color: `${darkMode ? "#7ec8e3" : COLORS.frame} !important` },
      "*": { color: `${darkMode ? "#e8e8f0" : COLORS.ink} !important` },
    });
    const loc = renditionRef.current.currentLocation();
    if (loc?.start?.cfi) {
      renditionRef.current.display(loc.start.cfi);
    }
  }, [darkMode]);
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

  const sideBtnStyle = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    zIndex: 10,
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: darkMode ? "rgba(230,126,126,0.85)" : COLORS.spark,
    color: "#fff",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    transition: "all 0.2s ease",
  };

  const btnStyle = {
    ...styles.btn,
    background: darkMode ? "rgba(230,126,126,0.55)" : COLORS.spark,
    boxShadow: darkMode ? "0 4px 10px rgba(230,126,126,0.12)" : "0 4px 10px rgba(230,126,126,0.25)",
    
    height: 32,           // Standardized height
    padding: "0 12px",    // Horizontal padding

    borderRadius: 8,     // Matches top bar rounding
    fontWeight: 500,
    fontSize: 12,

    border: "none",
    
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FONTS.ui,
    
    cursor: "pointer",
    transition: "all 0.3s ease",
  };
  // ---------------- UI ----------------
  return (
    <div style={{ ...styles.page, background: THEME.canvas, color: THEME.ink }}>
      <div style={{
        position: "fixed",
        top: 16,
        right: 16,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: THEME.white,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: "10px 12px",
        boxShadow: "0 4px 14px rgba(18,38,48,0.08)",
        zIndex: 9999,
        pointerEvents: "auto",
      }}>
        <button
          onClick={() => navigate("/")}
          onMouseEnter={() => setHoverBookshelf(true)}
          onMouseLeave={() => setHoverBookshelf(false)}
          style={{
            background: COLORS.frame,
            color: COLORS.white,
            border: "none",
            borderRadius: 12,
            
            width: "auto", 
            height: 42,
            
            padding: "0 16px",

            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",

            fontFamily: FONTS.ui,
            fontWeight: 600,
            fontSize: 13,
            whiteSpace: "nowrap",

            transition: "all 0.3s ease",
            transform: hoverBookshelf ? "translateY(-3px)" : "translateY(0)",
            boxShadow: hoverBookshelf
              ? "0 8px 20px rgba(26, 75, 93, 0.4)"
              : "0 2px 8px rgba(18, 38, 48, 0.08)",
          }}
        >
          
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
              xmlns="http://www.w3.org/2000/svg">
            <path d="M3 10.5L12 3L21 10.5" 
                  stroke="white" 
                  stroke-width="2" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
                  
            <path d="M5 10V20H19V10" 
                  stroke="white" 
                  stroke-width="2" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
                  
            <path d="M10 20V14H14V20" 
                  stroke="white" 
                  stroke-width="2" 
                  stroke-linecap="round" 
                  stroke-linejoin="round"/>
          </svg>
          <span>My Bookshelf</span>
        </button>
        
        <span style={{
          fontSize: 12,
          color: THEME.mutedInk,
          maxWidth: 280,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: FONTS.ui,
        }}>
          {user ? user.email : "Guest"}
        </span>

        <button
          onClick={logout}
          onMouseEnter={() => setIsLogoutHovered(true)}
          onMouseLeave={() => setIsLogoutHovered(false)}
          style={{
            background: COLORS.frame, 
            color: COLORS.white,
            fontFamily: FONTS.ui,
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1,
            border: "none",
            borderRadius: 12,
            width: 42,
            height: 42,
            padding: 0,//"10px 12px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",

            transition: "all 0.3s ease",
            transform: isLogoutHovered ? "translateY(-3px)" : "translateY(0)",
            boxShadow: isLogoutHovered 
              ? "0 8px 20px rgba(26, 75, 93, 0.4)" 
              : "0 2px 8px rgba(18, 38, 48, 0.08)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
        </button>

        <button
          onClick={() => setDarkMode(d => !d)}
          onMouseEnter={() => setHoverDarkMode(true)}
          onMouseLeave={() => setHoverDarkMode(false)}
          style={{
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
            lineHeight: 1,
            transition: "all 0.3s ease",
            transform: hoverDarkMode ? "translateY(-3px)" : "translateY(0)",
            boxShadow: hoverDarkMode
              ? darkMode
                ? "0 8px 20px rgba(242, 201, 76, 0.5)"
                : "0 8px 20px rgba(26, 75, 93, 0.4)"
              : "0 2px 8px rgba(18, 38, 48, 0.08)",
          }}
        >
          {darkMode ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

      <h1 style={{ ...styles.title, color: THEME.ink }}>Reader</h1>
      <p style={{ ...styles.subtitle, color: THEME.mutedInk }}>
        {status}
        {remoteBook?.title ? ` — ${remoteBook.title}` : ""}
      </p>

      <div style={styles.grid}>
        {/* LEFT: Reader */}
        <div style={{ 
          ...styles.readerCard, 
          background: THEME.white, 
          border: `1px solid ${THEME.border}` 
        }}>
          <div style={{ ...styles.readerTopBar, background: THEME.canvas }}>
            
            

            <button 
              onClick={saveCurrentBook}
              onMouseEnter={() => setHoverSave(true)}
              onMouseLeave={() => setHoverSave(false)}
              style={{
                ...btnStyle,
                transform: hoverSave ? "translateY(-3px)" : "translateY(0)",
                boxShadow: hoverSave ? "0 8px 20px rgba(230, 126, 126, 0.4)" : styles.btn.boxShadow,
                transition: "all 0.2s ease"
              }}
            >
              Save to Bookshelf
            </button>

            <div style={{ 
              ...styles.progress, 
              display: "flex", 
              flexDirection: "column", 
              gap: 4, 
              minWidth: 180,
              color: THEME.ink,
              background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)",
              border: darkMode ? "1px solid rgba(242,201,76,0.25)" : `1px solid ${COLORS.border}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span><b>Page</b> {currentPage}{totalPages > 0 ? ` / ${totalPages}` : ""}</span>
                <span><b>{progress}%</b></span>
              </div>
              <div style={{
                height: 6,
                borderRadius: 999,
                background: "rgba(18,38,48,0.12)",
                overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: darkMode ? COLORS.status : COLORS.frame,
                  borderRadius: 999,
                  transition: "width 0.4s ease",
                }} />
              </div>
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setFontSize(f => Math.max(60, f - 10))}
                onMouseEnter={() => setHoverFontDec(true)}
                onMouseLeave={() => setHoverFontDec(false)}
                style={{
                  ...btnStyle,
                  padding: "6px 10px",
                  fontSize: 16,
                  transform: hoverFontDec ? "translateY(-3px)" : "translateY(0)",
                  boxShadow: hoverFontDec ? "0 8px 20px rgba(230, 126, 126, 0.4)" : styles.btn.boxShadow,
                  transition: "all 0.2s ease"
                }}
              >A−</button>
              <span style={{ fontSize: 12, color: THEME.ink, fontFamily: FONTS.ui }}>{fontSize}%</span>
              <button
                onClick={() => setFontSize(f => Math.min(200, f + 10))}
                onMouseEnter={() => setHoverFontInc(true)}
                onMouseLeave={() => setHoverFontInc(false)}
                style={{
                  ...btnStyle,
                  padding: "6px 10px",
                  fontSize: 16,
                  transform: hoverFontInc ? "translateY(-3px)" : "translateY(0)",
                  boxShadow: hoverFontInc ? "0 8px 20px rgba(230, 126, 126, 0.4)" : styles.btn.boxShadow,
                  transition: "all 0.2s ease"
                }}
              >A+</button>
            </div>
            
            <div style={{ 
              display: "flex", 
              gap: 4, 
              background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)", 
              borderRadius: 8, 
              padding: 3,
              border: darkMode ? "1px solid rgba(242,201,76,0.25)" : "1px solid rgba(18,38,48,0.12)", 
              }}
            >
              <button
                onClick={() => setSpread("none")}
                onMouseEnter={() => setHoverSinglePage(true)}
                onMouseLeave={() => setHoverSinglePage(false)}
                style={{
                  ...styles.btn,
                  padding: "6px 10px",
                  background: spread === "none"
                    ? (darkMode ? COLORS.status : COLORS.frame)
                    : "transparent",
                  color: spread === "none" ? COLORS.white : COLORS.ink,
                  boxShadow: hoverSinglePage && spread !== "none"
                    ? "0 8px 20px rgba(26, 75, 93, 0.4)"
                    : "none",
                  transform: hoverSinglePage && spread !== "none" ? "translateY(-3px)" : "translateY(0)",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Single page"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="4" y="2" width="10" height="14" rx="1.5"
                    fill={spread === "none" ? (darkMode ? COLORS.ink : COLORS.white) : (darkMode ? "#e8e8f0" : COLORS.ink)} />
                </svg>
              </button>

              <button
                onClick={() => setSpread("always")}
                onMouseEnter={() => setHoverDoublePage(true)}
                onMouseLeave={() => setHoverDoublePage(false)}
                style={{
                  ...styles.btn,
                  padding: "6px 10px",
                  background: spread === "always"
                    ? (darkMode ? COLORS.status : COLORS.frame)
                    : "transparent",
                  color: spread === "always" ? COLORS.white : COLORS.ink,
                  boxShadow: hoverDoublePage && spread !== "always"
                    ? "0 8px 20px rgba(26, 75, 93, 0.4)"
                    : "none",
                  transform: hoverDoublePage && spread !== "always" ? "translateY(-3px)" : "translateY(0)",
                  transition: "all 0.2s ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Two pages"
              >
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
                  <rect x="1" y="2" width="9" height="14" rx="1.5"
                    fill={spread === "always" ? (darkMode ? COLORS.ink : COLORS.white) : (darkMode ? "#e8e8f0" : COLORS.ink)} />
                  <rect x="12" y="2" width="9" height="14" rx="1.5"
                    fill={spread === "always" ? (darkMode ? COLORS.ink : COLORS.white) : (darkMode ? "#e8e8f0" : COLORS.ink)} />
                </svg>
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

          <div style={{ position: "relative", width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>
            {/* Floating Prev Button */}
            <button 
              onClick={prevPage}
              onMouseEnter={() => setHoverPrev(true)}
              onMouseLeave={() => setHoverPrev(false)}
              style={{
                ...sideBtnStyle,
                left: 15, 
                opacity: hoverPrev ? 1 : 0.3,
              }}  
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6"></polyline>
              </svg>
            </button>

            {/* THE ACTUAL BOOK TEXT AREA */}
            <div 
              ref={viewerRef} 
              style={{ 
                ...styles.viewer, 
                background: THEME.canvas, 
                borderLeft: `6px solid ${THEME.frame}`,
                flex: 1 
              }} 
            />

            {/* Floating Next Button */}
            <button 
              onClick={nextPage}
              onMouseEnter={() => setHoverNext(true)}
              onMouseLeave={() => setHoverNext(false)}
              style={{
                ...sideBtnStyle,
                right: 15,
                opacity: hoverNext ? 1 : 0.3,
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          </div>
        </div>

        {/* RIGHT: Sidebar */}
        <div style={styles.sidebarCard}>
            <h2 style={styles.h2}>Audio</h2>

            {audioTracks.length > 0 && (
            <select
                value={currentTrackIndex}
                onChange={(e) => {
                const idx = Number(e.target.value);
                setCurrentTrackIndex(idx);
                setAudioUrl(audioTracks[idx].url);
                }}
                style={{
                width: "100%",
                marginBottom: 10,
                padding: 8,
                borderRadius: 10
                }}
            >
                {audioTracks.map((track, idx) => (
                <option key={track.index} value={idx}>
                    Chapter {track.index}
                </option>
                ))}
            </select>
            )}

            <input
            type="file"
            accept="audio/*"
            onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
            style={{
                marginBottom: 10,
                color: "#fff",
            }}
            />
            {audioTracks.length > 0 && (
                <select
                    value={currentTrackIndex}
                    onChange={(e) => {
                    const idx = Number(e.target.value);
                    setCurrentTrackIndex(idx);
                    setAudioUrl(audioTracks[idx].url);
                    }}
                    style={{
                    width: "100%",
                    marginBottom: 10,
                    padding: 8,
                    borderRadius: 10
                    }}
                >
                    {audioTracks.map((track, idx) => (
                    <option key={track.index} value={idx}>
                        {track.title || `Chapter ${track.index}`}
                    </option>
                    ))}
                </select>
                )}
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
    display: "flex",        // Add this
    flexDirection: "column", // Add this
    minHeight: "80vh",      // Add this to give it vertical room
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