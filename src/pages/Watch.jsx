import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, NavLink } from "react-router-dom";
import {
  getVideo,
  getVideos,
  streamUrl,
  rateVideo,
  getMyRating,
  getComments,
  postComment,
  toggleCommentLike,
  editComment,
  deleteComment,
  recordView,
} from "../api.js";
import StarRating from "../ui/StarRating.jsx";
import "./Watch.css";
import ConfirmModal from "../ui/ConfirmModal.jsx";

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;

  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;

  const week = Math.floor(day / 7);
  if (week < 5) return `${week}w ago`;

  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;

  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

function formatInt(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("en-AU");
}

function initialLetter(name) {
  const s = String(name || "").trim();
  return (s[0] || "?").toUpperCase();
}

function toNumOrNull(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export default function Watch({ user, onRequireLogin }) {
  const { id } = useParams();
  const nav = useNavigate();

  const [video, setVideo] = useState(null);
  const [suggested, setSuggested] = useState([]);

  // record view once per mount per id
  const [viewRecordedFor, setViewRecordedFor] = useState(null);

  // ratings
  const [myRating, setMyRating] = useState(null);
  const [myRatingLoaded, setMyRatingLoaded] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);

  // comments
  const [comments, setComments] = useState([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentPostBusy, setCommentPostBusy] = useState(false);
  const [commentError, setCommentError] = useState("");

  // edit
  const [editing, setEditing] = useState(null); // { id, parentId }
  const [editingBody, setEditingBody] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null); // { id, parentId }

  // replies (placement-aware)
  // parentId = top-level comment id to post under
  // anchorId = which item the composer is visually under (comment id OR reply id)
  const [replyingTo, setReplyingTo] = useState(null); // { parentId, anchorId }
  const [replyBody, setReplyBody] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);

  // collapsed/expanded threads
  const [openReplies, setOpenReplies] = useState(() => new Set());

  const isLoggedIn = !!user?.id;

  // ownership check (username-based)
  const myUsername = user?.username ? String(user.username).toLowerCase() : null;
  const isOwner = (item) => {
    const u = item?.username ? String(item.username).toLowerCase() : null;
    return !!myUsername && !!u && myUsername === u;
  };

  useEffect(() => {
    setViewRecordedFor(null);
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setVideo(null);
      setSuggested([]);

      setComments([]);
      setCommentBody("");
      setCommentError("");
      setCommentsBusy(false);

      setEditing(null);
      setEditingBody("");
      setDeleteTarget(null);

      setReplyingTo(null);
      setReplyBody("");
      setReplyBusy(false);
      setOpenReplies(new Set());

      setMyRating(null);
      setMyRatingLoaded(false);

      try {
        const v = await getVideo(id);
        if (cancelled) return;
        setVideo(v);

        // record view once per id per mount (logged in only)
        if (isLoggedIn && viewRecordedFor !== id) {
          try {
            const resp = await recordView(id);
            if (!cancelled && resp?.views != null) {
              setVideo((prev) => (prev ? { ...prev, views: resp.views } : prev));
              setViewRecordedFor(id);
            }
          } catch (e) {
            console.warn("recordView failed:", e?.message || e);
          }
        }

        const all = await getVideos({ category: v.category });
        if (cancelled) return;
        setSuggested(all.filter((x) => String(x.id) !== String(id)).slice(0, 12));

        // ratings
        if (isLoggedIn) {
          try {
            const mine = await getMyRating(id);
            if (!cancelled) {
              setMyRating(mine?.rating ?? null);
              setMyRatingLoaded(true);
            }
          } catch {
            if (!cancelled) {
              setMyRating(null);
              setMyRatingLoaded(false);
            }
          }
        } else {
          setMyRating(null);
          setMyRatingLoaded(false);
        }

        // comments
        setCommentsBusy(true);
        const c = await getComments(id);
        if (!cancelled) setComments(c?.items ?? []);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setCommentsBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, isLoggedIn, viewRecordedFor]);

  // -----------------------
  // Ratings (optimistic stars only, then reconcile)
  // -----------------------
  async function handleRate(n) {
    if (!isLoggedIn) return onRequireLogin?.();

    // optimistic stars (safe)
    setMyRating(n);

    try {
      setRatingBusy(true);
      await rateVideo(id, n);

      // reconcile server truth
      const [freshVideo, mine] = await Promise.allSettled([getVideo(id), getMyRating(id)]);

      if (freshVideo.status === "fulfilled") {
        setVideo(freshVideo.value);
      }

      if (mine.status === "fulfilled") {
        setMyRating(mine.value?.rating ?? n);
        setMyRatingLoaded(true);
      } else {
        setMyRatingLoaded(false);
      }
    } catch (e) {
      console.error(e);
      // keep optimistic value; server may not have saved
    } finally {
      setRatingBusy(false);
    }
  }

  // -----------------------
  // Comments: post
  // -----------------------
  const canPost = useMemo(() => commentBody.trim().length > 0, [commentBody]);

  async function handlePostComment(e) {
    e.preventDefault();
    setCommentError("");

    if (!isLoggedIn) return onRequireLogin?.();

    const body = commentBody.trim();
    if (!body) return;

    try {
      setCommentPostBusy(true);
      const resp = await postComment(id, body);
      const newComment = resp?.comment;

      if (newComment) {
        setComments((prev) => [newComment, ...prev]);
        setCommentBody("");
      }
    } catch (e) {
      console.error(e);
      setCommentError(e?.message || "Failed to post comment");
    } finally {
      setCommentPostBusy(false);
    }
  }

  // -----------------------
  // Like (supports comments + replies)
  // -----------------------
  async function handleToggleLike(targetId) {
    if (!isLoggedIn) return onRequireLogin?.();

    // optimistic (top-level + replies)
    setComments((prev) =>
      prev.map((c) => {
        if (c.id === targetId) {
          const liked = !c.likedByMe;
          const likeCount = Math.max(0, (c.likeCount || 0) + (liked ? 1 : -1));
          return { ...c, likedByMe: liked, likeCount };
        }

        const replies = Array.isArray(c.replies) ? c.replies : [];
        const hit = replies.some((r) => r.id === targetId);
        if (!hit) return c;

        return {
          ...c,
          replies: replies.map((r) => {
            if (r.id !== targetId) return r;
            const liked = !r.likedByMe;
            const likeCount = Math.max(0, (r.likeCount || 0) + (liked ? 1 : -1));
            return { ...r, likedByMe: liked, likeCount };
          }),
        };
      })
    );

    try {
      const resp = await toggleCommentLike(targetId);

      setComments((prev) =>
        prev.map((c) => {
          if (c.id === targetId) {
            return {
              ...c,
              likedByMe: !!resp.liked,
              likeCount: Number(resp.likeCount ?? c.likeCount ?? 0),
            };
          }

          const replies = Array.isArray(c.replies) ? c.replies : [];
          const hit = replies.some((r) => r.id === targetId);
          if (!hit) return c;

          return {
            ...c,
            replies: replies.map((r) =>
              r.id === targetId
                ? {
                    ...r,
                    likedByMe: !!resp.liked,
                    likeCount: Number(resp.likeCount ?? r.likeCount ?? 0),
                  }
                : r
            ),
          };
        })
      );
    } catch (e) {
      console.error(e);
      // rollback: refetch
      try {
        const c = await getComments(id);
        setComments(c?.items ?? []);
      } catch {}
    }
  }

  // -----------------------
  // Edit (comment or reply)
  // -----------------------
  function startEditItem(item, parentId = null) {
    if (!isLoggedIn) return onRequireLogin?.();
    if (!isOwner(item)) return;
    setEditing({ id: item.id, parentId });
    setEditingBody(item.body || "");
  }

  function cancelEdit() {
    setEditing(null);
    setEditingBody("");
  }

  const canSaveEdit = useMemo(
    () => editingBody.trim().length > 0 && !!editing,
    [editingBody, editing]
  );

  async function saveEditItem(targetId, parentId = null) {
    if (!isLoggedIn) return onRequireLogin?.();

    const body = editingBody.trim();
    if (!body) return;

    try {
      setEditBusy(true);
      const resp = await editComment(targetId, body);
      const updated = resp?.comment;
      if (!updated) return;

      setComments((prev) =>
        prev.map((c) => {
          if (parentId == null) {
            if (c.id !== targetId) return c;
            return { ...c, body: updated.body, updatedAt: updated.updatedAt ?? c.updatedAt };
          }

          if (c.id !== parentId) return c;
          const replies = Array.isArray(c.replies) ? c.replies : [];
          return {
            ...c,
            replies: replies.map((r) =>
              r.id === targetId
                ? { ...r, body: updated.body, updatedAt: updated.updatedAt ?? r.updatedAt }
                : r
            ),
          };
        })
      );

      cancelEdit();
    } catch (e) {
      console.error(e);
    } finally {
      setEditBusy(false);
    }
  }

  // -----------------------
  // Delete (comment or reply)
  // -----------------------
  function requestDeleteItem(targetId, parentId = null) {
    if (!isLoggedIn) return onRequireLogin?.();
    setDeleteTarget({ id: targetId, parentId });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    const { id: targetId, parentId } = deleteTarget;
    setDeleteTarget(null);

    if (!isLoggedIn) return onRequireLogin?.();

    try {
      await deleteComment(targetId);

      setComments((prev) =>
        prev
          .map((c) => {
            if (parentId != null) {
              if (c.id !== parentId) return c;
              const replies = Array.isArray(c.replies) ? c.replies : [];
              return { ...c, replies: replies.filter((r) => r.id !== targetId) };
            }
            return c;
          })
          .filter((c) => (parentId == null ? c.id !== targetId : true))
      );

      if (editing?.id === targetId) cancelEdit();

      // if composer anchored to deleted item, close it
      if (replyingTo?.anchorId === targetId) {
        setReplyingTo(null);
        setReplyBody("");
      }
    } catch (e) {
      console.error(e);
    }
  }

  // -----------------------
  // Replies (placement-aware, still 1-level deep)
  // -----------------------
  function toggleReplies(commentId) {
    setOpenReplies((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });

    // if collapsing a thread that currently contains the composer, close it
    if (replyingTo?.parentId === commentId && openReplies.has(commentId)) {
      setReplyingTo(null);
      setReplyBody("");
    }
  }

  // parentId = top-level comment id
  // anchorId = where composer should show (comment id OR reply id)
  function openReplyComposer(parentId, anchorId, prefill = "") {
    if (!isLoggedIn) return onRequireLogin?.();

    setOpenReplies((prev) => {
      const next = new Set(prev);
      next.add(parentId);
      return next;
    });

    setReplyingTo({ parentId, anchorId });
    setReplyBody(prefill);
  }

  async function handlePostReply(parentCommentId) {
    if (!isLoggedIn) return onRequireLogin?.();

    const body = replyBody.trim();
    if (!body) return;

    try {
      setReplyBusy(true);
      const resp = await postComment(id, body, parentCommentId);
      const newReply = resp?.comment;

      if (newReply) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentCommentId
              ? { ...c, replies: [newReply, ...(c.replies || [])] }
              : c
          )
        );
        setReplyBody("");
        setReplyingTo(null);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setReplyBusy(false);
    }
  }

  if (!video) return <div className="shell">Loading…</div>;

  const channelUsername = video.channelUsername;
  const channelDisplay = video.channelDisplayName || channelUsername;
  const channelAvatarUrl = video.channelAvatarUrl || "";

  const avgNum = toNumOrNull(video?.ratingAvg);
  const myNum = toNumOrNull(myRating);
  //const starValue = myNum ?? avgNum ?? 0;

  return (
    <div className="shell">
      <main className="watchLayout">
        <section className="playerArea">
          <video className="player" controls src={streamUrl(video)} />

          <h1 className="watchTitle">{video.title}</h1>

          <div className="watchChannelRow">
            <div className="watchChannelLeft">
              <NavLink
                to={channelUsername ? `/u/${channelUsername}` : "#"}
                className="watchChannelAvatarLink"
                onClick={(e) => {
                  if (!channelUsername) e.preventDefault();
                }}
              >
                <div
                  className="watchChannelAvatar"
                  style={channelAvatarUrl ? { backgroundImage: `url(${channelAvatarUrl})` } : undefined}
                  aria-label="Channel avatar"
                >
                  {!channelAvatarUrl ? (channelDisplay?.[0]?.toUpperCase() || "?") : null}
                </div>
              </NavLink>

              <div className="watchChannelMeta">
                <NavLink
                  to={channelUsername ? `/u/${channelUsername}` : "#"}
                  className="watchChannelNameLink"
                  onClick={(e) => {
                    if (!channelUsername) e.preventDefault();
                  }}
                >
                  <div className="watchChannelName">{channelDisplay}</div>
                </NavLink>

                <div className="watchChannelSub">
                  <span>{formatInt(video.views)} views</span>
                  {video.createdAt ? (
                    <>
                      <span className="dot">•</span>
                      <span>Uploaded {timeAgo(video.createdAt)}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>


          {video.description ? (
            <div className="watchDescriptionBlock">
              <div className="watchDescriptionHeader">Description:</div>
              <div className="watchDesc">{video.description}</div>
            </div>
          ) : null}


          <div className="watchRatingBlock">
          <StarRating
            value={myRating}
            avg={video.ratingAvg ?? null}
            count={video.ratingCount ?? 0}
            disabled={ratingBusy}
            onRate={handleRate}
          />

          <div className="watchRatingMeta">
            {myRating ? (
              <div className="watchYourRating">
                Your rating: <span className="watchYourRatingValue">{myRating}</span>
              </div>
            ) : (
              <div className="watchYourRating watchMuted">Your rating: —</div>
            )}

            <div className="watchCommunityRating watchMuted">
              Community: {(Number(video.ratingAvg) || 0).toFixed(2)} •{" "}
              {video.ratingCount ?? 0} rating{(video.ratingCount ?? 0) === 1 ? "" : "s"}
            </div>
          </div>
        </div>


          

          {/* =========================
              COMMENTS + REPLIES (restored)
             ========================= */}
          <div className="commentsSection">
            <div className="commentsHeader">
              <h3 className="commentsTitle">
                Comments {commentsBusy ? "…" : `(${comments.length})`}
              </h3>

              {!isLoggedIn ? (
                <button
                  className="commentsLoginHint"
                  onClick={() => onRequireLogin?.()}
                  type="button"
                >
                  Log in
                </button>
              ) : null}
            </div>

            {/* Composer */}
            <form className="commentComposer" onSubmit={handlePostComment}>
              <div className="commentComposerBody">
                <textarea
                  className="commentTextarea commentInput"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  placeholder={isLoggedIn ? "Add a comment…" : "Log in to comment…"}
                  rows={3}
                  disabled={!isLoggedIn || commentPostBusy}
                />
                <div className="commentComposerActions">
                  <div className="commentComposerButtons">
                    <button
                      className="btnPrimary commentPostBtn"
                      type="submit"
                      disabled={!isLoggedIn || !canPost || commentPostBusy}
                    >
                      {commentPostBusy ? "Posting…" : "Post"}
                    </button>

                    {!isLoggedIn ? (
                      <button
                        className="btnGhost commentLoginBtn"
                        type="button"
                        onClick={() => onRequireLogin?.()}
                      >
                        Log in
                      </button>
                    ) : null}
                  </div>

                  {commentError ? <div className="commentError">{commentError}</div> : null}
                </div>
              </div>
            </form>

            {comments.length === 0 && !commentsBusy ? (
              <div className="commentEmpty commentsEmpty">No comments yet.</div>
            ) : null}

            <div className="commentList">
              {comments.map((c) => {
                const repliesOpen = openReplies.has(c.id);
                const isEditingComment = editing?.id === c.id && editing?.parentId == null;

                const commentName = c.displayName || c.username;
                const commentUser = c.username || "";

                const showComposerUnderComment =
                  replyingTo?.parentId === c.id && replyingTo?.anchorId === c.id;

                return (
                  <div key={c.id} className="commentItem">
                    <div className="commentMain">
                      {/* Avatar + username side-by-side */}
                      <div className="commentMeta">
                        <NavLink
                          to={commentUser ? `/u/${commentUser}` : "#"}
                          className="commentAvatarLink"
                          onClick={(e) => {
                            if (!commentUser) e.preventDefault();
                          }}
                          title={commentName}
                        >
                          <div className="commentAvatar">{initialLetter(commentName)}</div>
                        </NavLink>

                        <NavLink
                          to={commentUser ? `/u/${commentUser}` : "#"}
                          className="commentUserLink"
                          onClick={(e) => {
                            if (!commentUser) e.preventDefault();
                          }}
                        >
                          <span className="commentAuthor">{commentName}</span>
                        </NavLink>

                        <span className="dot">•</span>
                        <span className="commentTime">{c.createdAt ? timeAgo(c.createdAt) : ""}</span>

                        {c.updatedAt && c.updatedAt !== c.createdAt ? (
                          <>
                            <span className="dot">•</span>
                            <span className="commentEdited">edited</span>
                          </>
                        ) : null}
                      </div>

                      {/* body or edit */}
                      {isEditingComment ? (
                        <div className="commentEditBox">
                          <div className="commentEdit">
                            <textarea
                              className="commentEditInput"
                              value={editingBody}
                              onChange={(e) => setEditingBody(e.target.value)}
                              rows={3}
                              disabled={editBusy}
                            />
                            <div className="commentEditActions">
                              <button
                                className="commentMiniBtn primary"
                                type="button"
                                disabled={!canSaveEdit || editBusy}
                                onClick={() => saveEditItem(c.id, null)}
                              >
                                {editBusy ? "Saving…" : "Save"}
                              </button>
                              <button className="commentMiniBtn" type="button" onClick={cancelEdit}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="commentBody">{c.body}</div>
                      )}

                      {/* actions row */}
                      <div className="commentActions">
                        <button
                          type="button"
                          className={`actionBtn ${c.likedByMe ? "isActive" : ""}`}
                          onClick={() => handleToggleLike(c.id)}
                          disabled={!isLoggedIn}
                        >
                          {c.likedByMe ? "♥" : "♡"} Like{" "}
                          <span className="actionCount">({c.likeCount || 0})</span>
                        </button>

                        {/* Reply on COMMENT: composer under comment */}
                        <button
                          type="button"
                          className="actionBtn"
                          onClick={() => openReplyComposer(c.id, c.id)}
                          disabled={!isLoggedIn}
                        >
                          Reply
                        </button>

                        <button
                          type="button"
                          className="actionBtn subtle"
                          onClick={() => toggleReplies(c.id)}
                        >
                          {repliesOpen ? "Hide replies" : "Show replies"}{" "}
                          <span className="actionCount">({(c.replies || []).length})</span>
                        </button>

                        {/* owner-only buttons */}
                        {isOwner(c) ? (
                          <>
                            <button
                              type="button"
                              className="actionBtn subtle"
                              onClick={() => startEditItem(c, null)}
                              disabled={!isLoggedIn}
                            >
                              Edit
                            </button>

                            <button
                              type="button"
                              className="actionBtn danger"
                              onClick={() => requestDeleteItem(c.id, null)}
                              disabled={!isLoggedIn}
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>

                      {/* Composer UNDER COMMENT */}
                      {showComposerUnderComment ? (
                        <div className="replyComposer">
                          <textarea
                            className="replyInput"
                            value={replyBody}
                            onChange={(e) => setReplyBody(e.target.value)}
                            placeholder="Write a reply…"
                            rows={3}
                            disabled={!isLoggedIn || replyBusy}
                          />
                          <div className="replyActions">
                            <button
                              className="commentMiniBtn primary"
                              type="button"
                              disabled={!replyBody.trim() || replyBusy}
                              onClick={() => handlePostReply(c.id)}
                            >
                              {replyBusy ? "Posting…" : "Post reply"}
                            </button>
                            <button
                              className="commentMiniBtn"
                              type="button"
                              onClick={() => {
                                setReplyingTo(null);
                                setReplyBody("");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {/* Replies list */}
                      {repliesOpen ? (
                        <div className="replyList">
                          {(c.replies || []).map((r) => {
                            const isEditingReply =
                              editing?.id === r.id && String(editing?.parentId) === String(c.id);

                            const replyName = r.displayName || r.username;
                            const replyUser = r.username || "";

                            const showComposerUnderThisReply =
                              replyingTo?.parentId === c.id && replyingTo?.anchorId === r.id;

                            return (
                              <div key={r.id} className="replyItem">
                                <div className="commentMain">
                                  {/* Reply avatar + username side-by-side */}
                                  <div className="commentMeta">
                                    <NavLink
                                      to={replyUser ? `/u/${replyUser}` : "#"}
                                      className="replyAvatarLink"
                                      onClick={(e) => {
                                        if (!replyUser) e.preventDefault();
                                      }}
                                      title={replyName}
                                    >
                                      <div className="commentAvatar small">
                                        {initialLetter(replyName)}
                                      </div>
                                    </NavLink>

                                    <NavLink
                                      to={replyUser ? `/u/${replyUser}` : "#"}
                                      className="replyUserLink"
                                      onClick={(e) => {
                                        if (!replyUser) e.preventDefault();
                                      }}
                                    >
                                      <span className="commentAuthor">{replyName}</span>
                                    </NavLink>

                                    <span className="dot">•</span>
                                    <span className="commentTime">
                                      {r.createdAt ? timeAgo(r.createdAt) : ""}
                                    </span>

                                    {r.updatedAt && r.updatedAt !== r.createdAt ? (
                                      <>
                                        <span className="dot">•</span>
                                        <span className="commentEdited">edited</span>
                                      </>
                                    ) : null}
                                  </div>

                                  {isEditingReply ? (
                                    <div className="commentEditBox">
                                      <div className="commentEdit">
                                        <textarea
                                          className="commentEditInput"
                                          value={editingBody}
                                          onChange={(e) => setEditingBody(e.target.value)}
                                          rows={3}
                                          disabled={editBusy}
                                        />
                                        <div className="commentEditActions">
                                          <button
                                            className="commentMiniBtn primary"
                                            type="button"
                                            disabled={!canSaveEdit || editBusy}
                                            onClick={() => saveEditItem(r.id, c.id)}
                                          >
                                            {editBusy ? "Saving…" : "Save"}
                                          </button>
                                          <button
                                            className="commentMiniBtn"
                                            type="button"
                                            onClick={cancelEdit}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="commentBody replyBody">{r.body}</div>
                                  )}

                                  {/* reply actions row */}
                                  <div className="replyActionsRow">
                                    <button
                                      type="button"
                                      className={`actionBtn ${r.likedByMe ? "isActive" : ""}`}
                                      onClick={() => handleToggleLike(r.id)}
                                      disabled={!isLoggedIn}
                                    >
                                      {r.likedByMe ? "♥" : "♡"} Like{" "}
                                      <span className="actionCount">({r.likeCount || 0})</span>
                                    </button>

                                    {/* Reply ON REPLY: composer placed under this reply, but posts to parent comment */}
                                    <button
                                      type="button"
                                      className="actionBtn subtle"
                                      onClick={() =>
                                        openReplyComposer(
                                          c.id,
                                          r.id,
                                          replyUser ? `@${replyUser} ` : ""
                                        )
                                      }
                                      disabled={!isLoggedIn}
                                    >
                                      Reply
                                    </button>

                                    {isOwner(r) ? (
                                      <div className="replyMenu">
                                        <button
                                          type="button"
                                          className="actionBtn subtle"
                                          onClick={() => startEditItem(r, c.id)}
                                          disabled={!isLoggedIn}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          className="actionBtn danger"
                                          onClick={() => requestDeleteItem(r.id, c.id)}
                                          disabled={!isLoggedIn}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>

                                  {/* Composer UNDER THIS REPLY */}
                                  {showComposerUnderThisReply ? (
                                    <div className="replyComposer">
                                      <textarea
                                        className="replyInput"
                                        value={replyBody}
                                        onChange={(e) => setReplyBody(e.target.value)}
                                        placeholder="Write a reply…"
                                        rows={3}
                                        disabled={!isLoggedIn || replyBusy}
                                      />
                                      <div className="replyActions">
                                        <button
                                          className="commentMiniBtn primary"
                                          type="button"
                                          disabled={!replyBody.trim() || replyBusy}
                                          onClick={() => handlePostReply(c.id)}
                                        >
                                          {replyBusy ? "Posting…" : "Post reply"}
                                        </button>
                                        <button
                                          className="commentMiniBtn"
                                          type="button"
                                          onClick={() => {
                                            setReplyingTo(null);
                                            setReplyBody("");
                                          }}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="suggestArea">
          <div className="suggestTitle">More in {video.category}</div>
          <div className="suggestList">
            {suggested.map((v) => (
              <button
                key={v.id}
                className="suggestItem"
                onClick={() => nav(`/watch/${v.id}`)}
                type="button"
              >
                <div className="suggestText">
                  <div className="suggestName">{v.title}</div>
                  <div className="suggestSub">{v.category}</div>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </main>

      {deleteTarget && (
        <ConfirmModal
          title="Delete comment?"
          message="This action cannot be undone."
          confirmLabel="Delete"
          cancelLabel="Cancel"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
