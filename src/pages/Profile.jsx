import { useEffect, useMemo, useState } from "react";
import { useParams, NavLink, useSearchParams } from "react-router-dom";
import VideoCard from "../ui/VideoCard.jsx";
import "./Profile.css";
import { getProfileByUsername, getUserVideos, deleteVideo, whoami } from "../api.js";

function norm(s) {
  return String(s || "").toLowerCase().trim();
}

function tokenize(q) {
  const STOP = new Set([
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "with", "it", "is",
    "are", "was", "were",
  ]);
  return norm(q).split(/\s+/).filter((t) => t.length >= 2 && !STOP.has(t));
}

function matchesQuery(video, q) {
  const query = norm(q);
  if (!query) return true;

  const tokens = tokenize(query);
  if (!tokens.length) return true;

  const hay = [
    video.title,
    video.description,
    video.category,
    ...(Array.isArray(video.tags) ? video.tags : []),
    video.channelDisplayName,
    video.channelUsername,
    video.creatorDisplayName,
    video.creatorUsername,
  ]
    .map(norm)
    .join(" ");

  return tokens.every((t) => hay.includes(t));
}

function toTime(iso) {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export default function Profile({ user, onRequireLogin }) {
  const { username } = useParams();
  const [params, setSearchParams] = useSearchParams();

  const urlQ = (params.get("q") || "").trim();
  const sort = (params.get("sort") || "newest").trim();

  const [localQ, setLocalQ] = useState(urlQ);

  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState("");

  const [uploadsRaw, setUploadsRaw] = useState([]);
  const [uploadsBusy, setUploadsBusy] = useState(false);
  const [uploadsErr, setUploadsErr] = useState("");

  // ✅ session truth (same as Header)
  const [sessionUser, setSessionUser] = useState(null);

  // ✅ MODAL STATE
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState("");

  // -----------------------
  // Keep localQ in sync with URL
  // -----------------------
  useEffect(() => {
    setLocalQ(urlQ);
  }, [urlQ]);

  // -----------------------
  // whoami -> sessionUser
  // -----------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!user?.id) {
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

  // Use the same “truthy” user object everywhere in Profile
  const me = sessionUser || user;
  const isLoggedIn = !!me?.id;

  function setParam(next) {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      const val = String(v ?? "").trim();
      if (!val) sp.delete(k);
      else sp.set(k, val);
    }
    setSearchParams(sp, { replace: true });
  }

  function isLibraryAsset(video) {
  const scope = String(video?.asset_scope ?? video?.assetScope ?? "").toLowerCase().trim();
  return scope === "library";
}

  function handleSearchSubmit(e) {
    e.preventDefault();
    setParam({ q: localQ });
  }

  // -----------------------
  // Delete modal
  // -----------------------
  function openDeleteModal(video) {
    setDeleteErr("");
    setDeleteTarget(video);
  }

  function closeDeleteModal() {
    if (deleteBusy) return;
    setDeleteTarget(null);
    setDeleteErr("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      setDeleteBusy(true);
      setDeleteErr("");
      await deleteVideo(deleteTarget.id);
      window.location.reload();
    } catch (e) {
      setDeleteErr(e?.message || "Failed to delete video");
      setDeleteBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") closeDeleteModal();
    }
    if (deleteTarget) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTarget, deleteBusy]);

  // -----------------------
  // Load profile + uploads
  // -----------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setErr("");
        setUploadsErr("");
        setProfile(null);
        setUploadsRaw([]);
        setUploadsBusy(true);

        const p = await getProfileByUsername(username);
        if (!alive) return;
        setProfile(p);

        // pass sort so backend can sort too (you already support it)
        const vids = await getUserVideos(p.username, { sort });
        if (!alive) return;
        setUploadsRaw(Array.isArray(vids) ? vids : []);
      } catch (e) {
        if (alive) setErr(e?.message || "Failed to load profile");
      } finally {
        if (alive) setUploadsBusy(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [username, sort]);

  const uploads = useMemo(() => {
    const filtered = uploadsRaw
    .filter((v) => !isLibraryAsset(v))      // ✅ hide library assets on profile
    .filter((v) => matchesQuery(v, urlQ));

    const sorted = [...filtered];
    if (sort === "oldest") {
      sorted.sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt));
    } else if (sort === "views") {
      sorted.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
    } else if (sort === "highest") {
      sorted.sort((a, b) => {
        const ra = Number(a.ratingAvg || 0);
        const rb = Number(b.ratingAvg || 0);
        if (rb !== ra) return rb - ra;

        const ca = Number(a.ratingCount || 0);
        const cb = Number(b.ratingCount || 0);
        if (cb !== ca) return cb - ca;

        return toTime(b.createdAt) - toTime(a.createdAt);
      });
    } else {
      sorted.sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));
    }

    return sorted;
  }, [uploadsRaw, urlQ, sort]);

  if (err) return <div className="shell">{err}</div>;
  if (!profile) return <div className="shell">Loading…</div>;

  const isMe =
    !!me?.username &&
    me.username.toLowerCase() === String(profile.username || "").toLowerCase();
  
    const meta = isMe && me ? me : profile;

  const displayRating = Number(meta?.rating ?? 0);
  const displayReviewCount = Number(meta?.reviewCount ?? meta?.review_count ?? 0);
  const displayTokens = Number(meta?.tokens ?? 0);


  return (
    <div className="shell">
      <div className="profileCard">
        <div
          className="profileBanner"
          style={
            profile.bannerUrl
              ? { backgroundImage: `url(${profile.bannerUrl})` }
              : undefined
          }
        />

        <div className="profileTop">
          <div className="avatarWrap">
            <div
              className="avatar"
              style={
                profile.avatarUrl
                  ? { backgroundImage: `url(${profile.avatarUrl})` }
                  : undefined
              }
            >
              {!profile.avatarUrl ? profile.displayName?.[0]?.toUpperCase() : null}
            </div>
          </div>

          <div className="profileInfo">
            <div className="profileNameRow">
              <div className="displayName">
                {profile.displayName}
                {isMe ? (
                  <span style={{ opacity: 0.55, marginLeft: 8 }}>(you)</span>
                ) : null}
              </div>

              {isMe && (
                <NavLink className="editBtn" to="/me/profile">
                  Edit profile
                </NavLink>
              )}
            </div>

            <div className="handle">@{profile.username}</div>

            <div className="profileMeta">
              <span>⭐ {displayRating.toFixed(2)}</span>
              <span className="dot">•</span>
              <span>{displayReviewCount} reviews</span>
            </div>

            {profile.bio && <div className="bio">{profile.bio}</div>}
          </div>
        </div>

        {/* Uploads */}
        <div className="profileSection">
          <div className="profileSectionTitle">Uploads</div>

          <div className="profileControlsRow">
            <div className="profileSort">
              <span className="profileSortLabel">Sort:</span>
              <select
                className="profileSortSelect"
                value={sort}
                onChange={(e) => setParam({ sort: e.target.value })}
              >
                <option value="newest">Newest</option>
                <option value="highest">Highest rated</option>
                <option value="views">Most views</option>
                <option value="oldest">Oldest</option>
              </select>
            </div>

            <form className="profileSearchForm" onSubmit={handleSearchSubmit}>
              <input
                className="profileSearchInput"
                placeholder={`Search ${profile.username}'s videos`}
                value={localQ}
                onChange={(e) => setLocalQ(e.target.value)}
              />

              {localQ ? (
                <button
                  type="button"
                  className="profileSearchClear"
                  onClick={() => {
                    setLocalQ("");
                    setParam({ q: "" });
                  }}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : null}
            </form>
          </div>

          {!isLoggedIn && (
            <div style={{ padding: "6px 2px 10px", opacity: 0.8, fontSize: 13 }}>
              Browsing mode — log in to watch videos.
            </div>
          )}

          {uploadsBusy ? (
            <div style={{ padding: 14, opacity: 0.85 }}>Loading uploads…</div>
          ) : uploadsErr ? (
            <div style={{ padding: 14, opacity: 0.9 }}>{uploadsErr}</div>
          ) : uploads.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.85 }}>
              {urlQ ? "No matching uploads." : "No uploads yet."}
            </div>
          ) : (
            <div className="profileUploadsGrid">
              {uploads.map((v, idx) => {
                const isSearching = urlQ.trim().length > 0;
                const locked = !isLoggedIn && (isSearching || idx >= 2);

                return (
                  <VideoCard
                    key={v.id}
                    video={v}
                    locked={locked}
                    user={me} // ✅ important: pass session truth so delete ownership works
                    onRequireLogin={() => onRequireLogin?.(`/watch/${v.id}`)}
                    onRequestDelete={openDeleteModal}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {deleteTarget && (
        <div className="modalOverlay" onMouseDown={closeDeleteModal}>
          <div className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modalTitle">Delete video?</div>

            <div className="modalBody">
              <div style={{ marginBottom: 8, opacity: 0.9 }}>
                This can’t be undone.
              </div>
              <div style={{ fontWeight: 700 }}>{deleteTarget.title}</div>

              {deleteErr && <div className="modalError">{deleteErr}</div>}
            </div>

            <div className="modalActions">
              <button
                type="button"
                className="modalBtn"
                onClick={closeDeleteModal}
                disabled={deleteBusy}
              >
                Cancel
              </button>

              <button
                type="button"
                className="modalBtnDanger"
                onClick={confirmDelete}
                disabled={deleteBusy}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
