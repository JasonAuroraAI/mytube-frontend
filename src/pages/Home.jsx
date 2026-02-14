import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams, Link } from "react-router-dom";
import { getCategories, getVideos } from "../api.js";
import { VideoShelf } from "../ui/VideoShelf.jsx";
import VideoCard from "../ui/VideoCard.jsx";

export default function Home({ user, onRequireLogin }) {
  const outlet = useOutletContext?.() || {};
  const setQ = outlet.setQ || (() => {});

  const [params] = useSearchParams();
  const urlQ = (params.get("q") || "").trim();

  const [categories, setCategories] = useState([]);
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);

  const isSearching = urlQ.length > 0;
  const isLoggedIn = !!user?.id;

  useEffect(() => {
    setQ(urlQ);
  }, [urlQ, setQ]);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      try {
        if (!isSearching) {
          const [cats, vids] = await Promise.all([getCategories(), getVideos()]);
          if (!alive) return;
          setCategories(cats);
          setVideos(vids);
        } else {
          const vids = await getVideos({ q: urlQ });
          if (!alive) return;
          setCategories([]);
          setVideos(vids);
        }
      } catch (e) {
        console.error("Home fetch failed:", e);
        if (!alive) return;
        setVideos([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [isSearching, urlQ]);

  const grouped = useMemo(() => {
    if (isSearching) return [];
    const map = new Map();

    for (const v of videos) {
      const key = v.category || "Other";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    }

    const ordered = [];
    for (const c of categories) if (map.has(c)) ordered.push([c, map.get(c)]);
    for (const [c, arr] of map.entries()) if (!categories.includes(c)) ordered.push([c, arr]);

    return ordered;
  }, [isSearching, videos, categories]);

  // -----------------------
  // Search Grid Mode
  // -----------------------
  if (isSearching) {
    return (
      <div className="page">
        <div className="resultsHeader">
          {loading ? (
            <span>Searching…</span>
          ) : (
            <span>
              Results for <strong>“{urlQ}”</strong> ({videos.length})
            </span>
          )}
        </div>

        {!loading && videos.length === 0 ? (
          <div className="emptyState">
            <div className="emptyTitle">No results</div>
            <div className="emptySub">
              Would you like to{" "}
              {user ? (
                <Link to="/create" className="createLink">create it?</Link>
              ) : (
                <button
                  type="button"
                  className="plainBtn"
                  onClick={() => onRequireLogin?.("/create")}
                >
                  create it?
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="resultsGrid">
            {videos.map((video, idx) => (
              <VideoCard
                key={video.id}
                video={video}
                locked={!isLoggedIn && idx >= 2}
                onRequireLogin={onRequireLogin}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // -----------------------
  // Home Shelves Mode (GLOBAL lock after 2)
  // -----------------------
  let cursor = 0;

  return (
    <div className="page">
      {loading ? (
        <div className="loading">Loading…</div>
      ) : (
        <div className="feedInner">
          {grouped.map(([cat, vids]) => {
            const startIndex = cursor;
            cursor += vids.length;

            return (
              <VideoShelf
                key={cat}
                title={cat}
                videos={vids}
                user={user}
                onRequireLogin={onRequireLogin}
                startIndex={startIndex}
                lockAfter={2}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
