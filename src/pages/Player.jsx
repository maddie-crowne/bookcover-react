import { useParams, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db, storage, auth } from "../firebase";
import { ref, getDownloadURL } from "firebase/storage";
import { useEffect, useRef, useState, useMemo } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";

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

export default function Player({ darkMode, setDarkMode }) {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const audioRef = useRef(null);

  const [user, setUser] = useState(null);
  const [remoteBook, setRemoteBook] = useState(null);
  const [audioTracks, setAudioTracks] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState("Loading…");

  // hover states for the top bar buttons, playback controls
  const [hoverBookshelf, setHoverBookshelf] = useState(false);
  const [hoverDarkMode, setHoverDarkMode] = useState(false);
  const [isLogoutHovered, setIsLogoutHovered] = useState(false);
  const [hoverPrev, setHoverPrev] = useState(false);
  const [hoverNext, setHoverNext] = useState(false);
  const [hoverPlay, setHoverPlay] = useState(false);
  const [hoverSkipBack, setHoverSkipBack] = useState(false);
  const [hoverSkipFwd, setHoverSkipFwd] = useState(false);
  
  const [playbackRate, setPlaybackRate] = useState(1);

  // audio bookmarks are stored in localStorage (keyed by bookId) so they persist between sessions
  const [audioBookmarks, setAudioBookmarks] = useState([]);
  const [hoverSpeed, setHoverSpeed] = useState(null);
  
  const [hoverAudioBookmark, setHoverAudioBookmark] = useState(false);

  const THEME = darkMode
    ? {
        canvas: "#1a1a2e",
        ink: "#e8e8f0",
        frame: "#4a9eba",
        mutedInk: "rgba(232,232,240,0.65)",
        white: "#16213e",
        border: "rgba(232,232,240,0.12)",
        cardBg: "#16213e",
        scrubberBg: "rgba(232,232,240,0.15)",
        scrubberFill: COLORS.status,
      }
    : {
        canvas: COLORS.canvas,
        ink: COLORS.ink,
        frame: COLORS.frame,
        mutedInk: COLORS.mutedInk,
        white: COLORS.white,
        border: COLORS.border,
        cardBg: COLORS.white,
        scrubberBg: "rgba(18,38,48,0.12)",
        scrubberFill: COLORS.frame,
      };

  // Firebase auth 
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // Load audio bookmarks from localStorage when the page opens
  useEffect(() => {
    if (!bookId) return;
    try {
        const saved = localStorage.getItem(`audio_bookmarks_${bookId}`);
        if (saved) setAudioBookmarks(JSON.parse(saved));
    } catch {}
    }, [bookId]);

  // Fetch book
  // fetch the book from Firestore and resolve all audio track URLs from Firebase Storage. 
  // Same 3 scenarios as the Reader: AI-generated tracks, LibriVox multi-chapter tracks, and a single uploaded file
  useEffect(() => {
    if (!user || !bookId) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus("Loading…");
        const snap = await getDoc(doc(db, "Users", user.uid, "Books", bookId));
        if (!snap.exists()) { setStatus("Book not found."); return; }

        const data = snap.data();
        if (cancelled) return;
        setRemoteBook(data);

        // Resolve audio tracks
        let tracks = [];
        if (data.generated_audio_tracks?.length > 0) {
          for (const track of data.generated_audio_tracks) {
            const url = await getDownloadURL(ref(storage, track.storage_path));
            tracks.push({ ...track, url });
          }
        } else if (data.librivox_audio_tracks?.length > 0) {
          for (const track of data.librivox_audio_tracks) {
            const url = await getDownloadURL(ref(storage, track.storage_path));
            tracks.push({ ...track, url });
          }
        } else if (data.audio_storage_path) {
          // single uploaded file is wrapped in a track object so the rest of the UI works on a track-basis
          const url = await getDownloadURL(ref(storage, data.audio_storage_path));
          tracks.push({ title: data.title || "Track 1", url, index: 0 });
        } else if (data.audio_link) {
          tracks.push({ title: data.title || "Track 1", url: data.audio_link, index: 0 });
        }

        if (!cancelled) {
          setAudioTracks(tracks);
          if (tracks.length > 0) {
            setAudioUrl(tracks[0].url);
            setCurrentTrackIndex(0);
          }
          setStatus("Ready");
        }
      } catch (e) {
        console.error("[Player] load failed:", e);
        setStatus("Failed to load.");
      }
    })();

    return () => { cancelled = true; };
  }, [user, bookId]);

  // Audio events
  // to ensure sync with the actual playback position
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onTime = () => setCurrentTime(a.currentTime || 0);
    const onDuration = () => setDuration(a.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (currentTrackIndex + 1 < audioTracks.length) {
        const next = currentTrackIndex + 1;
        setCurrentTrackIndex(next);
        setAudioUrl(audioTracks[next].url);
        setTimeout(() => audioRef.current?.play(), 100); // brief delay lets the src update before play() is called
      } else {
        setIsPlaying(false);
      }
    };

    a.addEventListener("timeupdate", onTime);
    a.addEventListener("durationchange", onDuration);
    a.addEventListener("loadedmetadata", onDuration); // some browsers only fire one of these, so we listen to both
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("durationchange", onDuration);
      a.removeEventListener("loadedmetadata", onDuration);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, [audioTracks, currentTrackIndex]);

  // Keep the audio element's playback speed = the speed button option selected
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
    }, [playbackRate]);

  // Adds or removes a bookmark at the current playback position
  const toggleAudioBookmark = () => {
    const alreadyExists = audioBookmarks.find(
        (b) => Math.abs(b.time - currentTime) < 2
    );
    let updated;
    if (alreadyExists) {
        // Uses a 2s tolerance window so you don't end up with near-duplicate bookmarks
        updated = audioBookmarks.filter((b) => Math.abs(b.time - currentTime) >= 2);
    } else {
        updated = [
        ...audioBookmarks,
        {
            time: currentTime,
            trackIndex: currentTrackIndex,
            trackTitle: currentTrack?.title || `Track ${currentTrackIndex + 1}`,
            savedAt: Date.now(),
        },
        ];
    }
    setAudioBookmarks(updated);
    localStorage.setItem(`audio_bookmarks_${bookId}`, JSON.stringify(updated));
    };

    const deleteAudioBookmark = (time, trackIndex) => {
    const updated = audioBookmarks.filter(
        (b) => !(Math.abs(b.time - time) < 2 && b.trackIndex === trackIndex)
    );
    setAudioBookmarks(updated);
    localStorage.setItem(`audio_bookmarks_${bookId}`, JSON.stringify(updated));
    };

    // jumps to a bookmarked position — if it's on a different track, switches track first + waits 300ms for the src to load before seeking
    const jumpToAudioBookmark = (b) => {
    if (b.trackIndex !== currentTrackIndex) {
        setCurrentTrackIndex(b.trackIndex);
        setAudioUrl(audioTracks[b.trackIndex].url);
        setTimeout(() => {
        if (audioRef.current) audioRef.current.currentTime = b.time;
        }, 300);
    } else {
        if (audioRef.current) audioRef.current.currentTime = b.time;
    }
    };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) a.pause();
    else a.play();
  };
  // clicking audio bar goes to that audio position proportionally
  const seek = (e) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    a.currentTime = pct * duration;
  };
  // skips forward or backward by the given number of seconds, clamped to [0, duration]
  const skip = (secs) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(duration, a.currentTime + secs));
  };

  const prevTrack = () => {
    if (currentTrackIndex > 0) {
      const prev = currentTrackIndex - 1;
      setCurrentTrackIndex(prev);
      setAudioUrl(audioTracks[prev].url);
      if (isPlaying) setTimeout(() => audioRef.current?.play(), 100);
    }
  };

  const nextTrack = () => {
    if (currentTrackIndex + 1 < audioTracks.length) {
      const next = currentTrackIndex + 1;
      setCurrentTrackIndex(next);
      setAudioUrl(audioTracks[next].url);
      if (isPlaying) setTimeout(() => audioRef.current?.play(), 100);
    }
  };

  const logout = async () => {
    const confirmed = window.confirm("Are you sure you want to log out?");
    if (!confirmed) return;
    try { await signOut(auth); navigate("/"); } catch (e) { console.error(e); }
  };

  const fmt = (secs) => {
    if (!secs || isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const currentTrack = audioTracks[currentTrackIndex];
  const coverUrl = remoteBook?.cover_url || null;
  const title = remoteBook?.title || "Untitled";
  const author = remoteBook?.author || "Unknown";

  // Button base styles
  const topBarBtnBase = {
    border: "none",
    borderRadius: 12,
    height: 42,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: FONTS.ui,
    fontWeight: 600,
    fontSize: 13,
    transition: "all 0.3s ease",
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: THEME.canvas,
      color: THEME.ink,
      fontFamily: FONTS.ui,
      display: "flex",
      flexDirection: "column",
    }}>

      {/* hidden audio element — controls are rendered manually below */}
      <audio ref={audioRef} src={audioUrl || undefined} />

      {/* PERMANENT TOP RIGHT BAR */}
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
      }}>
        <button
          onClick={() => navigate("/")}
          onMouseEnter={() => setHoverBookshelf(true)}
          onMouseLeave={() => setHoverBookshelf(false)}
          style={{
            ...topBarBtnBase,
            background: COLORS.frame,
            color: COLORS.white,
            padding: "0 16px",
            gap: 8,
            whiteSpace: "nowrap",
            transform: hoverBookshelf ? "translateY(-3px)" : "translateY(0)",
            boxShadow: hoverBookshelf ? "0 8px 20px rgba(26,75,93,0.4)" : "0 2px 8px rgba(18,38,48,0.08)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 10.5L12 3L21 10.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 10V20H19V10" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 20V14H14V20" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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
            ...topBarBtnBase,
            background: COLORS.frame,
            color: COLORS.white,
            width: 42,
            padding: 0,
            transform: isLogoutHovered ? "translateY(-3px)" : "translateY(0)",
            boxShadow: isLogoutHovered ? "0 8px 20px rgba(26,75,93,0.4)" : "0 2px 8px rgba(18,38,48,0.08)",
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
            ...topBarBtnBase,
            background: darkMode ? COLORS.status : COLORS.ink,
            color: darkMode ? COLORS.ink : COLORS.white,
            padding: "0 14px",
            gap: 6,
            transform: hoverDarkMode ? "translateY(-3px)" : "translateY(0)",
            boxShadow: hoverDarkMode
              ? darkMode ? "0 8px 20px rgba(242,201,76,0.5)" : "0 8px 20px rgba(26,75,93,0.4)"
              : "0 2px 8px rgba(18,38,48,0.08)",
          }}
        >
          {darkMode ? "☀ Light" : "☾ Dark"}
        </button>
      </div>

      {/* The main PLAYER card */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "100px 24px 40px",
      }}>
        <div style={{
          width: "100%",
          maxWidth: 480,
          background: THEME.cardBg,
          borderRadius: 28,
          boxShadow: darkMode
            ? "0 32px 80px rgba(0,0,0,0.5)"
            : "0 32px 80px rgba(18,38,48,0.14)",
          border: `1px solid ${THEME.border}`,
          padding: "36px 36px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}>

          {/* cover */}
          <div style={{
            width: 280,
            height: 280,
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: darkMode
              ? "0 20px 50px rgba(0,0,0,0.6)"
              : "0 20px 50px rgba(18,38,48,0.22)",
            marginBottom: 32,
            flexShrink: 0,
            background: coverUrl
              ? undefined
              : "linear-gradient(160deg, rgb(194,211,236) 0%, rgb(215,232,228) 55%, rgb(184,204,230) 100%)",
          }}>
            {coverUrl ? (
              <img
                src={coverUrl}
                alt="Cover"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            ) : (
              <div style={{
                width: "100%", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="rgba(18,38,48,0.25)" strokeWidth="1.5">
                  <path d="M9 18V5l12-2v13"/>
                  <circle cx="6" cy="18" r="3"/>
                  <circle cx="18" cy="16" r="3"/>
                </svg>
              </div>
            )}
          </div>

          {/* Title + author */}
          <div style={{ width: "100%", textAlign: "center", marginBottom: 24 }}>
            <div style={{
              fontFamily: FONTS.headings,
              fontSize: 22,
              fontWeight: 700,
              color: THEME.ink,
              lineHeight: 1.2,
              marginBottom: 6,
              overflow: "hidden",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
            }}>
              {currentTrack?.title && currentTrack.title !== title
                ? currentTrack.title
                : title}
            </div>
            <div style={{
              fontFamily: FONTS.ui,
              fontSize: 14,
              color: THEME.mutedInk,
              fontWeight: 400,
            }}>
              {author}
              {audioTracks.length > 1 && (
                <span style={{ marginLeft: 8, opacity: 0.6 }}>
                  — Track {currentTrackIndex + 1} of {audioTracks.length}
                </span>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ width: "100%", marginBottom: 8 }}>
            <div
              onClick={seek}
              style={{
                width: "100%",
                height: 6,
                background: THEME.scrubberBg,
                borderRadius: 999,
                cursor: "pointer",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div style={{
                position: "absolute",
                left: 0, top: 0, bottom: 0,
                width: `${progressPct}%`,
                background: THEME.scrubberFill,
                borderRadius: 999,
                transition: "width 0.1s linear",
              }} />
            </div>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 8,
              fontSize: 12,
              color: THEME.mutedInk,
              fontFamily: FONTS.ui,
            }}>
              {/* current time played on the elft, time remaining on the right */}
              <span>{fmt(currentTime)}</span>
              <span>−{fmt(duration - currentTime)}</span>
            </div>
          </div>

            {/* Bookmark button: fills solid within 2s of an existing bookmark if one was present */}
            <div style={{ width: "100%", display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
            <button
                onClick={toggleAudioBookmark}
                onMouseEnter={() => setHoverAudioBookmark(true)}
                onMouseLeave={() => setHoverAudioBookmark(false)}
                title={audioBookmarks.find((b) => Math.abs(b.time - currentTime) < 2) ? "Remove bookmark" : "Bookmark this moment"}
                style={{
                background: audioBookmarks.find((b) => Math.abs(b.time - currentTime) < 2)
                    ? darkMode ? COLORS.status : COLORS.frame
                    : THEME.scrubberBg,
                color: audioBookmarks.find((b) => Math.abs(b.time - currentTime) < 2)
                    ? darkMode ? COLORS.ink : COLORS.white
                    : THEME.mutedInk,
                border: "none",
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontFamily: FONTS.ui,
                fontWeight: 500,
                transition: "all 0.2s ease",
                transform: hoverAudioBookmark ? "translateY(-2px)" : "translateY(0)",
                boxShadow: hoverAudioBookmark
                    ? darkMode ? "0 4px 12px rgba(242,201,76,0.3)" : "0 4px 12px rgba(26,75,93,0.25)"
                    : "none",
                }}
            >
                {/* Bookmark icon: filled when selected */}
                <svg width="14" height="14" viewBox="0 0 24 24"
                fill={audioBookmarks.find((b) => Math.abs(b.time - currentTime) < 2) ? "currentColor" : "none"}
                stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                Bookmark
            </button>
            </div>

          {/* playback speed controls */}
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            marginTop: 8,
            width: "100%",
          }}>

            {/* Prev track */}
            <button
              onClick={prevTrack}
              onMouseEnter={() => setHoverPrev(true)}
              onMouseLeave={() => setHoverPrev(false)}
              disabled={currentTrackIndex === 0}
              style={{
                background: "transparent",
                border: "none",
                cursor: currentTrackIndex === 0 ? "not-allowed" : "pointer",
                opacity: currentTrackIndex === 0 ? 0.3 : 1,
                color: THEME.ink,
                padding: 8,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                transform: hoverPrev && currentTrackIndex > 0 ? "translateY(-2px)" : "translateY(0)",
              }}
              title="Previous track"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
              </svg>
            </button>

            {/* Go back 15s button */}
            <button
              onClick={() => skip(-15)}
              onMouseEnter={() => setHoverSkipBack(true)}
              onMouseLeave={() => setHoverSkipBack(false)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: THEME.ink,
                padding: 8,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                transform: hoverSkipBack ? "translateY(-2px)" : "translateY(0)",
              }}
              title="Back 15s"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.96"/>
                <text x="9" y="15" fontSize="6" fill="currentColor" stroke="none" fontFamily="Inter,sans-serif" fontWeight="700">15</text>
              </svg>
            </button>

            {/* Play / Pause button */}
            <button
              onClick={togglePlay}
              onMouseEnter={() => setHoverPlay(true)}
              onMouseLeave={() => setHoverPlay(false)}
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: darkMode ? COLORS.status : COLORS.frame,
                color: darkMode ? COLORS.ink : COLORS.white,
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: hoverPlay
                  ? darkMode ? "0 10px 28px rgba(242,201,76,0.5)" : "0 10px 28px rgba(26,75,93,0.4)"
                  : darkMode ? "0 4px 14px rgba(242,201,76,0.25)" : "0 4px 14px rgba(26,75,93,0.2)",
                transition: "all 0.2s ease",
                transform: hoverPlay ? "translateY(-3px) scale(1.05)" : "translateY(0) scale(1)",
              }}
            >
              {isPlaying ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1"/>
                  <rect x="14" y="4" width="4" height="16" rx="1"/>
                </svg>
              ) : (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 3 }}>
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              )}
            </button>

            {/* Go forward 15s button */}
            <button
              onClick={() => skip(15)}
              onMouseEnter={() => setHoverSkipFwd(true)}
              onMouseLeave={() => setHoverSkipFwd(false)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: THEME.ink,
                padding: 8,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                transform: hoverSkipFwd ? "translateY(-2px)" : "translateY(0)",
              }}
              title="Forward 15s"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-.48-3.96"/>
                <text x="9" y="15" fontSize="6" fill="currentColor" stroke="none" fontFamily="Inter,sans-serif" fontWeight="700">15</text>
              </svg>
            </button>

            {/* Next track */}
            <button
              onClick={nextTrack}
              onMouseEnter={() => setHoverNext(true)}
              onMouseLeave={() => setHoverNext(false)}
              disabled={currentTrackIndex >= audioTracks.length - 1}
              style={{
                background: "transparent",
                border: "none",
                cursor: currentTrackIndex >= audioTracks.length - 1 ? "not-allowed" : "pointer",
                opacity: currentTrackIndex >= audioTracks.length - 1 ? 0.3 : 1,
                color: THEME.ink,
                padding: 8,
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.2s ease",
                transform: hoverNext && currentTrackIndex < audioTracks.length - 1 ? "translateY(-2px)" : "translateY(0)",
              }}
              title="Next track"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 18l8.5-6L6 6v12zm8.5-6l8.5 6V6z"/>
              </svg>
            </button>
          </div>

          {/* audio playback speed options */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginTop: 20,
              width: "100%",
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: THEME.mutedInk,
                fontFamily: FONTS.ui,
                marginRight: 4,
              }}
            >
              Speed
            </span>

            {[0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => {
              const isActive = playbackRate === rate;
              const isHovered = hoverSpeed === rate;

              return (
                <button
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  onMouseEnter={() => setHoverSpeed(rate)}
                  onMouseLeave={() => setHoverSpeed(null)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: FONTS.ui,
                    fontSize: 12,
                    fontWeight: isActive ? 700 : 400,
                    transition: "all 0.2s ease",
                    background: isActive
                      ? darkMode
                        ? COLORS.status
                        : COLORS.frame
                      : isHovered
                      ? darkMode
                        ? "rgba(242,201,76,0.18)"
                        : "rgba(26,75,93,0.12)"
                      : THEME.scrubberBg,
                    color: isActive
                      ? darkMode
                        ? COLORS.ink
                        : COLORS.white
                      : isHovered
                      ? THEME.ink
                      : THEME.mutedInk,
                    transform:
                      isActive || isHovered ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: isActive
                      ? darkMode
                        ? "0 4px 12px rgba(242,201,76,0.3)"
                        : "0 4px 12px rgba(26,75,93,0.25)"
                      : isHovered
                      ? darkMode
                        ? "0 4px 10px rgba(242,201,76,0.15)"
                        : "0 4px 10px rgba(26,75,93,0.12)"
                      : "none",
                  }}
                >
                  {rate}×
                </button>
              );
            })}
          </div>
            {/* Audio bookmarks list (only rendered when bookmarks exist)  */}
            {audioBookmarks.length > 0 && (
            <div style={{
                width: "100%",
                marginTop: 20,
                borderTop: `1px solid ${THEME.border}`,
                paddingTop: 16,
            }}>
                <div style={{
                fontSize: 13,
                fontWeight: 700,
                color: THEME.ink,
                fontFamily: FONTS.ui,
                marginBottom: 10,
                }}>
                Bookmarks
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
                {audioBookmarks
                    .slice()
                    .sort((a, b) => a.time - b.time)
                    .map((b) => (
                    <div
                        key={`${b.trackIndex}-${b.time}`}
                        style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        background: THEME.scrubberBg,
                        borderRadius: 10,
                        padding: "8px 12px",
                        }}
                    >
                        <button
                        onClick={() => jumpToAudioBookmark(b)}
                        style={{
                            flex: 1,
                            textAlign: "left",
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            fontFamily: FONTS.ui,
                            fontSize: 13,
                            fontWeight: 500,
                            color: THEME.ink,
                            padding: 0,
                        }}
                        >
                        {fmt(b.time)}
                        {audioTracks.length > 1 && (
                            <span style={{ marginLeft: 6, fontSize: 11, color: THEME.mutedInk }}>
                            {b.trackTitle}
                            </span>
                        )}
                        <div style={{ fontSize: 11, color: THEME.mutedInk, marginTop: 2 }}>
                            {new Date(b.savedAt).toLocaleDateString()}
                        </div>
                        </button>
                        <button
                        onClick={() => deleteAudioBookmark(b.time, b.trackIndex)}
                        style={{
                            background: "transparent",
                            border: "none",
                            color: THEME.mutedInk,
                            cursor: "pointer",
                            fontSize: 14,
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
            </div>
            )}

          {/* Track list (if multiple tracks exist for this book) */}
          {audioTracks.length > 1 && (
            <div style={{
              width: "100%",
              marginTop: 28,
              borderTop: `1px solid ${THEME.border}`,
              paddingTop: 20,
              maxHeight: 200,
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}>
              {audioTracks.map((track, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentTrackIndex(idx);
                    setAudioUrl(track.url);
                    if (isPlaying) setTimeout(() => audioRef.current?.play(), 100);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "none",
                    background: idx === currentTrackIndex
                      ? darkMode ? "rgba(74,158,186,0.18)" : "rgba(26,75,93,0.08)"
                      : "transparent", // subtle background tint on the active track
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.15s ease",
                    width: "100%",
                  }}
                >
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: idx === currentTrackIndex
                      ? darkMode ? COLORS.status : COLORS.frame
                      : THEME.scrubberBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {/* circle indicator: pause icon when track is playing, track number otherwise */}
                    {idx === currentTrackIndex && isPlaying ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill={darkMode ? COLORS.ink : COLORS.white}>
                        <rect x="6" y="4" width="4" height="16" rx="1"/>
                        <rect x="14" y="4" width="4" height="16" rx="1"/>
                      </svg>
                    ) : (
                      <span style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: idx === currentTrackIndex
                          ? darkMode ? COLORS.ink : COLORS.white
                          : THEME.mutedInk,
                        fontFamily: FONTS.ui,
                      }}>
                        {idx + 1}
                      </span>
                    )}
                  </div>
                  <span style={{
                    fontSize: 13,
                    fontFamily: FONTS.ui,
                    fontWeight: idx === currentTrackIndex ? 600 : 400,
                    color: idx === currentTrackIndex ? THEME.ink : THEME.mutedInk,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {track.title || `Track ${idx + 1}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}