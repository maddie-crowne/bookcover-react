import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Reader from "./pages/Reader";

function ProtectedRoute({ user, children }) {
  if (user === undefined) return null; 
  return user ? children : <Navigate to="/login" replace />;
}


export default function App() {
  const [user, setUser] = useState(undefined);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute user={user}>
            <Dashboard user={user} darkMode={darkMode} setDarkMode={setDarkMode} />
          </ProtectedRoute>
        }
      />
      <Route path="/reader/:bookId" element={<Reader user={user} darkMode={darkMode} setDarkMode={setDarkMode} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}