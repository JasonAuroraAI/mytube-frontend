// VideoCard.jsx
import "./VideoCard.css";
import { useNavigate, NavLink } from "react-router-dom";
import { thumbUrl, streamUrl } from "../api.js";
import { useEffect, useMemo, useRef, useState } from "react";

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
  onRequestDelete = null,
  user = null,
  me = null,
}) {
  const navigate = useNavigate();

  const src = thumbUrl(video) || null;

  // Preview src (must be directly playable by <video> for this approach)
  const previewSrc = useMemo(() => {
    try {
      return streamUrl?.(video) || null;
    } catch {
      return null;
    }
  }, [video]);

  const views = formatViews(video.views);
  const duration =
    video.durationText && video.durationText !== "0:00" ? video.durationText : null;

  const ratingAvg = formatAvg(video.ratingAvg);
  const ratingCount = Number(video.ratingCount || 0);

  const ownerUsername =
    video.channelUsername || video.creatorUsername || video.creator_username || null;

  const ownerDisplay =
    video.channelDisplayName ||
    video.creatorDisplayName ||
    video.creator_display_name ||
    ownerUsername;

  const currentUser = me || user;
  const ownerUserId = video.userId ?? video.user_id ?? video.ownerId ?? null;

  const isOwner =
    (!!currentUser?.username &&
      !!ownerUsername &&
      lc(currentUser.username) === lc(ownerUsername)) ||
    (!!currentUser?.id &&
      ownerUserId != null &&
      Number(currentUser.id) === Number(ownerUserId));

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

  // -----------------------
  // Hover preview behavior
  // -----------------------
  const videoRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const [isHovering, setIsHovering] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const previewEnabled = !locked && !!previewSrc;

  function startPreviewSoon() {
    if (!previewEnabled) return;
    setIsHovering(true);

    // Add a tiny delay like YouTube (prevents accidental flicker)
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setShowPreview(true);
    }, 250);
  }

  function stopPreview() {
    setIsHovering(false);
    setShowPreview(false);
    clearTimeout(hoverTimerRef.current);

    const el = videoRef.current;
    if (el) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    }
  }

  // When preview becomes visible, try to play
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    if (!showPreview) return;

    // Always muted for autoplay policies
    el.muted = true;
    el.playsInline = true;

    const play = async () => {
      try {
        // Start a bit in (optional). Comment out if you want frame 0.
        // el.currentTime = 0.25;
        await el.play();
      } catch {
        // Autoplay can fail; in that case user will still see the thumb.
      }
    };

    play();
  }, [showPreview]);

  // Cleanup
  useEffect(() => {
    return () => {
      clearTimeout(hoverTimerRef.current);
    };
  }, []);

  return (
    <div
      className={`video-card ${locked ? "locked" : ""}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      onMouseEnter={startPreviewSoon}
      onMouseLeave={stopPreview}
      onFocus={startPreviewSoon}
      onBlur={stopPreview}
    >
      <div className="thumb-wrapper">
        {/* Thumbnail */}
        {src ? (
          <img
            className={`thumbImg ${showPreview ? "isHidden" : ""}`}
            src={src}
            alt={video.title}
            loading="lazy"
          />
        ) : null}

        {/* Hover preview */}
        {previewEnabled ? (
          <video
            ref={videoRef}
            className={`thumbPreview ${showPreview ? "isVisible" : ""}`}
            src={previewSrc}
            preload="metadata"
            muted
            playsInline
            loop
          />
        ) : null}

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
            <div className="vRating" aria-label={`Rating ${ratingAvg} (${ratingCount})`}>
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