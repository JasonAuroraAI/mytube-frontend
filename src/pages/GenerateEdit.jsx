// GenerateEdit.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./GenerateEdit.css";
import { getUserVideos, whoami, streamUrl, thumbUrl } from "../api.js";
import GeneratePublishModal from "./GeneratePublishModal.jsx";

const PROJECTS_INDEX_LS_KEY = "mytube_generate_projects_v1"; // list of { id, sequenceTitle, updatedAt }

function safeJsonParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function makeProjectId() {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function projectKey(id) {
  return `genproj:${id}`;
}

function loadProjectIndex() {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(PROJECTS_INDEX_LS_KEY);
  const arr = safeJsonParse(raw, []);
  return Array.isArray(arr) ? arr : [];
}

function saveProjectIndex(arr) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECTS_INDEX_LS_KEY, JSON.stringify(arr));
}

function loadProjectById(id) {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(projectKey(id));
  const obj = safeJsonParse(raw, null);
  return obj && typeof obj === "object" ? obj : null;
}

function saveProjectById(id, payload) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(projectKey(id), JSON.stringify(payload));
}

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function fmtRulerLabel(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `0:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(n, b));
}

function snapSeconds(t, step) {
  return Math.round(t / step) * step;
}

function clipLen(c) {
  return Math.max(0, (Number(c.out) || 0) - (Number(c.in) || 0));
}

/**
 * Multi-track clip model
 * kind: "video" | "audio"
 * track: number
 */
function makeTimelineItem({ kind, track, video, start, sourceDuration }) {
  const srcDur = Number(sourceDuration ?? video?.durationSeconds ?? 12);
  return {
    key: `${kind}-${video?.id ?? "x"}-${track}-${start}-${Date.now()}`,
    kind,
    track,
    video,
    start,
    sourceDuration: srcDur,
    in: 0,
    out: srcDur,
  };
}

export default function GenerateEdit({ user }) {
  const nav = useNavigate();
  const { projectId: routeProjectId } = useParams();

  // -------- Project state --------
  const [projectId, setProjectId] = useState(routeProjectId || "");
  const [dirty, setDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [sequenceTitle, setSequenceTitle] = useState("Timeline");
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  const [clips, setClips] = useState([]);
  const [playhead, setPlayhead] = useState(0);
  const [activeClipKey, setActiveClipKey] = useState(null);
  const [selectedClipKeys, setSelectedClipKeys] = useState(() => new Set());
  const selectedClipKeysRef = useRef(new Set());
  useEffect(() => {
    selectedClipKeysRef.current = selectedClipKeys;
  }, [selectedClipKeys]);

  // --- Drag box select (marquee) ---
  const [boxSel, setBoxSel] = useState(null); // { left, top, width, height } in px (relative to timeStack)
  const [boxHoverKeys, setBoxHoverKeys] = useState(() => new Set()); // ✅ live hover highlight
  const isBoxSelectingRef = useRef(false);
  const boxStartRef = useRef({ x: 0, y: 0 }); // client coords
  const boxAdditiveRef = useRef(false);

  


  const [publishOpen, setPublishOpen] = useState(false);

  // Library
  const [libTab, setLibTab] = useState("video");
  const [me, setMe] = useState(null);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [libErr, setLibErr] = useState("");
  const [selectedVideo, setSelectedVideo] = useState(null);

  // Refs
  const timelineViewportRef = useRef(null);
  const timelineScrollRef = useRef(null);
  const timelineOriginRef = useRef(null); // ✅ now refers to the time-stack (header + lanes)
  const titleInputRef = useRef(null);

  // ✅ Single viewer element
  const videoRef = useRef(null);

  // Player UI
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  const durationCacheRef = useRef(new Map());

  // Interaction refs
  const isScrubbingRef = useRef(false);
  const isDraggingPlayheadRef = useRef(false);

  const isDraggingClipRef = useRef(false);
  const dragClipKeyRef = useRef(null);
  const dragClipStartRef = useRef(0);
  const dragStartClientXRef = useRef(0);
  const dragStartClientYRef = useRef(0);
  const dragOrigTrackRef = useRef(null);
  const didMoveClipRef = useRef(false);
  const dragGroupRef = useRef([]); // [{ key, start, kind, track }]
  const dragGroupPrimaryKeyRef = useRef(null);
  const dragGroupPrimaryStartRef = useRef(0);

  const isTrimmingRef = useRef(false);
  const trimSideRef = useRef(null);
  const trimKeyRef = useRef(null);
  const trimStartXRef = useRef(0);
  const trimOrigRef = useRef(null);

  const didHydrateRef = useRef(false);

  // Playback “state machine”
  const wantedPlayRef = useRef(false); // user intent
  const playheadRef = useRef(0);
  const isAdvancingRef = useRef(false);

  const isSwappingSrcRef = useRef(false);
  const lastProgressTimeRef = useRef({ t: 0, at: performance.now() });

  // What is currently loaded in the <video> (avoid accidental src churn)
  const loadedClipKeyRef = useRef(null);
  const loadedSrcRef = useRef("");

  // Avoid stale async loads/seeks
  const loadTokenRef = useRef(0);

  // Resume retry token
  const resumeTokenRef = useRef(0);

  // Constants
  // Zoom (pixels-per-second). Bigger = zoom in, smaller = zoom out.
  const [pps, setPps] = useState(40);
  const PPS = pps; // keep your existing math mostly unchanged
  const MIN_LEN = 0.25;
  const EDGE_SNAP_SEC = 0.2;
  const prevPpsRef = useRef(pps);

  // Tooling
  const [tool, setTool] = useState("select"); // "select" | "razor"
  const [razorHoverT, setRazorHoverT] = useState(null); // timeline seconds under cursor in razor mode
  const RAZOR_SNAP_SEC = 0.25;

  // UI-only duration overrides for videos missing durationSeconds
  const [libDurMap, setLibDurMap] = useState(() => new Map());

  // Tracks
  const VIDEO_TRACKS = [{ kind: "video", track: 0, label: "V1" }];
  const AUDIO_TRACKS = [
    { kind: "audio", track: 0, label: "A1" },
    { kind: "audio", track: 1, label: "A2" },
    { kind: "audio", track: 2, label: "A3" },
  ];
  const LANES = [...VIDEO_TRACKS, ...AUDIO_TRACKS];

  // -------- Route -> ensure project id exists --------
  useEffect(() => {
    if (!routeProjectId) {
      const newId = makeProjectId();
      nav(`/generate/edit/${newId}`, { replace: true });
      return;
    }
    setProjectId(routeProjectId);
  }, [routeProjectId, nav]);

  // -------- Load project on id change --------
  useEffect(() => {
    if (!projectId) return;

    didHydrateRef.current = false;
    setDirty(false);

    const p = loadProjectById(projectId);
    if (p) {
      setSequenceTitle(String(p.sequenceTitle || "Timeline"));

      const loaded = Array.isArray(p.clips) ? p.clips : Array.isArray(p.timeline) ? p.timeline : [];

      const migrated = loaded
        .filter(Boolean)
        .map((c) => {
          if (c.kind && Number.isFinite(Number(c.track))) return c;
          return { ...c, kind: "video", track: 0 };
        })
        .map((c) => {
          if (c?.kind === "video") return { ...c, track: 0 };
          return c;
        });

      setClips(migrated);
      setPlayhead(Number.isFinite(Number(p.playhead)) ? Math.max(0, Number(p.playhead)) : 0);
    } else {
      const initial = {
        id: projectId,
        sequenceTitle: "Timeline",
        updatedAt: Date.now(),
        playhead: 0,
        clips: [],
      };
      saveProjectById(projectId, initial);

      const idx = loadProjectIndex();
      const nextIdx = [{ id: projectId, sequenceTitle: "Timeline", updatedAt: initial.updatedAt }, ...idx.filter((x) => x?.id !== projectId)];
      saveProjectIndex(nextIdx);
    }

    // Reset viewer bookkeeping on load
    loadedClipKeyRef.current = null;
    loadedSrcRef.current = "";
    wantedPlayRef.current = false;
    setIsPlaying(false);

    // Hard-stop the element too (prevents “phantom pause/resume” races on navigation)
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {}
    }

    requestAnimationFrame(() => {
      didHydrateRef.current = true;
    });
  }, [projectId]);

  // -------- Mark dirty when editing (after hydrate) --------
  useEffect(() => {
    if (!didHydrateRef.current) return;
    setDirty(true);
  }, [sequenceTitle, clips, playhead]);


    function rectsIntersect(a, b) {
      return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    }

  function setSelectionFromKeys(keys, { additive } = { additive: false }) {
    setSelectedClipKeys((prev) => {
      const base = additive ? new Set(prev) : new Set();
      for (const k of keys) base.add(k);
      return base;
    });

    // Keep "active" sensible: last selected if any, else null
    const arr = Array.from(keys || []);
    if (arr.length) setActiveClipKey(arr[arr.length - 1]);
    else if (!additive) setActiveClipKey(null);
  }

  function onLanesPointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;
    if (tool === "razor") return; // keep lanes inert in razor mode, like Premiere

    // Only start box-select when clicking "empty" lanes background
    if (e.target?.closest?.(".genEditClip")) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;

    // We only want this inside lanes area — this handler is attached to lanes wrapper,
    // so it won't fire for the header anyway.

    e.preventDefault();
    e.stopPropagation();

    isBoxSelectingRef.current = true;
    boxAdditiveRef.current = !!e.shiftKey;

    boxStartRef.current = { x: e.clientX, y: e.clientY };

    // init a tiny box so it appears immediately
    const stack = timelineOriginRef.current;
    if (stack) {
      const r = stack.getBoundingClientRect();
      setBoxSel({
        left: e.clientX - r.left,
        top: e.clientY - r.top,
        width: 1,
        height: 1,
      });
    }

    const onMove = (ev) => {
      if (!isBoxSelectingRef.current) return;

      const stackEl = timelineOriginRef.current;
      if (!stackEl) return;

      const r = stackEl.getBoundingClientRect();

      const x1 = boxStartRef.current.x;
      const y1 = boxStartRef.current.y;
      const x2 = ev.clientX;
      const y2 = ev.clientY;

      const left = Math.min(x1, x2) - r.left;
      const top = Math.min(y1, y2) - r.top;
      const width = Math.abs(x2 - x1);
      const height = Math.abs(y2 - y1);

      setBoxSel({ left, top, width, height });

      // ✅ LIVE highlight: compute what clips intersect the marquee *right now*
      const selRectClient = {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2),
      };

      const els = Array.from(document.querySelectorAll(".genEditClip[data-clip-key]"));
      const hit = new Set();

      for (const el of els) {
        const cr = el.getBoundingClientRect();
        const clipRect = { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
        if (rectsIntersect(selRectClient, clipRect)) {
          const k = el.getAttribute("data-clip-key");
          if (k) hit.add(k);
        }
      }

      setBoxHoverKeys(hit);
    };

    const onUp = (ev) => {
      if (!isBoxSelectingRef.current) return;
      isBoxSelectingRef.current = false;

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      const x1 = boxStartRef.current.x;
      const y1 = boxStartRef.current.y;
      const x2 = ev.clientX;
      const y2 = ev.clientY;

      const dragDx = Math.abs(x2 - x1);
      const dragDy = Math.abs(y2 - y1);

      // Treat as a "click" if the drag was tiny -> clear (unless shift, then do nothing)
      if (dragDx < 3 && dragDy < 3) {
        setBoxSel(null);
        setBoxHoverKeys(new Set()); // ✅
        if (!boxAdditiveRef.current) clearSelection();
        return;
      }

      const selRectClient = {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2),
      };

      // Find any clip element that intersects the box
      const els = Array.from(document.querySelectorAll(".genEditClip[data-clip-key]"));
      const hitKeys = [];

      for (const el of els) {
        const cr = el.getBoundingClientRect();
        const clipRect = { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
        if (rectsIntersect(selRectClient, clipRect)) {
          const k = el.getAttribute("data-clip-key");
          if (k) hitKeys.push(k);
        }
      }

      setSelectionFromKeys(hitKeys, { additive: boxAdditiveRef.current });
      setBoxSel(null);
      setBoxHoverKeys(new Set()); // ✅ clear highlight after selection
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }


  // -- Selection --
  function setSingleSelection(key) {
    const next = new Set();
    if (key) next.add(key);
    setSelectedClipKeys(next);
    setActiveClipKey(key || null);
  }

  function toggleSelectionKey(key) {
    setSelectedClipKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setActiveClipKey(key);
  }

  function clearSelection() {
    setSelectedClipKeys(new Set());
    setActiveClipKey(null);
  }

  // -------- Save project --------
  async function saveProjectNow() {
    if (!projectId) return;

    try {
      setIsSaving(true);

      const payload = {
        id: projectId,
        sequenceTitle: String(sequenceTitle || "Timeline"),
        updatedAt: Date.now(),
        playhead: Number(playhead || 0),
        clips: Array.isArray(clips) ? clips : [],
      };

      saveProjectById(projectId, payload);

      const idx = loadProjectIndex();
      const nextIdx = [{ id: projectId, sequenceTitle: payload.sequenceTitle, updatedAt: payload.updatedAt }, ...idx.filter((x) => x?.id !== projectId)];
      saveProjectIndex(nextIdx);

      setDirty(false);
    } finally {
      setIsSaving(false);
    }
  }

  // -------- AUTH / LIBRARY --------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const w = await whoami();
        if (!alive) return;
        setMe(w || null);
      } catch {
        if (!alive) return;
        setMe(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLibErr("");
        setLoadingLib(true);

        const username = (me?.username || user?.username || "").trim();
        if (!username) {
          setLibraryVideos([]);
          return;
        }

        const vids = await getUserVideos(username);
        if (!alive) return;

        const arr = Array.isArray(vids) ? vids : [];
        setLibraryVideos(arr);
        if (!selectedVideo && arr.length) setSelectedVideo(arr[0]);

        for (const v of arr.slice(0, 10)) {
          const d = Number(v.durationSeconds);
          if (Number.isFinite(d) && d > 0.01) durationCacheRef.current.set(v.id, d);
        }
      } catch (e) {
        if (!alive) return;
        setLibErr(e?.message || "Failed to load your library");
        setLibraryVideos([]);
      } finally {
        if (alive) setLoadingLib(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.username, user?.username]);

  // Rebind stale video objects
  useEffect(() => {
    if (!libraryVideos.length) return;
    setClips((prev) =>
      prev.map((c) => {
        if (c?.kind !== "video") return c;
        const vid = c?.video;
        if (!vid?.id) return c;
        const fresh = libraryVideos.find((v) => String(v.id) === String(vid.id));
        return fresh ? { ...c, video: fresh } : c;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryVideos.length]);

  // -------- Duration helper --------
  async function getVideoDurationSeconds(video) {
    if (!video?.id) return 12;

    const provided = Number(video.durationSeconds);
    if (Number.isFinite(provided) && provided > 0.01) {
      durationCacheRef.current.set(video.id, provided);
      return provided;
    }

    const cached = durationCacheRef.current.get(video.id);
    if (Number.isFinite(cached) && cached > 0.01) return cached;

    const src = streamUrl(video);
    if (!src) return 12;

    const dur = await new Promise((resolve) => {
      const el = document.createElement("video");
      el.preload = "metadata";
      el.muted = true;
      el.playsInline = true;

      const cleanup = () => {
        el.removeAttribute("src");
        el.load();
      };

      el.onloadedmetadata = () => {
        const d = Number(el.duration);
        cleanup();
        resolve(Number.isFinite(d) && d > 0.01 ? d : 12);
      };

      el.onerror = () => {
        cleanup();
        resolve(12);
      };

      el.src = src;
    });

    durationCacheRef.current.set(video.id, dur);
    return dur;
  }

  // -------- Timeline metrics --------
  const clipsSorted = useMemo(() => {
    return clips.slice().sort((a, b) => (a.start - b.start) || (Number(b.track) || 0) - (Number(a.track) || 0));
  }, [clips]);

  const timelineEnd = useMemo(() => {
    if (!clipsSorted.length) return 0;
    return Math.max(...clipsSorted.map((c) => (Number(c.start) || 0) + clipLen(c)));
  }, [clipsSorted]);

  const timelineWidth = Math.max(600, Math.ceil((timelineEnd + 5) * PPS));
  const playheadMax = Math.max(0, Math.ceil(timelineEnd));

  function clipCoversTime(c, t) {
    const s = Number(c.start) || 0;
    const e = s + clipLen(c);
    return t >= s && t < e;
  }

  function findVideoClipAtTime(t) {
    const candidates = clipsSorted.filter((c) => c?.kind === "video" && clipCoversTime(c, t));
    if (!candidates.length) return null;
    // prefer the latest-starting clip if overlaps exist
    candidates.sort((a, b) => (Number(b.start) || 0) - (Number(a.start) || 0));
    return candidates[0];
  }

  function findNextVideoStart(afterT, excludeKey = null) {
    const t = Number(afterT) || 0;
    const EPS = 1e-6; // allow equality (butt-join)
    let best = null;

    for (const c of clipsSorted) {
      if (c?.kind !== "video") continue;
      if (excludeKey && c.key === excludeKey) continue;

      const s = Number(c.start) || 0;
      if (s >= t - EPS && (best == null || s < best)) best = s;
    }
    return best;
  }

  function findPrevVideoStart(beforeT) {
    const t = Number(beforeT) || 0;
    let best = null;
    for (const c of clipsSorted) {
      if (c?.kind !== "video") continue;
      const s = Number(c.start) || 0;
      if (s < t && (best == null || s > best)) best = s;
    }
    return best;
  }

  /**
   * ✅ FIX: “End of timeline” means the playhead is at/after timelineEnd,
   * NOT “there is no next clip start” (that incorrectly flagged *inside the last clip*).
   */
  function atTimelineEnd(t) {
    const tt = Number(t) || 0;
    return tt >= Math.max(0, Number(timelineEnd) || 0) - 0.04;
  }

  const currentVideoClip = useMemo(() => findVideoClipAtTime(playhead), [clipsSorted, playhead]);

  // ✅ IMPORTANT: viewer src is ONLY based on timeline clip at playhead
  const viewerSrc = useMemo(() => {
    const c = currentVideoClip;
    if (!c?.video) return "";
    return streamUrl(c.video) || "";
  }, [currentVideoClip]);

  // ✅ Measure time from time-origin surface (time stack)
  function getTimeFromClientX(clientX) {
    const origin = timelineOriginRef.current;
    if (!origin) return 0;

    const rect = origin.getBoundingClientRect();
    const viewport = timelineViewportRef.current;
    const scrollLeft = viewport ? viewport.scrollLeft : 0;

    const x = clientX - rect.left + scrollLeft;
    return Math.max(0, x / PPS);
  }

  function getLaneFromClientY(clientY) {
    const scroll = timelineScrollRef.current;
    if (!scroll) return null;

    const lanes = scroll.querySelectorAll("[data-lane-kind][data-lane-track]");
    for (const el of lanes) {
      const r = el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) {
        return {
          kind: el.getAttribute("data-lane-kind"),
          track: Number(el.getAttribute("data-lane-track")),
        };
      }
    }
    return null;
  }

  function snapToEdges(nextStart, movingKey) {
    const moving = clips.find((c) => c.key === movingKey);
    if (!moving) return nextStart;

    const movingLen = clipLen(moving);
    const movingStart = nextStart;
    const movingEnd = nextStart + movingLen;

    let best = null;
    const pool = clipsSorted.filter((c) => c?.kind === moving.kind);

    for (const c of pool) {
      if (c.key === movingKey) continue;
      const s = c.start;
      const e = c.start + clipLen(c);

      for (const target of [s, e]) {
        const d = Math.abs(movingStart - target);
        if (d <= EDGE_SNAP_SEC && (!best || d < best.dist)) best = { value: target, dist: d };
      }
      for (const target of [s, e]) {
        const d = Math.abs(movingEnd - target);
        if (d <= EDGE_SNAP_SEC && (!best || d < best.dist)) best = { value: target - movingLen, dist: d };
      }
    }

    return best ? Math.max(0, best.value) : nextStart;
  }

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  // -------- Razor snapping --------
  function snapRazorTime(t) {
    const tt = Math.max(0, Number(t) || 0);

    // Snap targets: playhead, whole seconds, and all clip edges
    const targets = [];

    targets.push(Number(playheadRef.current ?? playhead) || 0);
    targets.push(snapSeconds(tt, 1)); // whole seconds

    for (const c of clipsSorted) {
      const s = Number(c.start) || 0;
      const e = s + clipLen(c);
      targets.push(s, e);
    }

    let best = { value: tt, dist: Infinity };
    for (const x of targets) {
      const d = Math.abs(tt - x);
      if (d < best.dist) best = { value: x, dist: d };
    }

    return best.dist <= RAZOR_SNAP_SEC ? best.value : tt;
  }

  function onTimelinePointerMove(e) {
    if (tool !== "razor") return;
    const raw = getTimeFromClientX(e.clientX);
    const t = e.shiftKey ? snapRazorTime(raw) : raw;
    setRazorHoverT(t);
  }

  function onTimelinePointerLeave() {
    if (tool !== "razor") return;
    setRazorHoverT(null);
  }

  // --------- Viewer: apply mute/vol immediately ---------
  function applyMuteVol() {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.muted = muted;
      v.volume = clamp(Number(volume), 0, 1);
    } catch {}
  }

  useEffect(() => {
    applyMuteVol();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, volume]);

  // Robust wait helper
  function waitForEvent(el, evt, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!el) return reject(new Error("no video element"));
      let done = false;

      const ok = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(true);
      };
      const err = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error(`error while waiting for ${evt}`));
      };

      const t = window.setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error(`timeout waiting for ${evt}`));
      }, timeoutMs);

      const cleanup = () => {
        window.clearTimeout(t);
        el.removeEventListener(evt, ok);
        el.removeEventListener("error", err);
      };

      el.addEventListener(evt, ok, { once: true });
      el.addEventListener("error", err, { once: true });
    });
  }

  // Core: ensure correct clip loaded and seeked for a given timeline time
  async function ensureLoadedForTimelineTime(t, { autoplay } = { autoplay: false }) {
    const v = videoRef.current;
    if (!v) return;

    const token = ++loadTokenRef.current;

    const timelineT = Math.max(0, Number(t) || 0);
    const clip = findVideoClipAtTime(timelineT);

    // If in a gap: jump if user wants play, otherwise pause-ish (idle)
    if (!clip || !clip.video) {
      if (wantedPlayRef.current || autoplay) {
        const ns = findNextVideoStart(timelineT);
        if (ns == null) {
          // end of timeline
          wantedPlayRef.current = false;
          try {
            v.pause();
          } catch {}
          setIsPlaying(false);
          loadedClipKeyRef.current = null;
          loadedSrcRef.current = "";
          return;
        }
        // jump to next clip start and keep playing
        setPlayhead(ns);
        playheadRef.current = ns;
        return ensureLoadedForTimelineTime(ns, { autoplay: true });
      }

      try {
        v.pause();
      } catch {}
      setIsPlaying(false);
      loadedClipKeyRef.current = null;
      loadedSrcRef.current = "";
      return;
    }

    const src = streamUrl(clip.video) || "";
    if (!src) return;

    const local = clamp(timelineT - (Number(clip.start) || 0), 0, clipLen(clip));
    const targetVideoTime = (Number(clip.in) || 0) + local;

    const needsSrcChange = loadedClipKeyRef.current !== clip.key || loadedSrcRef.current !== src;

    if (needsSrcChange) {
      isSwappingSrcRef.current = true;
      try {
        // Pause before swapping src to avoid weird buffered state
        try {
          v.pause();
        } catch {}

        loadedClipKeyRef.current = clip.key;
        loadedSrcRef.current = src;

        if ((v.getAttribute("src") || "") !== src) {
          v.setAttribute("src", src);
        }

        try {
          v.load();
        } catch {}

        try {
          if (v.readyState < 1) {
            await waitForEvent(v, "loadedmetadata", 8000);
          }
        } catch {}

        if (loadTokenRef.current !== token) return;

        applyMuteVol();

        try {
          v.currentTime = targetVideoTime;
        } catch {}

        if (v.readyState < 2) {
          try {
            await waitForEvent(v, "canplay", 5000);
          } catch {}
        }

        if (loadTokenRef.current !== token) return;
      } finally {
        isSwappingSrcRef.current = false;
      }
    } else {
      applyMuteVol();
      const cur = Number(v.currentTime || 0);
      if (Math.abs(cur - targetVideoTime) > 0.03) {
        try {
          v.currentTime = targetVideoTime;
        } catch {}
      }
    }

    if (autoplay || wantedPlayRef.current) {
      const p = v.play?.();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          // autoplay can reject; pause-catcher / resume glue can retry on ready events
        });
      }
    }
  }

  // ---- Pause catcher: only pause at true end-of-timeline or user pause ----
  function forceResume(reason = "") {
    const v = videoRef.current;
    if (!v) return;
    if (!wantedPlayRef.current) return;

    // ✅ FIX: Only treat as finished if playhead is at end.
    const t = playheadRef.current ?? playhead;
    if (atTimelineEnd(t)) {
      wantedPlayRef.current = false;
      setIsPlaying(false);
      return;
    }

    const token = ++resumeTokenRef.current;

    const attempt = (triesLeft) => {
      if (!wantedPlayRef.current) return;
      if (resumeTokenRef.current !== token) return;

      if (!v.paused && !v.ended) return;

      const p = v.play?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
      if (triesLeft <= 0) return;

      window.setTimeout(() => attempt(triesLeft - 1), 120);
    };

    attempt(10);
  }

  function ensureProgressKick(label = "") {
    const v = videoRef.current;
    if (!v) return;
    if (!wantedPlayRef.current) return;

    const start = { ...lastProgressTimeRef.current };

    window.setTimeout(() => {
      const vv = videoRef.current;
      if (!vv) return;
      if (!wantedPlayRef.current) return;
      if (isSwappingSrcRef.current) return;

      const now = performance.now();
      const curT = Number(vv.currentTime || 0);

      // If time advanced, we're good.
      if (curT > start.t + 0.02) return;

      // If we've recently had a timeupdate, also fine.
      if (now - start.at < 300) return;

      // Otherwise: we're "playing" but stuck -> kick it
      forceResume(`progressKick:${label}`);

      // Hard-kick fallback: reload+seek+play if still stuck after a short delay
      window.setTimeout(() => {
        const v2 = videoRef.current;
        if (!v2) return;
        if (!wantedPlayRef.current) return;
        if (!v2.paused && !v2.ended) return;

        const t = playheadRef.current ?? playhead;
        ensureLoadedForTimelineTime(t, { autoplay: true }).finally(() => forceResume("hardKick"));
      }, 250);
    }, 550);
  }

  // Transport: Play/Pause
  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;

    if (wantedPlayRef.current) {
      wantedPlayRef.current = false;
      try {
        v.pause();
      } catch {}
      setIsPlaying(false);
      return;
    }

    wantedPlayRef.current = true;

    const t = playheadRef.current ?? playhead;
    const cur = findVideoClipAtTime(t);

    if (!cur) {
      const ns = findNextVideoStart(t);
      const target = ns != null ? ns : 0;
      setPlayhead(target);
      playheadRef.current = target;
      await ensureLoadedForTimelineTime(target, { autoplay: true });
      forceResume("togglePlay-gap");
      return;
    }

    await ensureLoadedForTimelineTime(t, { autoplay: true });
    forceResume("togglePlay");
  }

  function onSequenceScrub(value) {
    const t = Number(value) || 0;
    isScrubbingRef.current = true;

    // Keep the element aligned while dragging the slider, but don’t autoplay mid-drag.
    ensureLoadedForTimelineTime(t, { autoplay: false }).finally(() => {
      setPlayhead(t);
      playheadRef.current = t;
    });
  }

  function onSequenceScrubCommit(value) {
    const t = Number(value) || 0;
    isScrubbingRef.current = false;
    setPlayhead(t);
    playheadRef.current = t;

    ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("scrubCommit");
    });
  }

  function enterFullscreen() {
    const v = videoRef.current;
    if (!v) return;
    const req = v.requestFullscreen || v.webkitRequestFullscreen || v.mozRequestFullScreen || v.msRequestFullscreen;
    try {
      req?.call(v);
    } catch {}
  }

  function goToStart() {
    const t = 0;
    isScrubbingRef.current = true;
    setPlayhead(t);
    playheadRef.current = t;
    isScrubbingRef.current = false;
    ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("goToStart");
    });
  }

  function goToEnd() {
    const t = Math.max(0, timelineEnd || 0);
    isScrubbingRef.current = true;
    setPlayhead(t);
    playheadRef.current = t;
    isScrubbingRef.current = false;
    ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("goToEnd");
    });
  }

  function prevClip() {
    const t = playheadRef.current ?? playhead;
    const ps = findPrevVideoStart(t);
    const target = ps == null ? 0 : ps;

    isScrubbingRef.current = true;
    setPlayhead(target);
    playheadRef.current = target;
    isScrubbingRef.current = false;

    ensureLoadedForTimelineTime(target, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("prevClip");
    });
  }

  function nextClip() {
    const t = playheadRef.current ?? playhead;
    const ns = findNextVideoStart(t);
    const target = ns == null ? Math.max(0, timelineEnd || 0) : ns;

    isScrubbingRef.current = true;
    setPlayhead(target);
    playheadRef.current = target;
    isScrubbingRef.current = false;

    ensureLoadedForTimelineTime(target, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("nextClip");
    });
  }

  // Advance only when real clip out is reached
  async function advanceToNextClip(endingClip = null) {
    if (isAdvancingRef.current) return;
    isAdvancingRef.current = true;

    const cur = endingClip || findVideoClipAtTime(playheadRef.current ?? playhead);

    const endT = cur ? (Number(cur.start) || 0) + clipLen(cur) : (playheadRef.current ?? playhead);
    const nextStart = findNextVideoStart(endT, cur?.key || null);

    if (nextStart == null) {
      wantedPlayRef.current = false;
      setIsPlaying(false);
      isAdvancingRef.current = false;
      return;
    }

    setPlayhead(nextStart);
    playheadRef.current = nextStart;

    await ensureLoadedForTimelineTime(nextStart, { autoplay: true });
    forceResume("advanceToNextClip");

    window.setTimeout(() => {
      forceResume("advanceToNextClip-delayed");
    }, 80);

    isAdvancingRef.current = false;
  }

  // ✅ Keep UI isPlaying synced to actual <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const sync = () => {
      setIsPlaying(!v.paused && !v.ended);
    };

    sync();
    v.addEventListener("play", sync);
    v.addEventListener("pause", sync);
    v.addEventListener("ended", sync);

    return () => {
      v.removeEventListener("play", sync);
      v.removeEventListener("pause", sync);
      v.removeEventListener("ended", sync);
    };
  }, []);

  // Track real playback progress so we can detect stalls
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      lastProgressTimeRef.current = { t: Number(v.currentTime || 0), at: performance.now() };
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  // ✅ Pause catcher & resume-on-ready glue
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPause = () => {
      if (!wantedPlayRef.current) return;
      if (isSwappingSrcRef.current) return;

      const vv = videoRef.current;
      if (!vv) return;

      // ✅ If we're truly at the end of the whole timeline, stop intent.
      const t = playheadRef.current ?? playhead;
      if (atTimelineEnd(t)) {
        wantedPlayRef.current = false;
        setIsPlaying(false);
        return;
      }

      // Otherwise: unexpected pause (buffering / browser quirk) -> resume
      forceResume("pause");
    };

    const onWaiting = () => forceResume("waiting");
    const onStalled = () => forceResume("stalled");
    const onCanPlay = () => forceResume("canplay");
    const onSeeked = () => forceResume("seeked");
    const onLoadedMeta = () => forceResume("loadedmetadata");

    v.addEventListener("pause", onPause);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("stalled", onStalled);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("loadedmetadata", onLoadedMeta);

    return () => {
      v.removeEventListener("pause", onPause);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("stalled", onStalled);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("loadedmetadata", onLoadedMeta);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineEnd, clipsSorted.length]);

  // Master clock: timeupdate drives playhead; and advances at out point
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const EPS_OUT = 0.15;

    const onTick = () => {
      if (isScrubbingRef.current) return;

      const t = playheadRef.current ?? playhead;
      const clip = findVideoClipAtTime(t);

      // If we are playing and we hit a gap, jump forward immediately.
      if (!clip) {
        if (wantedPlayRef.current) {
          ensureLoadedForTimelineTime(t, { autoplay: true }).finally(() => forceResume("tick-gap"));
        }
        return;
      }

      const clipIn = Number(clip.in) || 0;
      const clipOut = Number(clip.out) || 0;

      const local = clamp((v.currentTime || 0) - clipIn, 0, clipLen(clip));
      const newPlayhead = (Number(clip.start) || 0) + local;

      setPlayhead(newPlayhead);
      playheadRef.current = newPlayhead;

      // ✅ Only advance when the underlying video time reaches OUT
      const ct = Number(v.currentTime || 0);
      if (ct >= clipOut - EPS_OUT) {
        if (!isAdvancingRef.current) {
          advanceToNextClip(clip);
        }
      }
    };

    v.addEventListener("timeupdate", onTick);
    return () => v.removeEventListener("timeupdate", onTick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipsSorted.length, playhead]);

  // When clips change, re-align viewer to current playhead clip if needed
  useEffect(() => {
    const t = playheadRef.current ?? playhead;
    const clip = findVideoClipAtTime(t);
    if (!clip) return;

    if (loadedClipKeyRef.current !== clip.key) {
      ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("clipsChanged");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipsSorted.length]);

  // ✅ When React swaps viewerSrc (playhead crosses into a new clip), ensure the element is aligned.
  useEffect(() => {
    if (!viewerSrc) return;
    const t = playheadRef.current ?? playhead;
    ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("viewerSrcChanged");
      ensureProgressKick("viewerSrcChanged");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerSrc]);

  // -------- Playhead drag (global pointer listeners) --------
  const dragPointerIdRef = useRef(null);

  function onTimelineBackgroundPointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;
    if (isDraggingPlayheadRef.current) return;

    // If you clicked *on* something interactive, do nothing.
    if (e.target?.closest?.(".genEditClip")) return;
    if (e.target?.closest?.(".genEditTrimHandle")) return;
    if (e.target?.closest?.(".genEditClipX")) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;
    if (e.target?.closest?.(".genEditTimeHeader")) return;
    if (e.target?.closest?.(".genEditTimeHeaderHit")) return;

    // Otherwise, you clicked "empty timeline" -> clear selection.
    if (e.shiftKey) return;
    clearSelection();
  }

  function onPlayheadPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    isDraggingPlayheadRef.current = true;
    isScrubbingRef.current = true;
    dragPointerIdRef.current = e.pointerId;

    const t = getTimeFromClientX(e.clientX);
    setPlayhead(t);
    playheadRef.current = t;
    ensureLoadedForTimelineTime(t, { autoplay: false });

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    const onMove = (ev) => {
      if (!isDraggingPlayheadRef.current) return;
      if (dragPointerIdRef.current != null && ev.pointerId !== dragPointerIdRef.current) return;

      const tt = getTimeFromClientX(ev.clientX);
      setPlayhead(tt);
      playheadRef.current = tt;
      ensureLoadedForTimelineTime(tt, { autoplay: false });
    };

    const onUp = (ev) => {
      if (dragPointerIdRef.current != null && ev.pointerId !== dragPointerIdRef.current) return;

      isDraggingPlayheadRef.current = false;
      isScrubbingRef.current = false;
      dragPointerIdRef.current = null;

      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      ensureLoadedForTimelineTime(playheadRef.current ?? playhead, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("playheadUp");
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  // ✅ Only the time header row updates playhead on click
  function onTimeHeaderPointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;

    const t = getTimeFromClientX(e.clientX);

    isScrubbingRef.current = true;
    setPlayhead(t);
    playheadRef.current = t;

    ensureLoadedForTimelineTime(t, { autoplay: false }).finally(() => {
      isScrubbingRef.current = false;
      if (wantedPlayRef.current) {
        ensureLoadedForTimelineTime(t, { autoplay: true }).finally(() => forceResume("timeHeaderClick"));
      }
    });
  }

  // -------- Clip add/remove --------
  async function addVideoToTimelineAt(video, start) {
    const dur = await getVideoDurationSeconds(video);
    const item = makeTimelineItem({
      kind: "video",
      track: 0,
      video,
      start: Math.max(0, start),
      sourceDuration: dur,
    });

    setClips((t) => [...t, item]);
    setActiveClipKey(item.key);

    requestAnimationFrame(() => {
      const el = timelineViewportRef.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }

  function removeFromTimeline(key) {
    setClips((t) => t.filter((x) => x.key !== key));
    if (activeClipKey === key) setActiveClipKey(null);

    if (loadedClipKeyRef.current === key) {
      loadedClipKeyRef.current = null;
      loadedSrcRef.current = "";
      ensureLoadedForTimelineTime(playheadRef.current ?? playhead, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("removeClip");
      });
    }
  }

  // Ctrl/Cmd + S = Save
useEffect(() => {
  const onKeyDown = (e) => {
    const key = (e.key || "").toLowerCase();

    // Ctrl+S (Windows/Linux) or Cmd+S (Mac)
    if ((e.ctrlKey || e.metaKey) && key === "s") {
      e.preventDefault();

      // Optional: don’t save if you're typing in an input/textarea
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (isTyping) return;

      // Avoid spam / no-op
      if (isSaving) return;
      if (!dirty) return;

      saveProjectNow();
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [dirty, isSaving, saveProjectNow]);

  // Delete / Backspace removes selected clip
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (isTyping) return;

      if (e.key === "Escape") {
        clearSelection();
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        const keys = Array.from(selectedClipKeysRef.current || []);
        const fallback = activeClipKey ? [activeClipKey] : [];
        const toRemove = keys.length ? keys : fallback;

        if (toRemove.length) {
          e.preventDefault();
          setClips((prev) => prev.filter((c) => !toRemove.includes(c.key)));

          // cleanup selection/active
          setSelectedClipKeys(new Set());
          setActiveClipKey(null);

          // if we removed loaded clip, re-align viewer
          if (toRemove.includes(loadedClipKeyRef.current)) {
            loadedClipKeyRef.current = null;
            loadedSrcRef.current = "";
            ensureLoadedForTimelineTime(playheadRef.current ?? playhead, { autoplay: wantedPlayRef.current }).finally(() => {
              if (wantedPlayRef.current) forceResume("removeClip");
            });
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipKey]);

  // -------- Clip drag (shift snap) / Razor split --------
  function splitClipAtTime(clipKey, timelineT) {
    setClips((prev) => {
      const clip = prev.find((c) => c.key === clipKey);
      if (!clip) return prev;

      const start = Number(clip.start) || 0;
      const in0 = Number(clip.in) || 0;
      const out0 = Number(clip.out) || 0;

      const len = Math.max(0, out0 - in0);
      if (len <= MIN_LEN * 2) return prev;

      // timelineT must be inside clip bounds
      const local = clamp((Number(timelineT) || 0) - start, 0, len);
      if (local <= MIN_LEN || local >= len - MIN_LEN) return prev;

      const splitVideoTime = in0 + local;

      const left = {
        ...clip,
        key: `${clip.key}-L-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        out: splitVideoTime,
      };

      const right = {
        ...clip,
        key: `${clip.key}-R-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        start: start + local,
        in: splitVideoTime,
        // out stays out0
      };

      const next = [];
      for (const c of prev) {
        if (c.key === clipKey) next.push(left, right);
        else next.push(c);
      }

      setActiveClipKey(right.key);
      return next;
    });
  }

  function onClipPointerDown(e, clipKey) {
    if (isTrimmingRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const t = e.target;
    if (t?.closest?.(".genEditClipX")) return;
    if (t?.closest?.(".genEditTrimHandle")) return;

    // ✅ RAZOR MODE: click clip to split at mouse time
    if (tool === "razor") {
      const raw = getTimeFromClientX(e.clientX);
      const tt = e.shiftKey ? snapRazorTime(raw) : raw;
      setRazorHoverT(tt); // keeps the line “locked” to the exact cut momentarily
      splitClipAtTime(clipKey, tt);
      return;
    }

    // ✅ SELECT MODE (existing drag behavior)
    const clip = clips.find((c) => c.key === clipKey);
    if (!clip) return;

    isDraggingClipRef.current = true;
    dragClipKeyRef.current = clipKey;
    dragClipStartRef.current = Number(clip.start) || 0;
    dragStartClientXRef.current = e.clientX;
    dragStartClientYRef.current = e.clientY;
    dragOrigTrackRef.current = { kind: clip.kind, track: Number(clip.track) || 0 };
    didMoveClipRef.current = false;

    // Build drag group:
    // If the clicked clip is in the selection, drag the whole selection.
    // Otherwise drag just this clip.
    // Also: only drag clips of the same "kind" (video vs audio) as the primary.
    const sel = selectedClipKeysRef.current;
    const primary = clips.find((c) => c.key === clipKey);
    const groupKeys = sel && sel.has(clipKey) ? Array.from(sel) : [clipKey];
    const group = clips
      .filter((c) => groupKeys.includes(c.key))
      .filter((c) => c.kind === primary.kind)
      .map((c) => ({ key: c.key, start: Number(c.start) || 0, kind: c.kind, track: Number(c.track) || 0 }));

    dragGroupRef.current = group;
    dragGroupPrimaryKeyRef.current = clipKey;
    dragGroupPrimaryStartRef.current = Number(primary.start) || 0;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    // Selection behavior:
    // - Shift: toggle selection membership
    // - No shift: if clip isn't already selected, make it the sole selection
    if (e.shiftKey) {
      toggleSelectionKey(clipKey);
    } else {
      const sel = selectedClipKeysRef.current;
      if (!sel || !sel.has(clipKey)) setSingleSelection(clipKey);
      else setActiveClipKey(clipKey);
}
  }

  function onClipPointerMove(e) {
    if (!isDraggingClipRef.current) return;
    if (isDraggingPlayheadRef.current) return;

    const key = dragClipKeyRef.current;
    if (!key) return;

    const dxPx = e.clientX - dragStartClientXRef.current;
    const dyPx = e.clientY - dragStartClientYRef.current;

    if (!didMoveClipRef.current && Math.abs(dxPx) < 3 && Math.abs(dyPx) < 3) return;
    didMoveClipRef.current = true;

    const group = dragGroupRef.current || [];
    const primaryKey = dragGroupPrimaryKeyRef.current || key;

    const primaryOrig = group.find((g) => g.key === primaryKey) || { start: dragClipStartRef.current, kind: null, track: null };
    const dxSeconds = dxPx / PPS;

    // compute proposed new start for PRIMARY, then derive delta
    let nextPrimaryStart = Math.max(0, Number(primaryOrig.start || 0) + dxSeconds);

    // time snap: shift => whole seconds
    if (e.shiftKey) nextPrimaryStart = Math.max(0, snapSeconds(nextPrimaryStart, 1));

    // edge snap (apply using the primary clip key)
    nextPrimaryStart = snapToEdges(nextPrimaryStart, primaryKey);

    const delta = nextPrimaryStart - (Number(primaryOrig.start) || 0);

    // lane change (apply to entire group, Premiere-ish)
    const orig = dragOrigTrackRef.current;
    let nextKind = orig?.kind;
    let nextTrack = orig?.track;

    const lane = getLaneFromClientY(e.clientY);
    if (lane && orig?.kind === lane.kind) {
      nextKind = lane.kind;
      nextTrack = lane.track;
      if (nextKind === "video") nextTrack = 0;
    }

    // Apply delta to every clip in group
    const groupKeySet = new Set(group.map((g) => g.key));

    setClips((prev) =>
      prev.map((c) => {
        if (!groupKeySet.has(c.key)) return c;

        const g = group.find((x) => x.key === c.key);
        const baseStart = Number(g?.start ?? c.start ?? 0);

        // keep group from going negative: clamp each individually
        const movedStart = Math.max(0, baseStart + delta);

        // apply lane change only if same kind as original dragged kind
        // (we already filtered group to same kind as primary, so this is safe)
        return { ...c, start: movedStart, kind: nextKind, track: nextTrack };
      })
    );
  }

  function onClipPointerUp(e) {
    if (!isDraggingClipRef.current) return;

    isDraggingClipRef.current = false;
    dragClipKeyRef.current = null;
    dragClipStartRef.current = 0;
    dragStartClientXRef.current = 0;
    dragStartClientYRef.current = 0;
    dragOrigTrackRef.current = null;
    dragGroupRef.current = [];
    dragGroupPrimaryKeyRef.current = null;
    dragGroupPrimaryStartRef.current = 0;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  // -------- Trim --------
  function onTrimPointerDown(e, clipKey, side) {
    e.preventDefault();
    e.stopPropagation();

    const clip = clips.find((c) => c.key === clipKey);
    if (!clip) return;

    isTrimmingRef.current = true;
    trimSideRef.current = side;
    trimKeyRef.current = clipKey;
    trimStartXRef.current = e.clientX;
    trimOrigRef.current = {
      start: Number(clip.start) || 0,
      in: Number(clip.in) || 0,
      out: Number(clip.out) || 0,
      sourceDuration: Number(clip.sourceDuration) || 0,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    setActiveClipKey(clipKey);
  }

  function onTrimPointerMove(e) {
    if (!isTrimmingRef.current) return;

    const key = trimKeyRef.current;
    const side = trimSideRef.current;
    const orig = trimOrigRef.current;
    if (!key || !side || !orig) return;

    const dxSeconds = (e.clientX - trimStartXRef.current) / PPS;

    setClips((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;

        const srcDur = Number(c.sourceDuration || orig.sourceDuration || 0);
        const in0 = Number(orig.in || 0);
        const out0 = Number(orig.out || 0);
        const start0 = Number(orig.start || 0);

        if (side === "r") {
          let nextOut = out0 + dxSeconds;
          if (e.shiftKey) nextOut = snapSeconds(nextOut, 1);
          nextOut = clamp(nextOut, in0 + MIN_LEN, srcDur);
          return { ...c, out: nextOut };
        }

        let delta = dxSeconds;
        delta = Math.max(delta, -start0);
        delta = Math.max(delta, -in0);
        delta = Math.min(delta, out0 - MIN_LEN - in0);

        let nextStart = start0 + delta;
        let nextIn = in0 + delta;

        if (e.shiftKey) {
          const snappedStart = snapSeconds(nextStart, 1);
          const snapDelta = snappedStart - start0;

          let d = snapDelta;
          d = Math.max(d, -start0);
          d = Math.max(d, -in0);
          d = Math.min(d, out0 - MIN_LEN - in0);

          nextStart = start0 + d;
          nextIn = in0 + d;
        }

        return { ...c, start: nextStart, in: nextIn };
      })
    );
  }

  function onTrimPointerUp(e) {
    if (!isTrimmingRef.current) return;

    isTrimmingRef.current = false;
    trimSideRef.current = null;
    trimKeyRef.current = null;
    trimStartXRef.current = 0;
    trimOrigRef.current = null;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  // -------- Library drag/drop --------
  function onLibDragStart(e, v) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/json", JSON.stringify({ videoId: v.id }));
  }

  function onTimelineDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  async function onTimelineDrop(e) {
    e.preventDefault();

    const raw = e.dataTransfer.getData("application/json");
    if (!raw) return;

    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    const videoId = payload?.videoId;
    const v = libraryVideos.find((x) => String(x.id) === String(videoId));
    if (!v) return;

    const t = getTimeFromClientX(e.clientX);
    await addVideoToTimelineAt(v, t);
  }

  // -------- Sequence title edit --------
  useEffect(() => {
    if (!isEditingTitle) return;
    requestAnimationFrame(() => {
      titleInputRef.current?.focus?.();
      titleInputRef.current?.select?.();
    });
  }, [isEditingTitle]);

  function commitTitle() {
    const s = String(sequenceTitle || "").trim();
    setSequenceTitle(s || "Timeline");
    setIsEditingTitle(false);
  }

  // -------- Ruler ticks --------
  const rulerTicks = useMemo(() => {
    const end = Math.max(10, Math.ceil(timelineEnd + 1));
    const ticks = [];
    for (let t = 0; t <= end; t += 1) ticks.push({ t, major: t % 5 === 0 });
    return ticks;
  }, [timelineEnd]);

  // -------- Publish modal timeline payload (VIDEOS ONLY for now) --------
  const publishTimeline = useMemo(() => {
    return clipsSorted
      .filter((c) => c?.kind === "video")
      .map((c) => ({
        videoId: c?.video?.id,
        start: Number(c.start || 0),
        in: Number(c.in || 0),
        out: Number(c.out || 0),
      }));
  }, [clipsSorted]);

  const hasAnyClips = clipsSorted.length > 0;

  function clipsForLane(kind, track) {
    return clipsSorted.filter((c) => c?.kind === kind && Number(c.track) === Number(track));
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    const v = videoRef.current;
    if (v) v.muted = next;
  }



  function setPlayerVolume(next) {
    const x = clamp(Number(next), 0, 1);
    setVolume(x);
    if (x > 0) setMuted(false);
    const v = videoRef.current;
    if (v) {
      v.volume = x;
      if (x > 0) v.muted = false;
    }
  }

  // Light alignment when idle (keeps poster/first frame sane)
  useEffect(() => {
    if (!hasAnyClips) return;
    if (wantedPlayRef.current) return;
    ensureLoadedForTimelineTime(playheadRef.current ?? playhead, { autoplay: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerSrc]);

  // Keep playhead positioned when zoom changes
  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;

    const t = playheadRef.current ?? playhead;
    const prev = prevPpsRef.current || pps;

    const oldX = t * prev;
    const newX = t * pps;
    viewport.scrollLeft = Math.max(0, viewport.scrollLeft + (newX - oldX));

    prevPpsRef.current = pps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pps]);

  // Tool hotkeys
  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.key === "v" || e.key === "V") setTool("select");
      if (e.key === "c" || e.key === "C") setTool("razor");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fill libDurMap for missing durations
  useEffect(() => {
    if (!libraryVideos?.length) return;

    let cancelled = false;

    (async () => {
      for (const v of libraryVideos) {
        if (cancelled) return;

        const id = String(v?.id ?? "");
        if (!id) continue;

        const provided = Number(v.durationSeconds);
        if (Number.isFinite(provided) && provided > 0.01) continue;

        if (libDurMap.has(id)) continue;

        const d = await getVideoDurationSeconds(v);
        if (cancelled) return;

        setLibDurMap((prev) => {
          const next = new Map(prev);
          next.set(id, d);
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryVideos]);

  // ✅ Button icon derived from actual state
  const playPauseIcon = useMemo(() => {
    const v = videoRef.current;
    const actuallyPlaying = v ? !v.paused && !v.ended : isPlaying;
    return actuallyPlaying ? "⏸" : "▶";
  }, [isPlaying, viewerSrc, playhead]);

  return (
    <div className={`genEditWrap ${tool === "razor" ? "toolRazor" : "toolSelect"}`}>
      <GeneratePublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        timelineName={sequenceTitle}
        defaultTitle={sequenceTitle}
        timeline={publishTimeline}
        onPublished={(result) => {
          console.log("Published:", result);
        }}
      />

      <div className="genEditGrid">
        {/* LEFT: Library */}
        <aside className="genEditLibrary">
          <div className="genEditLibraryHead">
            <div className="genEditLibraryTitle">Library</div>

            <div className="genEditLibTabs" role="tablist" aria-label="Library type">
              <button type="button" className={`genEditLibTab ${libTab === "video" ? "active" : ""}`} onClick={() => setLibTab("video")}>
                Video
              </button>
              <button type="button" className={`genEditLibTab ${libTab === "audio" ? "active" : ""}`} onClick={() => setLibTab("audio")}>
                Audio
              </button>
            </div>
          </div>

          <div className="genEditLibraryBody">
            {libTab === "audio" ? (
              <div className="genEditEmpty">Audio library coming next.</div>
            ) : loadingLib ? (
              <div className="genEditEmpty">Loading your videos…</div>
            ) : libErr ? (
              <div className="genEditEmpty">{libErr}</div>
            ) : libraryVideos.length === 0 ? (
              <div className="genEditEmpty">No uploads yet. Upload a video, then it’ll appear here.</div>
            ) : (
              <div className="genEditLibList">
                {libraryVideos.map((v) => {
                  const isActive = selectedVideo?.id === v.id;
                  const src = thumbUrl(v);
                  const id = String(v.id);

                  const provided = Number(v.durationSeconds);
                  const fallback = libDurMap.get(id);

                  const dur =
                    Number.isFinite(provided) && provided > 0.01
                      ? provided
                      : Number.isFinite(fallback) && fallback > 0.01
                      ? fallback
                      : null;

                  const durLabel = dur != null ? fmtTime(dur) : "…";

                  return (
                    <div
                      key={v.id}
                      className={`genEditLibItem ${isActive ? "active" : ""}`}
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(e) => onLibDragStart(e, v)}
                      onClick={() => setSelectedVideo(v)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setSelectedVideo(v);
                      }}
                      title="Drag onto the timeline"
                    >
                      <div className="genEditLibThumb">{src ? <img src={src} alt="" /> : <div className="genEditThumbPh" />}</div>

                      <div className="genEditLibMeta">
                        <div className="genEditLibName" title={v.title}>
                          {v.title}
                        </div>
                        <div className="genEditLibSub">
                          <span className="muted">Duration: </span> {durLabel}
                        </div>
                      </div>

                      <div className="genEditLibActions">
                        <div className="muted" style={{ fontSize: 11, fontWeight: 800 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* CENTER: Playback + Timeline */}
        <main className="genEditMain">
          {/* Top bar */}
          <div className="genEditTopBar">
            <div className="genEditTimelineTitle" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  className="genEditTimelineTitleInput"
                  value={sequenceTitle}
                  onChange={(e) => setSequenceTitle(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                />
              ) : (
                <button type="button" className="genEditTitleEditBtn" onClick={() => setIsEditingTitle(true)} title="Rename sequence">
                  <span>{sequenceTitle}</span>
                  <span className="genEditPencil" aria-hidden="true">
                    ✎
                  </span>
                </button>
              )}

              <div className="muted" style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                {isSaving ? "Saving…" : dirty ? "*" : ""}
              </div>
            </div>

            <div className="genEditTimelineControls">
              <button type="button" className="genEditBtn" onClick={saveProjectNow} disabled={isSaving || !dirty}>
                Save
              </button>

              <button
                type="button"
                className="genEditBtn primary"
                onClick={() => setPublishOpen(true)}
                disabled={!clipsSorted.some((c) => c.kind === "video")}
                title={!clipsSorted.some((c) => c.kind === "video") ? "Add video clips first" : "Export"}
              >
                Export
              </button>
            </div>
          </div>

          {/* Player */}
          <div className="genEditPlayerShell">
            <div className="genEditPlayerTop">
              <div className="genEditPlayerLabel">{currentVideoClip?.video?.title ? `Playing: ${currentVideoClip.video.title}` : "Playback"}</div>

              <div className="genEditPlayerRight">
                <span className="muted">Playhead:</span> <span>{fmtTime(playhead)}</span>
              </div>
            </div>

            <div className="genEditPlayer">
              {viewerSrc ? (
                <div className="genEditVideoWrap">
                  <div className="genEditVideoStage">
                    <video ref={videoRef} className="genEditVideo" preload="auto" playsInline src={viewerSrc} />

                    <div className="genEditOverlayControls" role="group" aria-label="Player controls">
                      <button type="button" className="genEditPBtn" onClick={togglePlay} disabled={!hasAnyClips} aria-label={isPlaying ? "Pause" : "Play"}>
                        {playPauseIcon}
                      </button>

                      <div className="genEditPlayerTime">
                        {fmtTime(playhead)} <span className="muted">/</span> {fmtTime(timelineEnd)}
                      </div>

                      <input
                        className="genEditPlayerScrub"
                        type="range"
                        min={0}
                        max={Math.max(0.01, timelineEnd || 0)}
                        step={0.01}
                        value={clamp(playhead, 0, Math.max(0.01, timelineEnd || 0))}
                        onChange={(e) => onSequenceScrub(e.target.value)}
                        onMouseUp={(e) => onSequenceScrubCommit(e.currentTarget.value)}
                        onTouchEnd={(e) => onSequenceScrubCommit(e.currentTarget.value)}
                        disabled={!hasAnyClips}
                        aria-label="Scrub sequence"
                      />

                      <button type="button" className="genEditPBtn" onClick={toggleMute} aria-label="Mute">
                        {muted || volume === 0 ? "Unmute" : "Mute"}
                      </button>

                      <input
                        className="genEditPlayerVol"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={muted ? 0 : volume}
                        onChange={(e) => setPlayerVolume(e.target.value)}
                        aria-label="Volume"
                      />

                      <button type="button" className="genEditPBtn" onClick={enterFullscreen} aria-label="Fullscreen">
                        ⤢
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="genEditPlayerEmpty">&lt;Playback&gt;</div>
              )}
            </div>
          </div>

          {/* Transport */}
          <div className="genEditTransport" role="group" aria-label="Timeline transport controls">
            <button type="button" className="genEditTransportBtn" onClick={goToStart} disabled={!hasAnyClips} title="Go to start">
              ⏮
            </button>
            <button type="button" className="genEditTransportBtn" onClick={prevClip} disabled={!hasAnyClips} title="Previous clip">
              ◀|
            </button>
            <button type="button" className="genEditTransportBtn primary" onClick={togglePlay} disabled={!hasAnyClips} title="Play / Pause">
              {playPauseIcon}
            </button>
            <button type="button" className="genEditTransportBtn" onClick={nextClip} disabled={!hasAnyClips} title="Next clip">
              |▶
            </button>
            <button type="button" className="genEditTransportBtn" onClick={goToEnd} disabled={!hasAnyClips} title="Go to end">
              ⏭
            </button>
          </div>

          {/* Zoom control */}
          <div className="genEditZoomRow" role="group" aria-label="Timeline zoom">
            <div className="genEditToolGroup" role="group" aria-label="Edit tools">
              <button type="button" className={`genEditToolBtn ${tool === "select" ? "active" : ""}`} onClick={() => setTool("select")} title="Select (V)">
                🖱
              </button>

              <button type="button" className={`genEditToolBtn ${tool === "razor" ? "active" : ""}`} onClick={() => setTool("razor")} title="Razor (C)">
                ✂
              </button>
            </div>
            <div className="genEditZoomLabel">
              <span className="muted">Zoom</span> <span style={{ fontWeight: 900 }}>{Math.round(pps)} px/s</span>
            </div>

            <input
              className="genEditZoomSlider"
              type="range"
              min={2}
              max={80}
              step={1}
              value={pps}
              onChange={(e) => setPps(Number(e.target.value) || 40)}
              style={{
                "--zoom-track-bg": `linear-gradient(
                  90deg,
                  rgba(140,90,255,1) 0%,
                  rgba(140,90,255,1) ${(((pps - 2) / (80 - 2)) * 100) || 0}%,
                  rgba(255,255,255,0.25) ${(((pps - 2) / (80 - 2)) * 100) || 0}%,
                  rgba(255,255,255,0.25) 100%
                )`,
              }}
            />

            <button type="button" className="genEditZoomBtn" onClick={() => setPps(40)}>
              Reset
            </button>
          </div>

          {/* Timeline */}
          <div className="genEditTimelineShell">
            <div className="genEditTimelineMulti">
              {/* Fixed gutter labels */}
              <div className="genEditLaneGutter" aria-hidden="true">
                <div className="genEditGutterSpacer" />
                {LANES.map((lane) => (
                  <div key={`${lane.kind}-${lane.track}`} className={`genEditGutterCell ${lane.kind}`}>
                    {lane.label}
                  </div>
                ))}
              </div>

              {/* Scrollable time area */}
              <div className="genEditTimelineViewport" ref={timelineViewportRef}>
                <div className="genEditTimelineScroll" ref={timelineScrollRef}>
                  {/* ✅ Time stack: header (timecode row) + lanes share same coordinate space */}
                  <div
                    ref={timelineOriginRef}
                    className="genEditTimeStack"
                    style={{ width: timelineWidth }}
                    onPointerMove={onTimelinePointerMove}
                    onPointerLeave={onTimelinePointerLeave}
                    onDragOver={onTimelineDragOver}
                    onDrop={onTimelineDrop}
                    role="presentation"
                  >
                    {/* ✅ Header row: ONLY place where click-to-set playhead works */}
                    <div className="genEditTimeHeader">
                      <div className="genEditTimelineRuler" aria-hidden="true">
                        {rulerTicks.map(({ t, major }) => {
                          const x = t * PPS;
                          return (
                            <div key={t} className={`genEditRulerTick ${major ? "major" : ""}`} style={{ left: `${x}px` }}>
                              {major ? <div className="genEditRulerLabel">{fmtRulerLabel(t)}</div> : null}
                            </div>
                          );
                        })}
                      </div>

                      <div className="genEditTimeHeaderHit" onPointerDown={onTimeHeaderPointerDown} />
                    </div>

                    {/* Razor preview line spans whole stack */}
                    {tool === "razor" && razorHoverT != null && <div className="genEditRazorLine" style={{ left: `${razorHoverT * PPS}px` }} />}
                    
                    {boxSel && (
                      <div
                        className="genEditBoxSelect"
                        style={{
                          left: `${boxSel.left}px`,
                          top: `${boxSel.top}px`,
                          width: `${boxSel.width}px`,
                          height: `${boxSel.height}px`,
                        }}
                      />
                    )}

                    {/* Playhead spans whole stack; handle is visually in the header */}
                    <div className="genEditPlayheadLine" style={{ left: `${playhead * PPS}px` }} />
                    <div
                      className="genEditPlayheadHandle"
                      style={{ left: `${playhead * PPS}px` }}
                      onPointerDown={onPlayheadPointerDown}
                      role="slider"
                      aria-label="Playhead"
                      aria-valuemin={0}
                      aria-valuemax={playheadMax}
                      aria-valuenow={playhead}
                      tabIndex={0}
                    />

                    {/* Lanes (no click-to-set playhead here anymore) */}
                    <div className="genEditTimeOrigin" onPointerDown={onLanesPointerDown}>
                      <div className="genEditLanes">
                        {LANES.map((lane) => {
                          const laneClips = clipsForLane(lane.kind, lane.track);

                          return (
                            <div
                              key={`${lane.kind}-${lane.track}`}
                              className={`genEditLane ${lane.kind}`}
                              data-lane-kind={lane.kind}
                              data-lane-track={lane.track}
                            >
                              <div className="genEditLaneContent">
                                {laneClips.map((c) => {
                                  const left = (Number(c.start) || 0) * PPS;
                                  const MIN_PX = Math.max(6, MIN_LEN * PPS);
                                  const width = Math.max(MIN_PX, clipLen(c) * PPS);
                                  const isSelected = selectedClipKeys.has(c.key);
                                  const isBoxHot = boxHoverKeys.has(c.key);

                                  return (
                                    
                                    <div
                                        key={c.key}
                                        className={[
                                          "genEditClip",
                                          c.kind,
                                          isSelected ? "selected active" : "",
                                          isBoxHot ? "boxHot" : "",
                                        ].join(" ")}
                                        data-clip-key={c.key}
                                        style={{ left: `${left}px`, width: `${width}px` }}
                                        onPointerDown={(e) => onClipPointerDown(e, c.key)}
                                        onPointerMove={onClipPointerMove}
                                        onPointerUp={onClipPointerUp}
                                        onPointerCancel={onClipPointerUp}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        // ✅ No onClick selection — pointerdown already handles select + shift-multiselect
                                        onClick={(e) => {
                                          // Optional: prevent bubbling to any future background click handlers
                                          e.stopPropagation();
                                        }}
                                        role="button"
                                        tabIndex={0}
                                      >
                                      <div
                                        className="genEditTrimHandle left"
                                        onPointerDown={(e) => onTrimPointerDown(e, c.key, "l")}
                                        onPointerMove={onTrimPointerMove}
                                        onPointerUp={onTrimPointerUp}
                                        onPointerCancel={onTrimPointerUp}
                                      />
                                      <div
                                        className="genEditTrimHandle right"
                                        onPointerDown={(e) => onTrimPointerDown(e, c.key, "r")}
                                        onPointerMove={onTrimPointerMove}
                                        onPointerUp={onTrimPointerUp}
                                        onPointerCancel={onTrimPointerUp}
                                      />

                                      <div className="genEditClipTop">
                                        <div className="genEditClipTitle" title={c?.video?.title || ""}>
                                          {c?.video?.title || (c.kind === "audio" ? "Audio clip" : "Untitled clip")}
                                        </div>

                                        <button
                                          type="button"
                                          className="genEditClipX"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            removeFromTimeline(c.key);
                                          }}
                                          aria-label="Remove clip"
                                          title="Remove clip"
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}

                        {!clips.length && <div className="genEditTimelineEmpty">Drag clips from your library onto the timeline.</div>}
                      </div>
                    </div>
                  </div>
                  {/* /time stack */}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}