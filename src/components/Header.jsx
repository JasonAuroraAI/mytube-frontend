import "./Header.css";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getMyProfile } from "../api.js";

export default function Header({
  user,
  onOpenLogin,
  onOpenRegister,
  onLogout,
  q,
  setQ,
}) {
  const nav = useNavigate();
  const location = useLocation();

  const [meProfile, setMeProfile] = useState(null);

  // Fetch displayName (source of truth) when logged in
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!user) {
        setMeProfile(null);
        return;
      }

      try {
        const p = await getMyProfile();
        if (alive) setMeProfile(p);
      } catch {
        // If profile endpoint 401s or fails, just fall back to user.username
        if (alive) setMeProfile(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user?.id]); // re-run on login/logout

  function submitSearch(e) {
    e.preventDefault();
    const query = q.trim();
    const url = query ? `/watch?q=${encodeURIComponent(query)}` : "/watch";
    if (location.pathname + location.search !== url) nav(url);
  }

  const headerName = useMemo(() => {
    if (!user) return "";
    return (meProfile?.displayName || user.displayName || user.username || "").trim();
  }, [user, meProfile]);

  return (
    <header className="header">
      <NavLink to="/watch" className="logo">AI Tube</NavLink>

      <form className="searchForm" onSubmit={submitSearch}>
        <input
          className="search"
          placeholder="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </form>

      <div className="header-right">
        {!user ? (
          <div className="auth-actions">
            <button className="login-btn" onClick={onOpenLogin}>Log in</button>
            <span className="signup-hint">
              Not a member?{" "}
              <button className="signup-link" type="button" onClick={onOpenRegister}>
                Sign up now
              </button>
            </span>
          </div>
        ) : (
          <div className="user-info">
            <NavLink className="username" to={`/u/${user.username}`}>
              {headerName}
            </NavLink>

            <span className="tokens">🪙 {user.tokens}</span>
            <span className="rating">
              ⭐ {user.rating ?? "—"}
              <span className="reviews">({user.reviewCount ?? user.review_count ?? 0})</span>
            </span>

            <button className="signup-link" type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
