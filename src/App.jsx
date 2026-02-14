import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";

import AppLayout from "./layouts/AppLayout.jsx";
import Home from "./pages/Home.jsx";
import Watch from "./pages/Watch.jsx";
import Create from "./pages/Create.jsx";
import Profile from "./pages/Profile.jsx";
import EditProfile from "./pages/EditProfile.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [postAuthPath, setPostAuthPath] = useState(null);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  // ✅ single source of truth for restoring session user
  const refreshMe = useCallback(async () => {
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (res.ok) {
        const me = await res.json();
        setUser(me);
        return me;
      }
    } catch {}
    setUser(null);
    return null;
  }, []);

  const openLogin = (redirectTo = null) => {
    setPostAuthPath(redirectTo);
    setAuthMode("login");
    setAuthOpen(true);
  };

  const openRegister = (redirectTo = null) => {
    setPostAuthPath(redirectTo);
    setAuthMode("register");
    setAuthOpen(true);
  };

  const closeAuth = () => setAuthOpen(false);

  const handleAuthSuccess = (userData) => {
    setUser(userData);
    setAuthOpen(false);
  };

  const handleLogout = async () => {
    try {
      await fetch("/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {}
    setUser(null);
  };

  // ✅ restore login on refresh
  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          element={
            <AppLayout
              user={user}
              setUser={setUser}        // ✅ allow children to update user after profile edits
              refreshMe={refreshMe}     // ✅ or just refetch /auth/me
              onLogout={handleLogout}
              authOpen={authOpen}
              authMode={authMode}
              onOpenLogin={openLogin}
              onOpenRegister={openRegister}
              onCloseAuth={closeAuth}
              onAuthSuccess={handleAuthSuccess}
              postAuthPath={postAuthPath}
              setPostAuthPath={setPostAuthPath}
            />
          }
        >
          <Route path="/" element={<Navigate to="/watch" replace />} />
          <Route
            path="/watch"
            element={<Home user={user} onRequireLogin={openLogin} />}
          />
          <Route
            path="/watch/:id"
            element={<Watch user={user} onRequireLogin={openLogin} />}
          />
          <Route
            path="/create"
            element={<Create user={user} onRequireLogin={openLogin} />}
          />

          {/* ✅ Edit profile (logged in) */}
          <Route
            path="/me/profile"
            element={
              <EditProfile
                user={user}
                onRequireLogin={openLogin}
                onUserUpdated={setUser} // ✅ simplest: edit page can call this with fresh /auth/me or returned profile
                refreshMe={refreshMe}   // ✅ preferred: call refreshMe() after saving username
              />
            }
          />

          {/* ✅ Public profiles */}
          <Route
            path="/u/:username"
            element={<Profile user={user} onRequireLogin={openLogin} />}
          />

        </Route>
      </Routes>
    </BrowserRouter>
  );
}
