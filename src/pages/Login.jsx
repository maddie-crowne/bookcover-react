import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

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
  inputBg: "rgba(255, 255, 255, 0.72)",
};

export default function Login() {
  const nav = useNavigate();

  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");

  const normalizedEmail = (email || "").trim();
  const isSignup = mode === "signup";

  const validate = () => {
    if (!normalizedEmail) return "Please enter an email.";
    if (!password) return "Please enter a password.";
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return "That email looks invalid. Example: name@email.com";
    }
    if (password.length < 6) return "Password must be at least 6 characters.";

    if (isSignup) {
      if (!confirmPassword) return "Please confirm your password.";
      if (password !== confirmPassword) return "Passwords do not match.";
    }

    return null;
  };

  const signup = async () => {
    setStatus("");
    const err = validate();
    if (err) {
      setStatus(err);
      return;
    }

    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password
      );

      await setDoc(
        doc(db, "Users", cred.user.uid),
        {
          email: cred.user.email,
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );

      nav("/");
    } catch (e) {
      setStatus(`${e.code || "error"} — ${e.message}`);
    }
  };

  const login = async () => {
    setStatus("");

    if (!normalizedEmail || !password) {
      setStatus("Enter email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, normalizedEmail, password);
      nav("/");
    } catch (e) {
      setStatus(`${e.code || "error"} — ${e.message}`);
    }
  };

  const handleSubmit = async () => {
    if (isSignup) {
      await signup();
    } else {
      await login();
    }
  };

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={logoWrapStyle}>
          <div style={logoPlaceholderStyle}>Logo</div>
        </div>

        <div style={headerBlockStyle}>
          <p style={eyebrowStyle}>WELCOME TO</p>
          <h1 style={titleStyle}>Bookcover</h1>
          <p style={subtitleStyle}>
            {isSignup
              ? "Create your account to start building your accessible bookshelf."
              : "Log in to your bookshelf and pick up where you left off."}
          </p>
        </div>

        <div style={tabRowStyle}>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setStatus("");
            }}
            style={{
              ...tabStyle,
              ...(mode === "login" ? activeTabStyle : inactiveTabStyle),
            }}
          >
            Login
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setStatus("");
            }}
            style={{
              ...tabStyle,
              ...(mode === "signup" ? activeTabStyle : inactiveTabStyle),
            }}
          >
            Create Account
          </button>
        </div>

        <div style={formStyle}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            autoComplete="email"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />

          {isSignup && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
              autoComplete="new-password"
            />
          )}

          <button onClick={handleSubmit} style={primaryButtonStyle}>
            {isSignup ? "Create Account" : "Login"}
          </button>
        </div>

        {status && <p style={statusStyle}>{status}</p>}
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: `linear-gradient(180deg, ${COLORS.canvas} 0%, #f7f1f1 100%)`,
  padding: "24px",
};

const cardStyle = {
  width: "100%",
  maxWidth: "430px",
  background: "rgba(255,255,255,0.82)",
  border: `1px solid ${COLORS.border}`,
  borderRadius: "28px",
  boxShadow: "0 18px 45px rgba(18, 38, 48, 0.10)",
  padding: "32px 28px 26px",
  backdropFilter: "blur(6px)",
};

const logoWrapStyle = {
  display: "flex",
  justifyContent: "center",
  marginBottom: "18px",
};

const logoPlaceholderStyle = {
  width: "74px",
  height: "74px",
  borderRadius: "22px",
  background: COLORS.frame,
  color: COLORS.white,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "17px",
  fontFamily: '"Libre Baskerville", Georgia, serif',
  boxShadow: "0 10px 24px rgba(26, 75, 93, 0.20)",
};

const headerBlockStyle = {
  textAlign: "center",
  marginBottom: "22px",
};

const eyebrowStyle = {
  margin: 0,
  fontSize: "13px",
  color: COLORS.accent,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  fontFamily: '"Libre Baskerville", Georgia, serif',
};

const titleStyle = {
  margin: "8px 0 10px",
  color: COLORS.ink,
  fontSize: "44px",
  lineHeight: 1.05,
  fontWeight: 700,
  fontFamily: '"Libre Baskerville", Georgia, serif',
};

const subtitleStyle = {
  margin: 0,
  color: COLORS.accent,
  fontSize: "17px",
  lineHeight: 1.5,
  fontFamily: '"Libre Baskerville", Georgia, serif',
};

const tabRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px",
  background: "rgba(230, 126, 126, 0.12)",
  borderRadius: "16px",
  padding: "6px",
  marginBottom: "18px",
};

const tabStyle = {
  border: "none",
  borderRadius: "12px",
  padding: "12px 12px",
  fontWeight: 700,
  fontSize: "14px",
  cursor: "pointer",
  transition: "all 0.2s ease",
  fontFamily: '"Libre Baskerville", Georgia, serif',
};

const activeTabStyle = {
  background: COLORS.frame,
  color: COLORS.white,
  boxShadow: "0 6px 16px rgba(26, 75, 93, 0.18)",
};

const inactiveTabStyle = {
  background: "transparent",
  color: COLORS.ink,
};

const formStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "12px",
};

const inputStyle = {
  width: "100%",
  padding: "14px 16px",
  borderRadius: "16px",
  border: `1px solid rgba(26, 75, 93, 0.14)`,
  background: "rgba(235, 241, 248, 0.95)",
  color: COLORS.ink,
  fontSize: "16px",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: '"Libre Baskerville", Georgia, serif',
};

const primaryButtonStyle = {
  width: "100%",
  border: "none",
  borderRadius: "16px",
  padding: "14px 16px",
  background: COLORS.spark,
  color: COLORS.white,
  fontWeight: 700,
  fontSize: "16px",
  cursor: "pointer",
  marginTop: "4px",
  boxShadow: "0 10px 24px rgba(230, 126, 126, 0.25)",
  fontFamily: '"Libre Baskerville", Georgia, serif',
};

const statusStyle = {
  marginTop: "14px",
  padding: "12px 14px",
  borderRadius: "14px",
  background: "rgba(242, 201, 76, 0.18)",
  color: COLORS.accent,
  fontSize: "13px",
  lineHeight: 1.45,
  border: `1px solid rgba(142, 36, 36, 0.12)`,
  fontFamily: '"Libre Baskerville", Georgia, serif',
};