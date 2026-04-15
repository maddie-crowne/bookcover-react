import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Reader from "./pages/Reader";
import Player from "./pages/Player";
import Terms from "./pages/Terms";

function ProtectedRoute({ user, children }) {
  // blocks a route from rendering until we know if the user is logged in or not.
  if (user === undefined) return null; 
  return user ? children : <Navigate to="/login" replace />;
}


export default function App() {
  const [user, setUser] = useState(undefined);
  const [darkMode, setDarkMode] = useState(false);

  // listen for Firebase auth changes — fires once on load and again whenever the user signs in/out
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u || null));
    return () => unsub();
  }, []);

  return (
    <Routes>
      {/* if already logged in, skip the login page and go straight to the dashboard */}
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute user={user}>
            <Dashboard user={user} darkMode={darkMode} setDarkMode={setDarkMode} />
          </ProtectedRoute>
        }
      />
      {/* reader and player don't use ProtectedRoute — Reader/Player handle their own
          auth checks internally since they need the bookId param too */}
      <Route path="/reader/:bookId" element={<Reader user={user} darkMode={darkMode} setDarkMode={setDarkMode} />} />
      <Route path="/player/:bookId" element={<Player user={user} darkMode={darkMode} setDarkMode={setDarkMode} />} />
      <Route path="/terms" element={<Terms darkMode={darkMode} setDarkMode={setDarkMode} />} />
      {/* any unknown URL goes back to the dashboard */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}