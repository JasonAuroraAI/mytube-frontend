import "./Header.css";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getMyProfile, whoami } from "../api.js";


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
  const [sessionUser, setSessionUser] = useState(null);

  useEffect(() => {
  let alive = true;

  (async () => {
    if (!user) {
      setSessionUser(null);
      return;
    }
    try {
      const u = await whoami();
      if (alive) setSessionUser(u);
    } catch {
      if (alive) setSessionUser(null);
    }
  })();

  return () => {
    alive = false;
  };
  }, [user?.id]);


  const ratingVal = sessionUser?.rating ?? user?.rating;
  const reviewCountVal = sessionUser?.reviewCount ?? user?.reviewCount ?? 0;
  const tokensVal = sessionUser?.tokens ?? user?.tokens ?? 0;




  function submitSearch(e) {
  e.preventDefault();
  const query = String(q ?? "").trim();
  const url = query ? `/watch?q=${encodeURIComponent(query)}` : "/watch";
  if (location.pathname + location.search !== url) nav(url);
}

  const headerRating = useMemo(() => {
  if (!user) return null;

  const rating = meProfile?.rating ?? user.rating ?? null;
  const reviewCount = meProfile?.reviewCount ?? user.reviewCount ?? user.review_count ?? 0;
  console.log(rating)

  return { rating, reviewCount };
}, [user, meProfile]);


  const headerName = useMemo(() => {
    if (!user) return "";
    return (
      meProfile?.displayName ||
      user.displayName ||
      user.username ||
      ""
    ).trim();
  }, [user, meProfile]);

  return (
    <header className="header">
      <div className="header-inner">
        {/* LEFT */}
        <div className="header-left">
          <NavLink to="/watch" className="logo">
            AI Tube
          </NavLink>

        </div>

        {/* CENTER */}
        <div className="header-center">
          <form
            className="searchForm"
            onSubmit={submitSearch}
          >
            <input
              className="search"
              placeholder="Search"
              value={q ?? ""}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
        </div>

        {/* RIGHT */}
        <div className="header-right">
          {!user ? (
            <div className="auth-actions">
              <button
                className="login-btn"
                onClick={onOpenLogin}
              >
                Log in
              </button>
              <button
                className="signup-link"
                onClick={onOpenRegister}
              >
                Sign up
              </button>
            </div>
          ) : (
            <div className="user-info">
              <NavLink
                className="username"
                to={`/u/${user.username}`}
              >
                {headerName}
              </NavLink>

              <span className="tokens">
                🪙 {user.tokens}
              </span>
              <span className="rating">
                 ⭐ {Number(ratingVal).toFixed(2) ?? "—"} ({reviewCountVal})
              </span>

              <button
                className="signup-link"
                onClick={onLogout}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>

  );

}
