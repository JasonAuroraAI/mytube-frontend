const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:3001").replace(/\/$/, "");

// helper
function qs(paramsObj = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(paramsObj)) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      params.set(k, v);
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

// VIDEOS
export async function getVideos({ q, category } = {}) {
  const url = `${API_BASE}/api/videos${qs({ q, category })}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`getVideos failed: ${res.status}`);
  return res.json();
}

export async function getCategories() {
  const res = await fetch(`${API_BASE}/api/categories`, { credentials: "include" });
  if (!res.ok) throw new Error(`getCategories failed: ${res.status}`);
  return res.json();
}

export async function getVideo(id) {
  const res = await fetch(`${API_BASE}/api/videos/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error(`getVideo failed: ${res.status}`);
  return res.json();
}

// THUMBS
export function thumbUrl(video) {
  return video?.thumbUrl || "";
}

// STREAM
export function streamUrl(videoOrId) {
  if (!videoOrId) return "";

  if (typeof videoOrId === "object" && videoOrId.playbackUrl) {
    return videoOrId.playbackUrl;
  }

  const id = typeof videoOrId === "object" ? videoOrId.id : videoOrId;
  return `${API_BASE}/videos/${id}/stream`;
}

// RATINGS
export async function rateVideo(id, rating) {
  const res = await fetch(`${API_BASE}/api/videos/${id}/rate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ rating }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `rateVideo failed: ${res.status}`);
  return data;
}

export async function getMyRating(id) {
  const res = await fetch(`${API_BASE}/api/videos/${id}/my-rating`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { rating: null };
  return data;
}

// COMMENTS
export async function getComments(videoId, { limit = 50, offset = 0 } = {}) {
  const res = await fetch(
    `${API_BASE}/api/videos/${videoId}/comments?limit=${limit}&offset=${offset}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`getComments failed: ${res.status}`);
  return res.json();
}

export async function postComment(videoId, body, parentCommentId = null) {
  const res = await fetch(`${API_BASE}/api/videos/${videoId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ body, parentCommentId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `postComment failed: ${res.status}`);
  return data;
}

export async function uploadVideo({ title, description, tags, visibility, file }) {
  const fd = new FormData();
  fd.append("title", title);
  fd.append("description", description || "");
  fd.append("tags", tags || "");
  fd.append("visibility", visibility || "public");
  fd.append("video", file); // must match upload.single("video")

  const res = await fetch(`${API_BASE}/api/videos/upload`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `uploadVideo failed: ${res.status}`);
  return data; // { ok, video }
}

export async function toggleCommentLike(commentId) {
  const res = await fetch(`${API_BASE}/api/comments/${commentId}/toggle-like`, {
    method: "POST",
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `toggleCommentLike failed: ${res.status}`);
  return data;
}

export async function editComment(commentId, body) {
  const res = await fetch(`${API_BASE}/api/comments/${commentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ body }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `editComment failed: ${res.status}`);
  return data;
}

export async function deleteComment(commentId) {
  const res = await fetch(`${API_BASE}/api/comments/${commentId}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `deleteComment failed: ${res.status}`);
  return data;
}

export async function deleteVideo(videoId) {
  const res = await fetch(`${API_BASE}/api/videos/${videoId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `deleteVideo failed: ${res.status}`);
  return data;
}

// PROFILES
export async function getProfileByUsername(username) {
  const res = await fetch(
    `${API_BASE}/api/profile/u/${encodeURIComponent(username)}`,
    { credentials: "include" }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `getProfile failed: ${res.status}`);
  return data;
}

export async function getMyProfile() {
  const res = await fetch(`${API_BASE}/api/profile/me`, {
    credentials: "include",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `getMyProfile failed: ${res.status}`);
  return data;
}

export async function updateMyProfile(payload) {
  const res = await fetch(`${API_BASE}/api/profile/me`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `updateMyProfile failed: ${res.status}`);
  return data.profile;
}

export async function recordView(id) {
  const r = await fetch(`${API_BASE}/api/videos/${id}/view`, {
    method: "POST",
    credentials: "include",
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Failed to record view");
  return data;
}

export async function getUserVideos(username, { sort } = {}) {
  const params = new URLSearchParams();
  if (sort) params.set("sort", sort);

  const res = await fetch(
    `${API_BASE}/api/profile/u/${encodeURIComponent(username)}/videos?${params.toString()}`,
    { credentials: "include" }
  );

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `getUserVideos failed: ${res.status}`);
  return data;
}
