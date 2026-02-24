import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { auth, db } from "../firebase";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  const signup = async () => {
    setStatus("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, "Users", cred.user.uid), {
        email: cred.user.email,
        createdAt: serverTimestamp(),
      }, { merge: true });
      nav("/");
    } catch (e) {
      setStatus(e.message);
    }
  };

  const login = async () => {
    setStatus("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      nav("/");
    } catch (e) {
      setStatus(e.message);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f4f4f9",
      padding: 16
    }}>
      <div style={{
        width: 340,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
        padding: 22
      }}>
        <h2 style={{ margin: "0 0 6px" }}>Bookcover</h2>
        <p style={{ margin: "0 0 16px", color: "#6b7280", fontSize: 13 }}>
          Log in to your bookshelf
        </p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          style={inputStyle}
        />

        <button onClick={login} style={{...btnStyle, background:"#2563eb"}}>Login</button>
        <button onClick={signup} style={{...btnStyle, background:"#16a34a"}}>Create Account</button>

        {status && <p style={{ marginTop: 10, color: "#b91c1c", fontSize: 12 }}>{status}</p>}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  marginBottom: 10,
  outline: "none",
};

const btnStyle = {
  width: "100%",
  border: "none",
  borderRadius: 12,
  padding: "10px 12px",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
  marginTop: 8
};