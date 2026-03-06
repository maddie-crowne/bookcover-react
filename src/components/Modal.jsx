import React, { useEffect } from "react";

const COLORS = {
  canvas: "#F9EAEA",
  ink: "#122630",
  frame: "#1A4B5D",
  spark: "#E67E7E",
  status: "#F2C94C",
  accent: "#8E2424",
  border: "rgba(18, 38, 48, 0.12)",
};

const FONTS = {
  ui: '"Inter", "Helvetica Neue", Arial, sans-serif',
  reading: '"Libre Baskerville", Georgia, serif',
};

export default function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    const onEsc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(18, 38, 48, 0.32)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 999,
      }}
    >
      <div
        style={{
          width: "min(920px, 100%)",
          maxHeight: "85vh",
          background: COLORS.canvas,
          borderRadius: 24,
          border: `1px solid ${COLORS.border}`,
          boxShadow: "0 24px 60px rgba(18, 38, 48, 0.18)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: 8,
            background: COLORS.frame,
            width: "100%",
          }}
        />

        <div
          style={{
            padding: "22px 24px 18px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: COLORS.canvas,
            position: "sticky",
            top: 0,
            zIndex: 2,
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 28,
              lineHeight: 1.2,
              color: COLORS.ink,
              fontFamily: FONTS.reading,
              fontWeight: 700,
            }}
          >
            {title}
          </h3>

          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 28,
              lineHeight: 1,
              cursor: "pointer",
              color: COLORS.ink,
              fontFamily: FONTS.ui,
              padding: 0,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          style={{
            padding: "22px 24px 24px",
            maxHeight: "70vh",
            overflowY: "auto",
            fontFamily: FONTS.ui,
            color: COLORS.ink,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}