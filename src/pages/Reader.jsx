import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db, storage, auth } from "../firebase";
import { ref, getDownloadURL } from "firebase/storage";
import { useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";
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
};

export default function Reader({ darkMode, setDarkMode }) {
  const { bookId } = useParams();
  const navigate = useNavigate();

  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);
  const audioRef = useRef(null);
  const allSpinePageCountsRef = useRef({});
  const isCountingRef = useRef(false);

  const [bookTotalPages, setBookTotalPages] = useState(0);
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("Upload an EPUB and an MP3 to begin.");

  const [remoteBook, setRemoteBook] = useState(null);

  const [epubFile, setEpubFile] = useState(null);
  const [epubUrl, setEpubUrl] = useState(null);

  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioTracks, setAudioTracks] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [toc, setToc] = useState([]);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const [fontSize, setFontSize] = useState(100);
  const [fontFamily, setFontFamily] = useState('"Libre Baskerville", Georgia, serif');
  const [spread, setSpread] = useState("none");
  const fontFamilyRef = useRef(fontFamily);
  const fontSizeRef = useRef(fontSize);
  const darkModeRef = useRef(darkMode);

  const [hoverPrev, setHoverPrev] = useState(false);
  const [hoverNext, setHoverNext] = useState(false);
  const [hoverSave, setHoverSave] = useState(false);
  const [hoverBookshelf, setHoverBookshelf] = useState(false);
  const [hoverDarkMode, setHoverDarkMode] = useState(false);
  const [hoverFontDec, setHoverFontDec] = useState(false);
  const [hoverFontInc, setHoverFontInc] = useState(false);
  const [hoverSinglePage, setHoverSinglePage] = useState(false);
  const [hoverDoublePage, setHoverDoublePage] = useState(false);
  const [isLogoutHovered, setIsLogoutHovered] = useState(false);
  const [locationsReady, setLocationsReady] = useState(false);
  const [isCountingPages, setIsCountingPages] = useState(false);
  const [hoveredFont, setHoveredFont] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [currentCfi, setCurrentCfi] = useState(null);
  const [hoverBookmark, setHoverBookmark] = useState(false);

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

  const mmss = useMemo(() => {
    const s = Math.floor(currentTime);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, "0")}`;
  }, [currentTime]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);
  useEffect(() => {
    fontFamilyRef.current = fontFamily;
    fontSizeRef.current = fontSize;
    darkModeRef.current = darkMode;
  }, [fontFamily, fontSize, darkMode]);

  useEffect(() => {
    if (!bookId) return;
    try {
      const saved = localStorage.getItem(`bookmarks_${bookId}`);
      if (saved) setBookmarks(JSON.parse(saved));
    } catch {}
  }, [bookId]);

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

        if (data.generated_audio_tracks?.length > 0) {
          const resolvedTracks = [];
          for (const track of data.generated_audio_tracks) {
            const url = await getDownloadURL(ref(storage, track.storage_path));
            resolvedTracks.push({ ...track, url });
          }
          if (!cancelled) {
            setAudioTracks(resolvedTracks);
            setCurrentTrackIndex(0);
            setAudioUrl(resolvedTracks[0]?.url || null);
          }
        } else if (data.librivox_audio_tracks?.length > 0) {
          const resolvedTracks = [];
          for (const track of data.librivox_audio_tracks) {
            const url = await getDownloadURL(ref(storage, track.storage_path));
            resolvedTracks.push({ ...track, url });
          }
          if (!cancelled) {
            setAudioTracks(resolvedTracks);
            setCurrentTrackIndex(0);
            setAudioUrl(resolvedTracks[0]?.url || null);
          }
        } else if (data.audio_storage_path) {
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
        setStatus("Failed to load book.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, bookId]);

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

    const onTime = () => setCurrentTime(a.currentTime || 0);

    a.addEventListener("ended", onEnded);
    a.addEventListener("timeupdate", onTime);

    return () => {
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("timeupdate", onTime);
    };
  }, [audioTracks, currentTrackIndex]);

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

  const activeSyncItem =
    activeSyncIndex >= 0 && activeSyncIndex < syncData.length
      ? syncData[activeSyncIndex]
      : null;

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

  const logout = async () => {
    const confirmed = window.confirm("Are you sure you want to log out?");
    if (!confirmed) return;

    try {
      await signOut(auth);
      navigate("/");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const saveCurrentBook = async () => {
    if (!user) {
      alert("Please log in first.");
      return;
    }
    if (!epubFile) {
      alert("Upload an EPUB first.");
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
      alert("Save failed.");
    }
  };

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

  const destroyReader = () => {
    try {
      renditionRef.current?.destroy?.();
    } catch {}
    renditionRef.current = null;

    try {
      bookRef.current?.destroy?.();
    } catch {}
    bookRef.current = null;

    if (viewerRef.current) viewerRef.current.innerHTML = "";
    setToc([]);
    setProgress(0);
    setCurrentPage(0);
    setTotalPages(0);
  };

  const isGutenberg = (url) =>
    typeof url === "string" && url.includes("gutenberg.org");

  const getEpubArrayBuffer = async () => {
    if (epubUrl) {
      const finalUrl = isGutenberg(epubUrl)
        ? `/epub-proxy?url=${encodeURIComponent(epubUrl)}`
        : epubUrl;

      console.log("Fetching EPUB from:", finalUrl);

      const res = await fetch(finalUrl);
      if (!res.ok) {
        const text = await res.text();
        console.error("EPUB proxy response body:", text);
        throw new Error(`Failed to fetch EPUB: ${res.status} - ${text}`);
      }

      return await res.arrayBuffer();
    }

    if (epubFile) return await epubFile.arrayBuffer();
    return null;
  };

  const forceVisibleContents = () => {
    const contentsArr = renditionRef.current?.getContents?.() || [];
  
    contentsArr.forEach((contents) => {
      try {
        const doc = contents.document;
        const html = doc.documentElement;
        const body = doc.body;
        if (!body) return;
  
        const isDark = darkModeRef.current;
        const currentFontFamily = fontFamilyRef.current;
        const currentFontSize = fontSizeRef.current;
  
        html.style.background = isDark ? "#1a1a2e" : COLORS.canvas;
        html.style.color = isDark ? "#e8e8f0" : "#122630";
  
        body.style.background = isDark ? "#1a1a2e" : COLORS.canvas;
        body.style.color = isDark ? "#e8e8f0" : "#122630";
        body.style.fontFamily = currentFontFamily;
        body.style.lineHeight = "1.7";
        body.style.fontSize = `${currentFontSize}%`;
        body.style.margin = "0";
        body.style.padding = "24px";
        body.style.maxWidth = "none";
        body.style.width = "auto";
        body.style.opacity = "1";
        body.style.visibility = "visible";
        body.style.display = "block";
  
        const all = body.querySelectorAll("*");
        all.forEach((el) => {
          el.style.color = isDark ? "#e8e8f0" : "#122630";
          el.style.backgroundColor = "transparent";
          el.style.opacity = "1";
          el.style.visibility = "visible";
          el.style.textIndent = "0";
          el.style.maxWidth = "none";
          el.style.fontSize = "";
        });
      } catch (e) {
        console.warn("forceVisibleContents failed:", e);
      }
    });
  };

  const applyTheme = (renditionInstance) => {
    renditionInstance.themes.default({
      body: {
        background: darkModeRef.current ? "#1a1a2e" : COLORS.canvas,
        color: darkModeRef.current ? "#e8e8f0" : "#122630",
        "font-family": fontFamilyRef.current,
        "font-size": `${fontSizeRef.current}%`,
        "line-height": "1.7",
        margin: "0",
        padding: "24px",
      },
      p: {
        "line-height": "1.7",
        "font-size": "1em",
      },
      div: { "font-size": "1em" },
      span: { "font-size": "1em" },
    });
  
    renditionInstance.themes.font(fontFamilyRef.current);
    renditionInstance.themes.fontSize(`${fontSizeRef.current}%`);
  };

  const displayFirstWorkingSpineItem = async (book, rendition) => {
    const spineItems = book?.spine?.items || [];
    log("spine items:", spineItems.length);

    let lastErr = null;

    for (let i = 0; i < spineItems.length; i++) {
      const item = spineItems[i];
      const href = item?.href;
      if (!href || typeof href !== "string") continue;

      try {
        log(`TRY display idx=${i} href=`, href);
        await rendition.display(href);

        const contents = rendition.getContents?.() || [];
        const text = contents
          .map((c) => c?.document?.body?.innerText || "")
          .join(" ")
          .trim();

        if (text.length > 20) {
          log("SUCCESS display href:", href);
          return href;
        }

        log("Displayed but blank-ish, continuing:", href);
      } catch (err) {
        lastErr = err;
        console.error("[Bookcover/EPUB] display failed for", href, err);
      }
    }

    throw lastErr || new Error("Failed to display any readable spine item.");
  };

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
      try {
        setStatus("Loading EPUB…");

        const buf = await getEpubArrayBuffer();
        if (!buf || cancelled) return;

        const book = ePub(buf);
        bookRef.current = book;
        await book.ready;

        if (cancelled) return;

        await book.ready;
        book.locations.generate(1000).then(() => {
          setLocationsReady(true);
        });

        const rendition = book.renderTo(el, {
          width: "100%",
          height: "100%",
          allowScriptedContent: true,
          manager: "default",
          flow: "paginated",
          spread,
        });

        renditionRef.current = rendition;

        rendition.hooks.content.register((contents) => {
          try {
            const doc = contents.document;
            const html = doc.documentElement;
            const body = doc.body;
            if (!body) return;
        
            const isDark = darkModeRef.current;
            const currentFontFamily = fontFamilyRef.current;
            const currentFontSize = fontSizeRef.current;
        
            html.style.background = isDark ? "#1a1a2e" : COLORS.canvas;
            html.style.color = isDark ? "#e8e8f0" : "#122630";
        
            body.style.background = isDark ? "#1a1a2e" : COLORS.canvas;
            body.style.color = isDark ? "#e8e8f0" : "#122630";
            body.style.fontFamily = currentFontFamily;
            body.style.fontSize = `${currentFontSize}%`;
            body.style.lineHeight = "1.7";
            body.style.margin = "0";
            body.style.padding = "24px";
            body.style.maxWidth = "none";
            body.style.width = "auto";
          } catch (e) {
            console.warn("Failed to apply iframe styles:", e);
          }
        });

        applyTheme(rendition);

        rendition.on("relocated", (location) => {
          if (isCountingRef.current) return;

          const page = location?.start?.displayed?.page;
          const spineIndex = location?.start?.index ?? 0;

          const spineItems = bookRef.current?.spine?.items || [];
          let offset = 0;
          for (let i = 0; i < spineIndex; i++) {
            offset += allSpinePageCountsRef.current[i] || 0;
          }
          const globalPage = offset + (page || 0);
          setCurrentPage(globalPage);

          const cfi = location?.start?.cfi;
          if (cfi) setCurrentCfi(cfi);

          const grandTotal = spineItems.reduce(
            (sum, _, i) => sum + (allSpinePageCountsRef.current[i] || 0),
            0
          );

          if (grandTotal > 0) {
            setTotalPages(grandTotal);
            setBookTotalPages(grandTotal);
            setProgress(Math.round((globalPage / grandTotal) * 100));
          } else {
            const cfi = location?.start?.cfi;
            if (cfi && bookRef.current?.locations?.percentageFromCfi) {
              try {
                const pct = bookRef.current.locations.percentageFromCfi(cfi);
                if (typeof pct === "number" && !isNaN(pct)) {
                  setProgress(Math.round(pct * 100));
                }
              } catch {}
            }
          }

          if (activeSyncItem?.sentence) {
            setTimeout(() => {
              highlightActiveSentenceInView(activeSyncItem.sentence);
            }, 100);
          }
        });

        try {
          const nav = await book.loaded.navigation;
          setToc(nav?.toc || []);
        } catch {
          setToc([]);
        }

        await displayFirstWorkingSpineItem(book, rendition);
        forceVisibleContents();

        const spineItems = book?.spine?.items || [];
        const alreadyCounted = Object.keys(allSpinePageCountsRef.current).length > 0;

        if (!alreadyCounted) {
          setStatus("Counting pages…");
          setIsCountingPages(true);
          isCountingRef.current = true;

          const savedLocation = renditionRef.current?.currentLocation?.();

          for (let i = 0; i < spineItems.length; i++) {
            const href = spineItems[i]?.href;
            if (!href) continue;
            try {
              await rendition.display(href);
              const loc = renditionRef.current?.currentLocation?.();
              const total = loc?.start?.displayed?.total;
              if (total) allSpinePageCountsRef.current[i] = total;
            } catch {}
          }

          if (savedLocation?.start?.cfi) {
            await rendition.display(savedLocation.start.cfi);
          } else {
            await displayFirstWorkingSpineItem(book, rendition);
          }

          forceVisibleContents();
          isCountingRef.current = false;
          setIsCountingPages(false);
        }

        const grandTotal = spineItems.reduce(
          (sum, _, i) => sum + (allSpinePageCountsRef.current[i] || 0),
          0
        );
        setBookTotalPages(grandTotal);
        setTotalPages(grandTotal);

        const contents = rendition.getContents?.() || [];
        console.log(
          "Rendered contents text preview:",
          contents.map((c) => c?.document?.body?.innerText?.slice(0, 200)).join(" | ")
        );

        if (!cancelled) setStatus("EPUB loaded.");
      } catch (err) {
        console.error("[Bookcover/EPUB] LOAD ERROR:", err);
        if (!cancelled) setStatus(`Failed to display EPUB: ${err.message}`);
      }
    })();

    return () => {
      cancelled = true;
      destroyReader();
    };
  }, [epubFile, epubUrl, darkMode]);

  useEffect(() => {
    if (!renditionRef.current) return;
    const loc = renditionRef.current.currentLocation?.();
    const cfi = loc?.start?.cfi;
    renditionRef.current.spread(spread);
    if (cfi) {
      setTimeout(() => {
        renditionRef.current?.display(cfi).then(() => forceVisibleContents());
      }, 100);
    }
  }, [spread]);

  useEffect(() => {
    if (!renditionRef.current) return;
    applyTheme(renditionRef.current);
    forceVisibleContents();

    try {
      renditionRef.current.spread(spread);
    } catch {}
  }, [darkMode, fontSize, spread, fontFamily]);

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

  const toggleBookmark = () => {
    if (!currentCfi) return;
    const already = bookmarks.find((b) => b.cfi === currentCfi || b.page === currentPage);
    let updated;
    if (already) {
      updated = bookmarks.filter((b) => b.cfi !== currentCfi);
    } else {
      const label = toc.find((t) => t.href)?.label || "";
      updated = [
        ...bookmarks,
        {
          cfi: currentCfi,
          page: currentPage,
          chapter: label,
          savedAt: Date.now(),
        },
      ];
    }
    setBookmarks(updated);
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(updated));
  };

  const deleteBookmark = (cfi) => {
    const updated = bookmarks.filter((b) => b.cfi !== cfi);
    setBookmarks(updated);
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(updated));
  };

  const jumpToBookmark = async (cfi) => {
    try {
      await renditionRef.current?.display(cfi);
      forceVisibleContents();
    } catch (e) {
      console.error("[Reader] jumpToBookmark failed:", e);
    }
  };

  const goToToc = async (href) => {
    if (!href) return;
    try {
      await renditionRef.current?.display(href);
      forceVisibleContents();
    } catch (e) {
      console.error("[Bookcover/EPUB] toc display error:", e);
    }
  };

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
    boxShadow: darkMode
      ? "0 4px 10px rgba(230,126,126,0.12)"
      : "0 4px 10px rgba(230,126,126,0.25)",
    height: 32,
    padding: "0 12px",
    borderRadius: 8,
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

  return (
    <div style={{ ...styles.page, background: THEME.canvas, color: THEME.ink }}>
      <div
        style={{
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
        }}
      >
        <button
          onClick={() => navigate("/")}
          onMouseEnter={() => setHoverBookshelf(true)}
          onMouseLeave={() => setHoverBookshelf(false)}
          style={{
            background: COLORS.frame,
            color: COLORS.white,
            border: "none",
            borderRadius: 12,
            height: 42,
            padding: "0 16px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 10.5L12 3L21 10.5"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 10V20H19V10"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 20V14H14V20"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>My Bookshelf</span>
        </button>

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
            padding: 0,
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
        </button>

        <button
          onClick={() => setDarkMode((d) => !d)}
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
            gap: 6,
            cursor: "pointer",
            fontFamily: FONTS.ui,
            fontWeight: 600,
            fontSize: 13,
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
        <div
          style={{
            ...styles.readerCard,
            background: THEME.white,
            border: `1px solid ${THEME.border}`,
          }}
        >
          <div style={{ ...styles.readerTopBar, background: THEME.canvas }}>
            <button
              onClick={saveCurrentBook}
              onMouseEnter={() => setHoverSave(true)}
              onMouseLeave={() => setHoverSave(false)}
              style={{
                ...btnStyle,
                transform: hoverSave ? "translateY(-3px)" : "translateY(0)",
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
                background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)",
                border: darkMode
                  ? "1px solid rgba(242,201,76,0.25)"
                  : `1px solid ${COLORS.border}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>
                  <b>Page</b>{" "}
                  {isCountingPages
                    ? "Loading…"
                    : `${currentPage} / ${bookTotalPages > 0 ? bookTotalPages : "…"}`}
                </span>
                <span>
                  <b>{isCountingPages ? "—" : `${progress}%`}</b>
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
                    width: isCountingPages ? "0%" : `${progress}%`,
                    background: darkMode ? COLORS.status : COLORS.frame,
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
            
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)",
                borderRadius: 8,
                padding: 3,
                border: darkMode
                  ? "1px solid rgba(242,201,76,0.25)"
                  : "1px solid rgba(18,38,48,0.12)",
              }}
            >
              {[
                { label: "Serif", value: '"Libre Baskerville", Georgia, serif', font: "Georgia, serif" },
                { label: "Sans",  value: "Verdana, sans-serif",                  font: "Verdana, sans-serif" },
                { label: "Slab",  value: "Rockwell, 'Rockwell Extra Bold', serif", font: "Rockwell, Georgia, serif" },
              ].map(({ label, value, font }) => {
                const active = fontFamily === value;
                return (
                  <button
                    key={value}
                    onClick={() => setFontFamily(value)}
                    onMouseEnter={() => setHoveredFont(value)}
                    onMouseLeave={() => setHoveredFont(null)}
                    style={{
                      fontFamily: font,
                      fontSize: 13,
                      fontWeight: 500,
                      lineHeight: "1",
                      padding: "5px 11px",
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      background: active
                        ? darkMode ? COLORS.status : COLORS.frame
                        : "transparent",
                      color: active
                        ? darkMode ? COLORS.ink : COLORS.white
                        : THEME.ink,
                      transform: hoveredFont === value && !active ? "translateY(-3px)" : "translateY(0)",
                      boxShadow: hoveredFont === value && !active
                        ? darkMode
                          ? "0 8px 20px rgba(242, 201, 76, 0.3)"
                          : "0 8px 20px rgba(26, 75, 93, 0.25)"
                        : "none",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setFontSize((f) => Math.max(60, f - 10))}
                onMouseEnter={() => setHoverFontDec(true)}
                onMouseLeave={() => setHoverFontDec(false)}
                style={{
                  ...btnStyle,
                  padding: "6px 10px",
                  fontSize: 16,
                  transform: hoverFontDec ? "translateY(-3px)" : "translateY(0)",
                }}
              >
                A−
              </button>
              <span style={{ fontSize: 12, color: THEME.ink, fontFamily: FONTS.ui }}>
                {fontSize}%
              </span>
              <button
                onClick={() => setFontSize((f) => Math.min(200, f + 10))}
                onMouseEnter={() => setHoverFontInc(true)}
                onMouseLeave={() => setHoverFontInc(false)}
                style={{
                  ...btnStyle,
                  padding: "6px 10px",
                  fontSize: 16,
                  transform: hoverFontInc ? "translateY(-3px)" : "translateY(0)",
                }}
              >
                A+
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 4,
                background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)",
                borderRadius: 8,
                padding: 3,
                border: darkMode
                  ? "1px solid rgba(242,201,76,0.25)"
                  : "1px solid rgba(18,38,48,0.12)",
              }}
            >
              <button
                onClick={() => setSpread("none")}
                onMouseEnter={() => setHoverSinglePage(true)}
                onMouseLeave={() => setHoverSinglePage(false)}
                style={{
                  ...styles.btn,
                  padding: "6px 10px",
                  background:
                    spread === "none" ? (darkMode ? COLORS.status : COLORS.frame) : "transparent",
                  color: spread === "none" ? COLORS.white : COLORS.ink,
                  transform:
                    hoverSinglePage && spread !== "none"
                      ? "translateY(-3px)"
                      : "translateY(0)",
                  transition: "all 0.2s ease",
                }}
                title="Single page"
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect
                    x="4"
                    y="2"
                    width="10"
                    height="14"
                    rx="1.5"
                    fill={
                      spread === "none"
                        ? darkMode
                          ? COLORS.ink
                          : COLORS.white
                        : darkMode
                        ? "#e8e8f0"
                        : COLORS.ink
                    }
                  />
                </svg>
              </button>

              <button
                onClick={() => setSpread("always")}
                onMouseEnter={() => setHoverDoublePage(true)}
                onMouseLeave={() => setHoverDoublePage(false)}
                style={{
                  ...styles.btn,
                  padding: "6px 10px",
                  background:
                    spread === "always"
                      ? darkMode
                        ? COLORS.status
                        : COLORS.frame
                      : "transparent",
                  color: spread === "always" ? COLORS.white : COLORS.ink,
                  transform:
                    hoverDoublePage && spread !== "always"
                      ? "translateY(-3px)"
                      : "translateY(0)",
                  transition: "all 0.2s ease",
                }}
                title="Two pages"
              >
                <svg width="22" height="18" viewBox="0 0 22 18" fill="none">
                  <rect
                    x="1"
                    y="2"
                    width="9"
                    height="14"
                    rx="1.5"
                    fill={
                      spread === "always"
                        ? darkMode
                          ? COLORS.ink
                          : COLORS.white
                        : darkMode
                        ? "#e8e8f0"
                        : COLORS.ink
                    }
                  />
                  <rect
                    x="12"
                    y="2"
                    width="9"
                    height="14"
                    rx="1.5"
                    fill={
                      spread === "always"
                        ? darkMode
                          ? COLORS.ink
                          : COLORS.white
                        : darkMode
                        ? "#e8e8f0"
                        : COLORS.ink
                    }
                  />
                </svg>
              </button>
            </div>
            
            <button
              onClick={toggleBookmark}
              onMouseEnter={() => setHoverBookmark(true)}
              onMouseLeave={() => setHoverBookmark(false)}
              title={bookmarks.find((b) => b.cfi === currentCfi || b.page === currentPage) ? "Remove bookmark" : "Bookmark this page"}
              style={{
                ...btnStyle,
                padding: "6px 10px",
                background: bookmarks.find((b) => b.cfi === currentCfi || b.page === currentPage)
                  ? darkMode ? COLORS.status : COLORS.frame
                  : darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)",
                color: bookmarks.find((b) => b.cfi === currentCfi || b.page === currentPage)
                  ? darkMode ? COLORS.ink : COLORS.white
                  : THEME.ink,
                border: bookmarks.find((b) => b.cfi === currentCfi || b.page === currentPage)
                  ? "none"
                  : darkMode ? "1px solid rgba(242,201,76,0.25)" : `1px solid ${COLORS.border}`,
                transform: hoverBookmark ? "translateY(-3px)" : "translateY(0)",
                boxShadow: hoverBookmark
                  ? darkMode ? "0 8px 20px rgba(242,201,76,0.3)" : "0 8px 20px rgba(26,75,93,0.25)"
                  : "none",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={bookmarks.find((b) => b.cfi === currentCfi || b.page === currentPage) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            <label
              style={{
                ...styles.fileLabel,
                color: THEME.ink,
                background: darkMode ? "rgba(255,255,255,0.08)" : "rgba(18,38,48,0.06)",
                border: darkMode
                  ? "1px solid rgba(242,201,76,0.25)"
                  : `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 3,
                gap: 4,
              }}
            >
              <span style={{ padding: "6px 10px" }}>Text (EPUB)</span>
              <input
                type="file"
                accept=".epub"
                onChange={(e) => setEpubFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div
            style={{
              position: "relative",
              width: "100%",
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0",
              boxSizing: "border-box",
            }}
          >
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
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div style={{ position: "relative", width: "100%", maxWidth: "100%" }}>
              <div
                ref={viewerRef}
                style={{
                  ...styles.viewer,
                  background: THEME.canvas,
                  borderLeft: `6px solid ${THEME.frame}`,
                  visibility: isCountingPages ? "hidden" : "visible",
                }}
              />
              {isCountingPages && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: THEME.canvas,
                    borderRadius: 16,
                    border: `1px solid ${THEME.border}`,
                    borderLeft: `6px solid ${THEME.frame}`,
                    fontSize: 18,
                    fontFamily: FONTS.ui,
                    color: THEME.mutedInk,
                    fontWeight: 500,
                  }}
                >
                  Loading Pages…
                </div>
              )}
            </div>

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
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

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
                borderRadius: 10,
              }}
            >
              {audioTracks.map((track, idx) => (
                <option key={track.index} value={idx}>
                  {track.title || `Chapter ${track.index}`}
                </option>
              ))}
            </select>
          )}

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

          <audio ref={audioRef} controls src={audioUrl || undefined} style={{ width: "100%" }} />

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

          <h2 style={styles.h2}>Bookmarks</h2>
          {bookmarks.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginBottom: 8 }}>
              No bookmarks yet. Use the bookmark button while reading.
            </div>
          ) : (
            <div style={{ maxHeight: 200, overflow: "auto", display: "grid", gap: 8, marginBottom: 8 }}>
              {bookmarks.map((b) => (
                <div
                  key={b.cfi}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(18,38,48,0.18)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    borderRadius: 12,
                    padding: "8px 10px",
                  }}
                >
                  <button
                    onClick={() => jumpToBookmark(b.cfi)}
                    style={{
                      flex: 1,
                      textAlign: "left",
                      background: "transparent",
                      border: "none",
                      color: COLORS.white,
                      cursor: "pointer",
                      fontFamily: FONTS.ui,
                      fontSize: 13,
                      fontWeight: 500,
                      padding: 0,
                    }}
                  >
                    Page {b.page}
                    {b.chapter ? ` · ${b.chapter}` : ""}
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>
                      {new Date(b.savedAt).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteBookmark(b.cfi)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "rgba(255,255,255,0.5)",
                      cursor: "pointer",
                      fontSize: 16,
                      lineHeight: 1,
                      padding: "2px 4px",
                      borderRadius: 4,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <hr style={styles.hr} />

          <h2 style={styles.h2}>Chapters</h2>
          {toc.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
              No TOC detected for this EPUB.
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
    background: COLORS.canvas,
    boxShadow: "0 10px 24px rgba(18,38,48,0.08)",
    display: "flex",
    flexDirection: "column",
    minHeight: "80vh",
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
    width: "100%",
    maxWidth: "100%",
    height: "82vh",
    margin: "0",
    overflow: "hidden",
    background: COLORS.canvas,
    fontFamily: '"Libre Baskerville", Georgia, serif',
    borderRadius: "0 0 20px 20px",
    boxShadow: "none",
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