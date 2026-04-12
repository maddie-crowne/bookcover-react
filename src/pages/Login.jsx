import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import bookcoverLogo from "../assets/bookcover-logo.png";
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
  inputBg: "rgba(235, 241, 248, 0.95)",
  inputHover: "rgba(226, 235, 245, 1)",
};

export default function Login() {
  const nav = useNavigate();

  // COMPONENT STATE
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");

  // HOVER STATES
  const [hoveredTab, setHoveredTab] = useState(null);
  const [hoveredInput, setHoveredInput] = useState(null);
  const [buttonHovered, setButtonHovered] = useState(false);
  const [cardHovered, setCardHovered] = useState(false);

  const normalizedEmail = (email || "").trim();
  const isSignup = mode === "signup";

  // Checks for error before trying to hit the Firebase API
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

  // 1 Checks the local form against errors using validate()
  // 2 Creates the user in Firebase Auth.
  // 3 Initializes a User document in Firestore 
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
  // Authenticate agains Firebase Auth
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

  const getTabStyle = (tabName) => {
    const isActive = mode === tabName;
    const isHovered = hoveredTab === tabName;

    return {
      ...tabStyle,
      ...(isActive ? activeTabStyle : inactiveTabStyle),
      transform: isHovered ? "translateY(-1px)" : "translateY(0)",
      boxShadow: isActive
        ? isHovered
          ? "0 8px 20px rgba(26, 75, 93, 0.24)"
          : "0 6px 16px rgba(26, 75, 93, 0.18)"
        : isHovered
        ? "0 4px 10px rgba(18, 38, 48, 0.08)"
        : "none",
      background: isActive
        ? COLORS.frame
        : isHovered
        ? "rgba(26, 75, 93, 0.92)"
        : "rgba(26, 75, 93, 0.82)",
      color: COLORS.white,
    };
  };

  const getInputStyle = (inputName) => ({
    ...inputStyle,
    background:
      hoveredInput === inputName ? COLORS.inputHover : COLORS.inputBg,
    border:
      hoveredInput === inputName
        ? `1px solid rgba(26, 75, 93, 0.28)`
        : `1px solid rgba(26, 75, 93, 0.14)`,
    boxShadow:
      hoveredInput === inputName
        ? "0 8px 18px rgba(18, 38, 48, 0.07)"
        : "none",
    transform: hoveredInput === inputName ? "translateY(-1px)" : "translateY(0)",
  });

  return (
    <div style={pageStyle}>
      <div
        style={{
          ...cardStyle,
          transform: cardHovered ? "translateY(-3px)" : "translateY(0)",
          boxShadow: cardHovered
            ? "0 24px 60px rgba(18, 38, 48, 0.14)"
            : "0 18px 45px rgba(18, 38, 48, 0.10)",
        }}
        onMouseEnter={() => setCardHovered(true)}
        onMouseLeave={() => setCardHovered(false)}
      >
        <div style={logoWrapStyle}>
          <img
            src={bookcoverLogo}
            alt="Bookcover logo"
            style={logoImageStyle}
          />
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
        {/* Login and Create Account toggle */}
        <div style={tabRowStyle}>
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setStatus("");
            }}
            onMouseEnter={() => setHoveredTab("login")}
            onMouseLeave={() => setHoveredTab(null)}
            style={getTabStyle("login")}
          >
            Login
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setStatus("");
            }}
            onMouseEnter={() => setHoveredTab("signup")}
            onMouseLeave={() => setHoveredTab(null)}
            style={getTabStyle("signup")}
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
            style={getInputStyle("email")}
            onMouseEnter={() => setHoveredInput("email")}
            onMouseLeave={() => setHoveredInput(null)}
            autoComplete="email"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={getInputStyle("password")}
            onMouseEnter={() => setHoveredInput("password")}
            onMouseLeave={() => setHoveredInput(null)}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
          {/* Only shows confirm password if in Create Account mode */}
          {isSignup && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={getInputStyle("confirm")}
              onMouseEnter={() => setHoveredInput("confirm")}
              onMouseLeave={() => setHoveredInput(null)}
              autoComplete="new-password"
            />
          )}

          <button
            onClick={handleSubmit}
            onMouseEnter={() => setButtonHovered(true)}
            onMouseLeave={() => setButtonHovered(false)}
            style={{
              ...primaryButtonStyle,
              transform: buttonHovered ? "translateY(-2px)" : "translateY(0)",
              boxShadow: buttonHovered
                ? "0 14px 28px rgba(230, 126, 126, 0.34)"
                : "0 10px 24px rgba(230, 126, 126, 0.25)",
              background: buttonHovered ? "#df7474" : COLORS.spark,
            }}
          >
            {isSignup ? "Create Account" : "Login"}
          </button>
        </div>

        {status && <p style={statusStyle}>{status}</p>}
      </div>
    </div>
  );
}

// SHARED STYLE OBJECTS ACCROSS THE LOGIN
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
  transition: "all 0.25s ease",
};

const logoWrapStyle = {
  display: "flex",
  justifyContent: "center",
  marginBottom: "18px",
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
  background: "rgba(26, 75, 93, 0.10)",
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
};

const inactiveTabStyle = {
  background: "rgba(26, 75, 93, 0.82)",
  color: COLORS.white,
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
  transition: "all 0.2s ease",
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
  transition: "all 0.2s ease",
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
const logoImageStyle = {
  width: "180px",
  height: "auto",
  display: "block",
};