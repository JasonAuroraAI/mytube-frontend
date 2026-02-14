// VideoCard.jsx
import "./VideoCard.css";
import { useNavigate, NavLink } from "react-router-dom";
import { thumbUrl } from "../api.js";

function formatViews(n) {
  if (n == null) return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M views`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K views`;
  return `${num} views`;
}

function formatAvg(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0.00";
  return num.toFixed(2);
}

function lc(s) {
  return String(s || "").toLowerCase().trim();
}

export default function VideoCard({
  video,
  locked = false,
  onRequireLogin,

  // ✅ ONLY Profile page should pass this.
  // When not passed (e.g. Home), no delete UI renders.
  onRequestDelete = null,

  // ✅ current logged-in user
  user = null,
  me = null,
}) {
  const navigate = useNavigate();
  const src = thumbUrl(video);

  const views = formatViews(video.views);
  const duration =
    video.durationText && video.durationText !== "0:00"
      ? video.durationText
      : null;

  const ratingAvg = formatAvg(video.ratingAvg);
  const ratingCount = Number(video.ratingCount || 0);

  // Owner fields differ by endpoint:
  // - /api/videos -> channelUsername / channelDisplayName
  // - /api/profile/u/:username/videos -> creatorUsername / creatorDisplayName
  const ownerUsername =
    video.channelUsername ||
    video.creatorUsername ||
    video.creator_username ||
    null;

  const ownerDisplay =
    video.channelDisplayName ||
    video.creatorDisplayName ||
    video.creator_display_name ||
    ownerUsername;

  const currentUser = me || user;

  // Optional if you later include IDs in API:
  const ownerUserId = video.userId ?? video.user_id ?? video.ownerId ?? null;

  const isOwner =
    (!!currentUser?.username &&
      !!ownerUsername &&
      lc(currentUser.username) === lc(ownerUsername)) ||
    (!!currentUser?.id &&
      ownerUserId != null &&
      Number(currentUser.id) === Number(ownerUserId));

  // ✅ Only show delete when:
  // 1) This card knows the user is the owner
  // 2) The parent page provided a delete handler (Profile page)
  const canDelete = isOwner && typeof onRequestDelete === "function";

  function handleClick() {
    if (locked) return onRequireLogin?.();
    navigate(`/watch/${video.id}`);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  function handleDeleteClick(e) {
    e.preventDefault();
    e.stopPropagation();
    onRequestDelete?.(video);
  }

  return (
    <div
      className={`video-card ${locked ? "locked" : ""}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className="thumb-wrapper">
        <img src={src} alt={video.title} loading="lazy" />
        {duration && <div className="durationBadge">{duration}</div>}

        {locked && (
          <div className="lockOverlay">
            <div className="lockPill">
              <span className="lockIcon">🔒</span>
              <span>Log in to watch</span>
            </div>
          </div>
        )}
      </div>

      <div className="video-meta">
        <div className="vTitleRow">
          <h4 className="video-title">{video.title}</h4>

          <div className="vTitleRight">
            <div
              className="vRating"
              aria-label={`Rating ${ratingAvg} (${ratingCount})`}
            >
              <span className="vStar">★</span>
              <span className="vAvg">{ratingAvg}</span>
              <span className="vCount">({ratingCount})</span>
            </div>

            {canDelete && (
              <button
                type="button"
                className="vDeleteBtn"
                onClick={handleDeleteClick}
                title="Delete video"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {(ownerUsername || views) && (
          <div className="video-sub">
            {ownerUsername && (
              <NavLink
                to={`/u/${ownerUsername}`}
                className="video-creator"
                onClick={(e) => e.stopPropagation()}
              >
                {ownerDisplay}
              </NavLink>
            )}

            {ownerUsername && views && <span className="dot">•</span>}
            {views && <span className="video-views">{views}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
