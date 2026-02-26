import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import Header from "../components/Header.jsx";
import AuthModal from "../components/AuthModal.jsx";

export default function AppLayout({
  user,
  onLogout,
  authOpen,
  authMode,
  onOpenLogin,
  onOpenRegister,
  onCloseAuth,
  onAuthSuccess,
  postAuthPath,
  setPostAuthPath,
}) {
  const [q, setQ] = useState("");
  const nav = useNavigate();

  return (
    <div className="shell">
      <Header
        user={user}
        onOpenLogin={onOpenLogin}
        onOpenRegister={onOpenRegister}
        onLogout={onLogout}
        q={q}
        setQ={setQ}
      />

      <div className="folderShell">
        <nav className="folderTabs">
          <NavLink
            to="/watch"
            end
            className={({ isActive }) => `folderTab ${isActive ? "active" : ""}`}
          >
            Watch
          </NavLink>

          <NavLink
            to="/create"
            className={({ isActive }) =>
              `folderTab ${isActive ? "active" : ""} ${!user ? "lockedTab" : ""}`
            }
            onClick={(e) => {
              if (!user) {
                e.preventDefault();
                onOpenLogin("/create"); // ✅ set redirect target
              }
            }}
          >
            Upload (DEV ONLY)
          </NavLink>

          <NavLink
            to="/generate"
            className={({ isActive }) =>
              `folderTab ${isActive ? "active" : ""} ${!user ? "lockedTab" : ""}`
            }
            onClick={(e) => {
              if (!user) {
                e.preventDefault();
                onOpenLogin("/generate"); // ✅ set redirect target
              }
            }}
          >
            Generate
          </NavLink>
        </nav>

        <div className="folderBody">
          <Outlet context={{ q, setQ, user }} />
        </div>
      </div>

      {authOpen && (
        <AuthModal
          mode={authMode}
          onClose={onCloseAuth}
          onSuccess={(userData) => {
            onAuthSuccess(userData);

            if (postAuthPath) {
              nav(postAuthPath);
              setPostAuthPath(null);
            }
          }}
          onSwitchMode={(m) =>
            m === "login" ? onOpenLogin(postAuthPath) : onOpenRegister(postAuthPath)
          }
        />
      )}
    </div>
  );
}
