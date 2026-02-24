import React, { useEffect } from "react";

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
        background: "rgba(17,24,39,0.55)",
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
            background: "#fff",
            borderRadius: 18,
            boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
            display: "flex",
            flexDirection: "column",
        }}
        >
        <div
            style={{
                padding: "14px 16px",
                borderBottom: "1px solid #e5e7eb",
                position: "sticky",
                top: 0,
                background: "#fff",
                zIndex: 2
            }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              cursor: "pointer",
              color: "#6b7280",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div
            style={{
                padding: "14px 16px 18px",
                maxHeight: "70vh",
                overflowY: "auto"
            }}
            >
            {children}
        </div>
      </div>
    </div>
  );
}