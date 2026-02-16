import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams, Link } from "react-router-dom";
import { getVideos } from "../api.js";
import { VideoShelf } from "../ui/VideoShelf.jsx";
import VideoCard from "../ui/VideoCard.jsx";

// -----------------------
// Tags -> shelves helpers
// -----------------------
function normTag(t) {
  return String(t || "").trim().toLowerCase();
}

function titleTag(t) {
  const s = String(t || "").trim();
  if (!s) return "Other";
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function buildRowsByTags(videos, { maxRows = 8, minCount = 2 } = {}) {
  // 1) count tags
  const counts = new Map();
  for (const v of videos) {
    const tags = Array.isArray(v.tags) ? v.tags : [];
    for (const raw of tags) {
      const t = normTag(raw);
      if (!t) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }

  // 2) pick top tags
  const topTags = [...counts.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxRows)
    .map(([t]) => t);

  // 3) build rows (videos can appear in multiple rows)
  const rows = topTags.map((tag) => ({
    title: titleTag(tag),
    key: `tag:${tag}`,
    videos: videos.filter((v) =>
      (Array.isArray(v.tags) ? v.tags : []).some((x) => normTag(x) === tag)
    ),
  }));

  // 4) “Other” bucket (no tags OR none of the top tags)
  const other = videos.filter((v) => {
    const tags = Array.isArray(v.tags) ? v.tags : [];
    if (!tags.length) return true;
    return !tags.some((x) => topTags.includes(normTag(x)));
  });

  if (other.length) {
    rows.push({ title: "Other", key: "tag:other", videos: other });
  }

  return rows;
}

export default function Home({ user, onRequireLogin }) {
  const outlet = useOutletContext?.() || {};
  const setQ = outlet.setQ || (() => {});

  const [params] = useSearchParams();
  const urlQ = (params.get("q") || "").trim();

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
        // If your backend supports ?q filtering, this will work.
        // If it doesn't, it still returns all videos and your UI can filter/sort later.
        const vids = await getVideos(isSearching ? { q: urlQ } : {});
        if (!alive) return;
        setVideos(Array.isArray(vids) ? vids : []);
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

  // -----------------------
  // Tag shelves (Home mode)
  // -----------------------
  const tagRows = useMemo(() => {
    if (isSearching) return [];
    return buildRowsByTags(videos, { maxRows: 8, minCount: 2 });
  }, [isSearching, videos]);

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
                <Link to="/create" className="createLink">
                  create it?
                </Link>
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
          {tagRows.map((row) => {
            const startIndex = cursor;
            cursor += row.videos.length;

            return (
              <VideoShelf
                key={row.key}
                title={row.title}
                videos={row.videos}
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
