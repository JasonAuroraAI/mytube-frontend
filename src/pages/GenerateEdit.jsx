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

function getIndexedProjectTitle(id) {
  const idx = loadProjectIndex();
  const hit = idx.find((x) => String(x?.id) === String(id));
  const t = String(hit?.sequenceTitle || "").trim();
  return t || "";
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
  const [tool, setTool] = useState("select"); // "select" | "razor" | "ripple" | "slip" | "roll" | "trackFwd"
  const [razorHoverT, setRazorHoverT] = useState(null); // timeline seconds under cursor in razor mode
  const RAZOR_SNAP_SEC = 0.25;

  // --- Slip tool state ---
  const isSlippingRef = useRef(false);
  const slipKeyRef = useRef(null);
  const slipStartClientXRef = useRef(0);
  const slipOrigRef = useRef(null); // { in, out, len, srcDur }
  const slipPointerIdRef = useRef(null);

  // Tooltip for slip
  const [slipTip, setSlipTip] = useState(null);
  // slipTip: { x, y, text } using client coords (position:fixed)

  // Trim/Ripple tooltip (same behavior as Trim/Slip: appears on drag, follows cursor, hides on up)
  const [trimTip, setTrimTip] = useState(null);
  // trimTip: { x, y, text } using client coords (position:fixed)

  // UI-only duration overrides for videos missing durationSeconds
  const [libDurMap, setLibDurMap] = useState(() => new Map());

  // Tracks
  const VIDEO_TRACKS = useMemo(() => [{ kind: "video", track: 0, label: "V1" }], []);

  // dynamic audio lanes (A1..A5)
  const [audioLaneCount, setAudioLaneCount] = useState(1); // start with just A1

  const AUDIO_TRACKS = useMemo(() => {
    const n = clamp(Number(audioLaneCount) || 1, 1, 5);
    return Array.from({ length: n }, (_, i) => ({
      kind: "audio",
      track: i,
      label: `A${i + 1}`,
    }));
  }, [audioLaneCount]);

  const LANES = useMemo(() => [...VIDEO_TRACKS, ...AUDIO_TRACKS], [VIDEO_TRACKS, AUDIO_TRACKS]);

    // ---------------- Undo / Redo ----------------
  const UNDO_LIMIT = 60;

  const undoStackRef = useRef([]); // [{ sequenceTitle, clips, playhead, audioLaneCount }]
  const redoStackRef = useRef([]);

  // -------- Copy / Paste clipboard --------
// Stores a snapshot of selected clips with starts relative to the earliest start
const clipClipboardRef = useRef(null);

function selectTrackForwardFrom({ kind, track, time, allLanes = false }) {
  const t0 = Number(time) || 0;
  const EPS = 1e-6;

  const keys = clipsSorted
    .filter((c) => {
      if (!c) return false;

      if (!allLanes) {
        if (c.kind !== kind) return false;
        if ((Number(c.track) || 0) !== (Number(track) || 0)) return false;
      }

      const s = Number(c.start) || 0;
      return s >= t0 - EPS;
    })
    // keep selection order consistent (left->right)
    .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0))
    .map((c) => c.key);

  setSelectionFromKeys(keys, { additive: false });
}

function newClipKeyLike(oldKey) {
  return `${oldKey}-P-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getSelectedOrActiveKeys() {
  const sel = Array.from(selectedClipKeysRef.current || []);
  if (sel.length) return sel;
  return activeClipKey ? [activeClipKey] : [];
}

function copySelectedClips() {
  const keys = getSelectedOrActiveKeys();
  if (!keys.length) return;

  const picked = clips
    .filter((c) => c && keys.includes(c.key))
    .map((c) => ({
      // store everything we need to recreate the clip
      kind: c.kind,
      track: Number(c.track) || 0,
      start: Number(c.start) || 0,
      in: Number(c.in) || 0,
      out: Number(c.out) || 0,
      sourceDuration: Number(c.sourceDuration) || Number(c?.video?.durationSeconds) || 0,
      video: c.video || null,
      videoId: c?.video?.id ?? null,
      _origKey: c.key,
    }));

  if (!picked.length) return;

  const minStart = Math.min(...picked.map((c) => c.start));
  const normalized = picked
    .map((c) => ({ ...c, relStart: c.start - minStart }))
    .sort((a, b) => a.relStart - b.relStart);

  clipClipboardRef.current = {
    copiedAt: Date.now(),
    count: normalized.length,
    minStart,
    items: normalized,
  };
}

function pasteClipboardAtPlayhead() {
  const clipb = clipClipboardRef.current;
  if (!clipb?.items?.length) return;

  pushUndo("paste");

  const baseT = Math.max(0, Number(playheadRef.current ?? playhead) || 0);

  // Build new clips with new keys
  const newClips = clipb.items.map((it) => {
    // Rebind video object from library if available (prevents stale objects)
    let videoObj = it.video;
    if (it.videoId != null && Array.isArray(libraryVideos) && libraryVideos.length) {
      const fresh = libraryVideos.find((v) => String(v.id) === String(it.videoId));
      if (fresh) videoObj = fresh;
    }

    const kind = it.kind === "video" ? "video" : it.kind === "audio" ? "audio" : "video";
    const track = kind === "video" ? 0 : Number(it.track) || 0;

    return {
      key: newClipKeyLike(it._origKey || `${kind}-${it.videoId || "x"}`),
      kind,
      track,
      video: videoObj,
      start: Math.max(0, baseT + (Number(it.relStart) || 0)),
      sourceDuration: Number(it.sourceDuration) || Number(videoObj?.durationSeconds) || 0,
      in: Number(it.in) || 0,
      out: Number(it.out) || 0,
    };
  });

  setClips((prev) => [...prev, ...newClips]);

  // select pasted clips
  const pastedKeys = new Set(newClips.map((c) => c.key));
  setSelectedClipKeys(pastedKeys);
  setActiveClipKey(newClips[newClips.length - 1]?.key || null);
}

  function getSnapshot() {
    return {
      sequenceTitle: String(sequenceTitle || "Timeline"),
      clips: Array.isArray(clips) ? clips : [],
      playhead: Number(playhead || 0),
      audioLaneCount: clamp(Number(audioLaneCount) || 1, 1, 5),
    };
  }

  useEffect(() => {
  const onKeyDown = (e) => {
    const key = (e.key || "").toLowerCase();
    const tag = (e.target?.tagName || "").toLowerCase();
    const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
    if (isTyping) return;

    const mod = e.ctrlKey || e.metaKey;
        // Copy: Ctrl/Cmd+C
    if (mod && key === "c" && !e.shiftKey) {
      e.preventDefault();
      copySelectedClips();
      return;
    }

    // Paste: Ctrl/Cmd+V
    if (mod && key === "v" && !e.shiftKey) {
      // IMPORTANT: don't steal your tool hotkey 'v' when not holding Ctrl/Cmd
      e.preventDefault();
      pasteClipboardAtPlayhead();
      return;
    }

    // Undo...
    // Redo...
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [sequenceTitle, clips, playhead, audioLaneCount]);

  function applySnapshot(snap) {
    if (!snap) return;
    setSequenceTitle(String(snap.sequenceTitle || "Timeline"));
    setClips(Array.isArray(snap.clips) ? snap.clips : []);
    setAudioLaneCount(clamp(Number(snap.audioLaneCount) || 1, 1, 5));
    setPlayhead(Math.max(0, Number(snap.playhead) || 0));
    playheadRef.current = Math.max(0, Number(snap.playhead) || 0);

    // selection shouldn't be undone; clear it for sanity
    setSelectedClipKeys(new Set());
    setActiveClipKey(null);

    // force viewer re-align
    loadedClipKeyRef.current = null;
    loadedSrcRef.current = "";
    requestAnimationFrame(() => {
      ensureLoadedForTimelineTime(playheadRef.current, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("applySnapshot");
      });
    });
  }

  function pushUndo(reason = "") {
    // Don't record while hydrating initial load
    if (!didHydrateRef.current) return;

    const snap = getSnapshot();
    const stack = undoStackRef.current;

    // prevent pushing identical snapshot back-to-back (cheap check)
    const last = stack[stack.length - 1];
    const same =
      last &&
      last.playhead === snap.playhead &&
      last.audioLaneCount === snap.audioLaneCount &&
      last.sequenceTitle === snap.sequenceTitle &&
      JSON.stringify(last.clips) === JSON.stringify(snap.clips);

    if (!same) {
      stack.push(snap);
      if (stack.length > UNDO_LIMIT) stack.splice(0, stack.length - UNDO_LIMIT);
      undoStackRef.current = stack;
      redoStackRef.current = []; // new action clears redo history
    }
  }

  function undo() {
    const stack = undoStackRef.current;
    if (!stack.length) return;

    const current = getSnapshot();
    const prev = stack.pop();

    redoStackRef.current.push(current);
    undoStackRef.current = stack;

    applySnapshot(prev);
  }

  function redo() {
    const stack = redoStackRef.current;
    if (!stack.length) return;

    const current = getSnapshot();
    const next = stack.pop();

    undoStackRef.current.push(current);
    if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.splice(0, undoStackRef.current.length - UNDO_LIMIT);

    applySnapshot(next);
  }

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

      // ✅ Prefer saved lane count (keeps empty lanes), fallback to fit existing audio clips
      const savedLaneCount = Number(p.audioLaneCount);
      if (Number.isFinite(savedLaneCount) && savedLaneCount > 0) {
        setAudioLaneCount(clamp(savedLaneCount, 1, 5));
      } else {
        const maxAudioTrack = migrated
          .filter((c) => c?.kind === "audio")
          .reduce((m, c) => Math.max(m, Number(c.track) || 0), 0);
        setAudioLaneCount(clamp(maxAudioTrack + 1, 1, 5));
      }

      setPlayhead(Number.isFinite(Number(p.playhead)) ? Math.max(0, Number(p.playhead)) : 0);
    } else {
      const indexedTitle = getIndexedProjectTitle(projectId);

      const initialTitle = indexedTitle || "Timeline";
      setSequenceTitle(initialTitle);

      const initial = {
        id: projectId,
        sequenceTitle: initialTitle,
        updatedAt: Date.now(),
        playhead: 0,
        clips: [],
        audioLaneCount: 1,
      };

      saveProjectById(projectId, initial);

      const idx = loadProjectIndex();
      const nextIdx = [
        { id: projectId, sequenceTitle: initialTitle, updatedAt: initial.updatedAt },
        ...idx.filter((x) => x?.id !== projectId),
      ];
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

  function setSelectionImmediate(keys, { additive } = { additive: false }) {
    const next = additive ? new Set(selectedClipKeysRef.current || []) : new Set();
    for (const k of keys || []) next.add(k);

    // state
    setSelectedClipKeys(next);

    // ✅ ref (so drag logic sees it immediately, same frame)
    selectedClipKeysRef.current = next;

    const arr = Array.from(next);
    setActiveClipKey(arr.length ? arr[arr.length - 1] : null);
  }

  function clampSlipIn(nextIn, srcDur, len) {
    const maxIn = Math.max(0, (Number(srcDur) || 0) - (Number(len) || 0));
    return clamp(Number(nextIn) || 0, 0, maxIn);
  }

  function fmtSignedSeconds(delta) {
    const d = Number(delta) || 0;
    const sign = d >= 0 ? "+" : "−";
    return `${sign}${fmtTime(Math.abs(d))}`;
  }

  function fmtDelta(seconds) {
    const s = Number(seconds) || 0;
    const sign = s >= 0 ? "+" : "−";
    return `${sign}${fmtTime(Math.abs(s))}`;
  }

  function formatTrimTooltip({ side, inTime, outTime, length, deltaLength, isRipple }) {
    const sideLabel = side === "l" ? (isRipple ? "Ripple Trim" : "Trim") : isRipple ? "Ripple Trim" : "Trim";
    const deltaLabel = Math.abs(deltaLength) > 1e-6 ? ` (${fmtDelta(deltaLength)})` : "";
    return `${sideLabel}: ${fmtTime(length)}${deltaLabel}`;
  }

  function addAudioLane() 
  {
    pushUndo("add audio lane");
    setAudioLaneCount((n) => clamp((Number(n) || 1) + 1, 1, 5));
  }
  

  function removeAudioLane(trackToRemove) {
    pushUndo("add audio lane");
    // Protect A1 (track 0) so you never end up with 0 audio lanes
    if (Number(trackToRemove) === 0) return;

    setClips((prev) => {
      const t = Number(trackToRemove);

      // 1) delete clips that are on the removed lane
      // 2) shift any clips above it down by 1 (A4 -> A3, etc)
      return prev
        .filter((c) => !(c?.kind === "audio" && Number(c.track) === t))
        .map((c) => {
          if (c?.kind !== "audio") return c;
          const tr = Number(c.track) || 0;
          if (tr > t) return { ...c, track: tr - 1 };
          return c;
        });
    });

    setAudioLaneCount((n) => clamp((Number(n) || 1) - 1, 1, 5));
  }

  function onLanesPointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;
    if (tool === "razor") return; // keep lanes inert in razor mode, like Premiere

      // ✅ Track Select Forward: clicking empty lane space selects forward from mouse time
    if (tool === "trackFwd") {
      // Only when clicking "empty" lanes background
      if (e.target?.closest?.(".genEditClip")) return;
      if (e.target?.closest?.(".genEditPlayheadHandle")) return;

      e.preventDefault();
      e.stopPropagation();

      const lane = getLaneFromClientY(e.clientY);
      if (!lane) return;

      const t = getTimeFromClientX(e.clientX);

      // Shift = all lanes
      selectTrackForwardFrom({
        kind: lane.kind,
        track: Number(lane.track) || 0,
        time: t,
        allLanes: !!e.shiftKey,
      });

      return;
    }

    // Only start box-select when clicking "empty" lanes background
    if (e.target?.closest?.(".genEditClip")) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;

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
        audioLaneCount: clamp(Number(audioLaneCount) || 1, 1, 5),
      };

      saveProjectById(projectId, payload);

      const idx = loadProjectIndex();
      const nextIdx = [
        { id: projectId, sequenceTitle: payload.sequenceTitle, updatedAt: payload.updatedAt },
        ...idx.filter((x) => x?.id !== projectId),
      ];
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
    return clips.slice().sort((a, b) => a.start - b.start || (Number(b.track) || 0) - (Number(a.track) || 0));
  }, [clips]);

  const timelineEnd = useMemo(() => {
    if (!clipsSorted.length) return 0;
    return Math.max(...clipsSorted.map((c) => (Number(c.start) || 0) + clipLen(c)));
  }, [clipsSorted]);

  const timelineWidth = Math.max(600, Math.ceil((timelineEnd + 5) * PPS));
  const playheadMax = Math.max(0, Math.ceil(timelineEnd));

  const prevTimelineWidthRef = useRef(timelineWidth);

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;

    const prevW = prevTimelineWidthRef.current;

    // Only intervene when the content got smaller
    if (timelineWidth < prevW - 1) {
      requestAnimationFrame(() => {
        const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);

        // If we were scrolled past the new end, clamp
        if (viewport.scrollLeft > maxScroll) viewport.scrollLeft = maxScroll;

        // Optional (nice): keep playhead comfortably in view
        const px = (playheadRef.current ?? playhead) * PPS;
        const desired = Math.max(0, px - viewport.clientWidth * 0.35);
        viewport.scrollLeft = Math.min(maxScroll, desired);
      });
    }

    prevTimelineWidthRef.current = timelineWidth;
  }, [timelineWidth, PPS, playhead]);

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

  function clipEnd(c) {
    return (Number(c.start) || 0) + clipLen(c);
  }

  function getLaneEdgesSeconds(allClips, { kind, track, excludeKey }) {
    const edges = [];
    for (const c of allClips) {
      if (!c) continue;
      if (c.key === excludeKey) continue;
      if (c.kind !== kind) continue;
      if ((Number(c.track) || 0) !== (Number(track) || 0)) continue;

      edges.push(Number(c.start) || 0);
      edges.push(clipEnd(c));
    }
    return edges;
  }

  function snapToNearest(t, targets, snapSec) {
    const tt = Number(t) || 0;
    let best = { v: tt, d: Infinity };
    for (const x of targets || []) {
      const d = Math.abs(tt - x);
      if (d < best.d) best = { v: x, d };
    }
    return best.d <= (Number(snapSec) || 0) ? best.v : tt;
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
    const viewport = timelineViewportRef.current;
    if (!viewport) return 0;

    const vr = viewport.getBoundingClientRect();
    const x = clientX - vr.left + viewport.scrollLeft;

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

  // ---------- Ripple delete helpers ----------
  function laneKeyOf(c) {
    return `${c?.kind}:${Number(c?.track) || 0}`;
  }

  function buildRipplePlan(prevClips, keysToRemove) {
    const removeSet = new Set(keysToRemove || []);
    const removedByLane = new Map();

    // Collect removed intervals per lane
    for (const c of prevClips) {
      if (!c || !removeSet.has(c.key)) continue;
      const lk = laneKeyOf(c);
      const s = Number(c.start) || 0;
      const e = s + clipLen(c);
      if (e <= s) continue;

      if (!removedByLane.has(lk)) removedByLane.set(lk, []);
      removedByLane.get(lk).push({ start: s, end: e, len: e - s });
    }

    // Normalize: sort + merge overlaps (so multiple deletions don't double-shift)
    const planByLane = new Map();
    for (const [lk, intervals] of removedByLane.entries()) {
      const sorted = intervals.slice().sort((a, b) => a.start - b.start || a.end - b.end);

      const merged = [];
      for (const it of sorted) {
        const last = merged[merged.length - 1];
        if (!last) merged.push({ ...it });
        else if (it.start <= last.end + 1e-6) {
          // overlap/abut -> merge
          last.end = Math.max(last.end, it.end);
          last.len = last.end - last.start;
        } else {
          merged.push({ ...it });
        }
      }

      // Precompute cumulative shifts for fast lookup
      let cum = 0;
      const steps = merged.map((m) => {
        const step = { ...m, shiftAfter: cum + m.len };
        cum += m.len;
        return step;
      });

      planByLane.set(lk, { intervals: steps, total: cum });
    }

    return { removeSet, planByLane };
  }

  function rippleShiftForTime(intervals, t) {
    // intervals are merged, in ascending time, with "shiftAfter" cumulative included
    const tt = Number(t) || 0;
    let shift = 0;

    for (const it of intervals) {
      // If time is after this interval, accumulate its length
      if (tt >= it.end - 1e-6) {
        shift = it.shiftAfter;
        continue;
      }
      break;
    }

    return shift;
  }

  function isTimeInsideAny(intervals, t) {
    const tt = Number(t) || 0;
    for (const it of intervals) {
      if (tt >= it.start - 1e-6 && tt <= it.end + 1e-6) return it;
      if (tt < it.start) break;
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
        p.catch(() => {});
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

    const endT = cur ? (Number(cur.start) || 0) + clipLen(cur) : playheadRef.current ?? playhead;
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
    if (tool === "trackFwd") return;

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
    
    pushUndo("add clip");
    
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

  function removeFromTimeline(keysToRemove) {
    pushUndo("delete");
    const keys = Array.from(keysToRemove || []);
    if (!keys.length) return;

    const removingLoaded = keys.includes(loadedClipKeyRef.current);

    setClips((prev) => prev.filter((c) => c && !keys.includes(c.key)));

    setSelectedClipKeys(new Set());
    setActiveClipKey(null);

    // If we deleted the loaded clip, force the viewer to re-align on the next tick
    requestAnimationFrame(() => {
      const t = playheadRef.current ?? playhead;

      if (removingLoaded) {
        loadedClipKeyRef.current = null;
        loadedSrcRef.current = "";
      }

      ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("plainDelete");
      });
    });
  }

  function rippleDelete(keysToRemove) {
    pushUndo("delete");
    const keys = Array.from(keysToRemove || []);
    if (!keys.length) return;

    // If we are deleting the currently-loaded clip, force a reload afterwards
    const removingLoaded = keys.includes(loadedClipKeyRef.current);

    // Build plan from current clips BEFORE update (needed for playhead correction)
    const planForPlayhead = buildRipplePlan(clips, keys);

    setClips((prev) => {
      const { removeSet, planByLane } = buildRipplePlan(prev, keys);

      // First delete
      const kept = prev.filter((c) => c && !removeSet.has(c.key));

      // Then shift clips per lane
      const next = kept.map((c) => {
        const lk = laneKeyOf(c);
        const plan = planByLane.get(lk);
        if (!plan || !plan.total) return c;

        const s = Number(c.start) || 0;
        const shift = rippleShiftForTime(plan.intervals, s);
        if (shift <= 0) return c;

        return { ...c, start: Math.max(0, s - shift) };
      });

      return next;
    });

    // Selection cleanup
    setSelectedClipKeys(new Set());
    setActiveClipKey(null);

    // Adjust playhead after the state update lands
    requestAnimationFrame(() => {
      const t0 = playheadRef.current ?? playhead;

      // Ripple playhead based on VIDEO lane
      const videoLaneKey = "video:0";
      const plan = planForPlayhead.planByLane.get(videoLaneKey);

      let t1 = t0;

      if (plan && plan.total) {
        const inside = isTimeInsideAny(plan.intervals, t0);

        if (inside) {
          const priorShift = rippleShiftForTime(plan.intervals, inside.start);
          t1 = Math.max(0, inside.start - priorShift);
        } else {
          const shift = rippleShiftForTime(plan.intervals, t0);
          t1 = Math.max(0, t0 - shift);
        }
      }

      setPlayhead(t1);
      playheadRef.current = t1;

      // If we deleted the loaded clip, force the viewer to re-align
      if (removingLoaded) {
        loadedClipKeyRef.current = null;
        loadedSrcRef.current = "";
      }

      ensureLoadedForTimelineTime(t1, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("rippleDelete");
      });
    });
  }

  // Ctrl/Cmd + S = Save
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();

      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();

        const tag = (e.target?.tagName || "").toLowerCase();
        const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
        if (isTyping) return;

        if (isSaving) return;
        if (!dirty) return;

        saveProjectNow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, isSaving, saveProjectNow]);

    useEffect(() => {
    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (isTyping) return;

      const mod = e.ctrlKey || e.metaKey;

      // Undo: Ctrl/Cmd+Z
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y
      if ((mod && key === "z" && e.shiftKey) || (mod && key === "y")) {
        e.preventDefault();
        redo();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceTitle, clips, playhead, audioLaneCount]);

  // Delete / Backspace handling
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

        if (!toRemove.length) return;

        e.preventDefault();

        // ✅ SHIFT = ripple delete
        if (e.shiftKey) {
          rippleDelete(toRemove);
        } else {
          setClips((prev) => prev.filter((c) => !toRemove.includes(c.key)));
          setSelectedClipKeys(new Set());
          setActiveClipKey(null);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeClipKey]);

  // -------- Clip drag (shift snap) / Razor split --------
  function splitClipAtTime(clipKey, timelineT) {
    pushUndo("razor split");
    setClips((prev) => {
      const clip = prev.find((c) => c.key === clipKey);
      if (!clip) return prev;

      const start = Number(clip.start) || 0;
      const in0 = Number(clip.in) || 0;
      const out0 = Number(clip.out) || 0;

      const len = Math.max(0, out0 - in0);
      if (len <= MIN_LEN * 2) return prev;

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

    // ✅ SLIP MODE: drag inside clip to offset source (in/out) while keeping timeline length
    if (tool === "slip") {
      onSlipPointerDown(e, clipKey);
      return;
    }

    // ✅ RAZOR MODE: click clip to split at mouse time
    if (tool === "razor") {
      const raw = getTimeFromClientX(e.clientX);
      const tt = e.shiftKey ? snapRazorTime(raw) : raw;
      setRazorHoverT(tt);
      splitClipAtTime(clipKey, tt);
      return;
    }

    // ✅ RIPPLE TOOL: do NOT start dragging clips around
    if (tool === "ripple") {
      if (e.shiftKey) toggleSelectionKey(clipKey);
      else {
        const sel = selectedClipKeysRef.current;
        if (!sel || !sel.has(clipKey)) setSingleSelection(clipKey);
        else setActiveClipKey(clipKey);
      }
      return;
    }
  
    // ✅ TRACK SELECT FORWARD: click selects everything forward AND allows dragging the group
    if (tool === "trackFwd") {
      const clip = clips.find((c) => c.key === clipKey);
      if (!clip) return;

      const t0 = Number(clip.start) || 0;
      const allLanes = !!e.shiftKey;

      const keys = clipsSorted
        .filter((c) => {
          if (!c) return false;
          if (!allLanes) {
            if (c.kind !== clip.kind) return false;
            if ((Number(c.track) || 0) !== (Number(clip.track) || 0)) return false;
          }
          return (Number(c.start) || 0) >= t0 - 1e-6;
        })
        .sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0))
        .map((c) => c.key);

      // ✅ Set selection immediately so drag uses it right away
      setSelectionImmediate(keys, { additive: false });

      // NOTE: do NOT return — continue into normal drag behavior below
    }

    // ✅ SELECT MODE (existing drag behavior)
    const clip = clips.find((c) => c.key === clipKey);
    if (!clip) return;

    // before changing anything
    pushUndo("move clip");

    isDraggingClipRef.current = true;
    dragClipKeyRef.current = clipKey;
    dragClipStartRef.current = Number(clip.start) || 0;
    dragStartClientXRef.current = e.clientX;
    dragStartClientYRef.current = e.clientY;
    dragOrigTrackRef.current = { kind: clip.kind, track: Number(clip.track) || 0 };
    didMoveClipRef.current = false;

    const sel = selectedClipKeysRef.current;
    const primary = clips.find((c) => c.key === clipKey);
    const groupKeys = sel && sel.has(clipKey) ? Array.from(sel) : [clipKey];
    const group = clips
      .filter((c) => groupKeys.includes(c.key))
      .filter((c) => {
          // In Track Select Forward + Shift, allow cross-lane drag
          if (tool === "trackFwd" && e.shiftKey) return true;
          return c.kind === primary.kind;
        })
      .map((c) => ({ key: c.key, start: Number(c.start) || 0, kind: c.kind, track: Number(c.track) || 0 }));


    dragGroupRef.current = group;
    dragGroupPrimaryKeyRef.current = clipKey;
    dragGroupPrimaryStartRef.current = Number(primary.start) || 0;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    if (e.shiftKey) {
      toggleSelectionKey(clipKey);
    } else {
      const sel2 = selectedClipKeysRef.current;
      if (!sel2 || !sel2.has(clipKey)) setSingleSelection(clipKey);
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

    let nextPrimaryStart = Math.max(0, Number(primaryOrig.start || 0) + dxSeconds);

    if (e.shiftKey) nextPrimaryStart = Math.max(0, snapSeconds(nextPrimaryStart, 1));

    nextPrimaryStart = snapToEdges(nextPrimaryStart, primaryKey);

    const delta = nextPrimaryStart - (Number(primaryOrig.start) || 0);

    const orig = dragOrigTrackRef.current;
    let nextKind = orig?.kind;
    let nextTrack = orig?.track;

    const lane = getLaneFromClientY(e.clientY);
    if (lane && orig?.kind === lane.kind) {
      nextKind = lane.kind;
      nextTrack = lane.track;
      if (nextKind === "video") nextTrack = 0;
    }

    const groupKeySet = new Set(group.map((g) => g.key));

    setClips((prev) =>
      prev.map((c) => {
        if (!groupKeySet.has(c.key)) return c;

        const g = group.find((x) => x.key === c.key);
        const baseStart = Number(g?.start ?? c.start ?? 0);
        const movedStart = Math.max(0, baseStart + delta);

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

  // -------- Slip --------
  function onSlipPointerDown(e, clipKey) {
    pushUndo("slip");
    e.preventDefault();
    e.stopPropagation();

    const clip = clips.find((c) => c.key === clipKey);
    if (!clip) return;

    const srcDur = Number(clip.sourceDuration || clip?.video?.durationSeconds || 0);
    const in0 = Number(clip.in) || 0;
    const out0 = Number(clip.out) || 0;
    const len = Math.max(0, out0 - in0);

    if (!(srcDur > 0) || !(len > 0.01)) return;

    isSlippingRef.current = true;
    slipKeyRef.current = clipKey;
    slipStartClientXRef.current = e.clientX;
    slipOrigRef.current = { in: in0, out: out0, len, srcDur };
    slipPointerIdRef.current = e.pointerId;

    setActiveClipKey(clipKey);
    const sel = selectedClipKeysRef.current;
    if (!sel || !sel.has(clipKey)) setSingleSelection(clipKey);

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    setSlipTip({
      x: e.clientX + 12,
      y: e.clientY + 12,
      text: `Slip ${fmtTime(in0)} → ${fmtTime(out0)} (Δ +0:00)`,
    });
  }

  function onSlipPointerMove(e) {
    if (!isSlippingRef.current) return;
    if (slipPointerIdRef.current != null && e.pointerId !== slipPointerIdRef.current) return;

    const key = slipKeyRef.current;
    const orig = slipOrigRef.current;
    if (!key || !orig) return;

    const dxSeconds = -(e.clientX - slipStartClientXRef.current) / PPS;

    const nextIn = clampSlipIn(orig.in + dxSeconds, orig.srcDur, orig.len);
    const nextOut = nextIn + orig.len;

    setClips((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;
        return { ...c, in: nextIn, out: nextOut };
      })
    );

    setSlipTip({
      x: e.clientX + 12,
      y: e.clientY + 12,
      text: `Slip ${fmtTime(nextIn)} → ${fmtTime(nextOut)} (Δ ${fmtSignedSeconds(nextIn - orig.in)})`,
    });
  }

  function onSlipPointerUp(e) {
    if (!isSlippingRef.current) return;
    if (slipPointerIdRef.current != null && e.pointerId !== slipPointerIdRef.current) return;

    isSlippingRef.current = false;
    slipKeyRef.current = null;
    slipStartClientXRef.current = 0;
    slipOrigRef.current = null;
    slipPointerIdRef.current = null;

    setSlipTip(null);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  // -------- Trim / Ripple trim / Roll (shared handles) --------
function onTrimPointerDown(e, clipKey, side) {
  pushUndo(`trim ${side}`);
  e.preventDefault();
  e.stopPropagation();

  const clip = clips.find((c) => c.key === clipKey);
  if (!clip) return;

  isTrimmingRef.current = true;
  trimSideRef.current = side;
  trimKeyRef.current = clipKey;
  trimStartXRef.current = e.clientX;

  const laneKind = clip.kind;
  const laneTrack = Number(clip.track) || 0;

  // Capture starts for ripple shifting (your existing approach)
  const laneStarts = new Map();
  for (const c of clips) {
    if (!c) continue;
    if (c.kind !== laneKind) continue;
    if ((Number(c.track) || 0) !== laneTrack) continue;
    laneStarts.set(c.key, Number(c.start) || 0);
  }

  const start0 = Number(clip.start) || 0;
  const end0 = start0 + clipLen(clip);

  // If roll tool, we need the neighbor clip at the cut point.
  // - dragging RIGHT handle of left clip => neighbor is clip whose start == end0
  // - dragging LEFT handle of right clip => neighbor is clip whose end == start0
  let roll = null;
  if (tool === "roll") {
    if (side === "r") {
      const rightNeighbor = findAdjacentOnLane(clips, {
        kind: laneKind,
        track: laneTrack,
        atTime: end0,
        direction: "right",
        excludeKeys: [clipKey],
      });
      if (rightNeighbor) {
        const left0 = clip;           // the one you grabbed
        const right0 = rightNeighbor; // the neighbor

        roll = {
          leftKey: left0.key,
          rightKey: right0.key,

          // ✅ frozen baselines (these must NOT come from prev on move)
          cut0: end0,
          leftIn0: Number(left0.in) || 0,
          leftOut0: Number(left0.out) || 0,

          rightStart0: Number(right0.start) || 0,
          rightIn0: Number(right0.in) || 0,
          rightOut0: Number(right0.out) || 0,
        };
      }
    } else {
      const leftNeighbor = findAdjacentOnLane(clips, {
        kind: laneKind,
        track: laneTrack,
        atTime: start0,
        direction: "left",
        excludeKeys: [clipKey],
      });
      if (leftNeighbor) {
        const left0 = leftNeighbor;
        const right0 = clip;

        roll = {
          leftKey: left0.key,
          rightKey: right0.key,

          // ✅ frozen baselines
          cut0: start0,
          leftIn0: Number(left0.in) || 0,
          leftOut0: Number(left0.out) || 0,

          rightStart0: Number(right0.start) || 0,
          rightIn0: Number(right0.in) || 0,
          rightOut0: Number(right0.out) || 0,
        };
      }
    }
  }

  trimOrigRef.current = {
    start: start0,
    in: Number(clip.in) || 0,
    out: Number(clip.out) || 0,
    sourceDuration: Number(clip.sourceDuration) || 0,
    kind: laneKind,
    track: laneTrack,
    end: end0,
    laneStarts,
    roll, // { leftKey, rightKey } or null
  };

  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {}

  setActiveClipKey(clipKey);

  setTrimTip({
    x: e.clientX + 12,
    y: e.clientY + 12,
    text: formatTrimTooltip({
      side,
      inTime: clip.in,
      outTime: clip.out,
      length: clipLen(clip),
      deltaLength: 0,
      isRipple: tool === "ripple",
    }),
  });
}

function onTrimPointerMove(e) {
  if (!isTrimmingRef.current) return;

  const key = trimKeyRef.current;
  const side = trimSideRef.current;
  const orig = trimOrigRef.current;
  if (!key || !side || !orig) return;

  const dxSeconds = (e.clientX - trimStartXRef.current) / PPS;
  const isRipple = tool === "ripple";
  const isRoll = tool === "roll";

  setClips((prev) => {
    const primary = prev.find((c) => c.key === key);
    if (!primary) return prev;

    const laneKind = orig.kind;
    const laneTrack = Number(orig.track) || 0;

    // ---- ROLL EDIT ----
    // Move cut between 2 adjacent clips, keeping combined outside edges fixed.
    if (isRoll && orig.roll) {
      const left = prev.find((c) => c.key === orig.roll.leftKey);
      const right = prev.find((c) => c.key === orig.roll.rightKey);
      if (!left || !right) return prev;

        const r0 = orig.roll;
        const leftStart0 = Number(left.start) || 0; // left START is fixed in a roll edit
        const leftIn0 = Number(r0.leftIn0) || 0;
        const leftOut0 = Number(r0.leftOut0) || 0;
        const leftSrcDur = Number(left.sourceDuration || left?.video?.durationSeconds || 0);

        const rightStart0 = Number(r0.rightStart0) || 0;
        const rightIn0 = Number(r0.rightIn0) || 0;
        const rightOut0 = Number(r0.rightOut0) || 0;
        const rightSrcDur = Number(right.sourceDuration || right?.video?.durationSeconds || 0);

        const cut0 = Number(r0.cut0) || 0;
        const rightEnd0 = rightStart0 + Math.max(0, rightOut0 - rightIn0); // frozen outer edge

        let delta = dxSeconds;
      if (e.shiftKey) {
        // snap cut movement to whole seconds in timeline space
        const snappedCut = snapSeconds(cut0 + delta, 1);
        delta = snappedCut - cut0;
      }

      // Snap the MOVING CUT to lane edges (excluding these two clips)
      const laneEdges = getLaneEdgesSeconds(prev, {
        kind: laneKind,
        track: laneTrack,
        excludeKey: null,
      }).filter((t) => {
        // Remove the two clip edges so we don't "snap to ourselves"
        const eps = 1e-6;
        const leftS = leftStart0;
        const leftE = cut0;
        const rightS = rightStart0;
        const rightE = rightEnd0;
        return (
          Math.abs(t - leftS) > eps &&
          Math.abs(t - leftE) > eps &&
          Math.abs(t - rightS) > eps &&
          Math.abs(t - rightE) > eps
        );
      });

      const proposedCut = cut0 + delta;
      const snappedCut = snapToNearest(proposedCut, laneEdges, EDGE_SNAP_SEC);
      delta = snappedCut - cut0;

      // Constraints:
      // leftOut = leftOut0 + delta
      // rightIn = rightIn0 + delta
      // rightStart = rightStart0 + delta
      // rightEnd stays fixed because duration shrinks/grows with in shift
      // Helper: if we don't know srcDur yet, allow extension (Infinity)
        const safeSrcDur = (d) => (Number.isFinite(d) && d > 0.01 ? d : Infinity);

        // ---- Constraints ----
        // We’re moving the CUT by delta.
        // left.out increases by delta (left gets longer if delta > 0)
        // right.in increases by delta AND right.start increases by delta (right gets shorter if delta > 0)
        // Outer edges fixed: left.start fixed, right.end fixed.

        const leftSrcLimit = safeSrcDur(leftSrcDur);
        const rightSrcLimit = safeSrcDur(rightSrcDur);

        // 1) Left clip length >= MIN_LEN
        // leftLen = (leftOut0 + delta) - leftIn0
        const leftMinDelta = (leftIn0 + MIN_LEN) - leftOut0;

        // 2) Left out cannot exceed source duration (if known)
        const leftMaxDelta = leftSrcLimit - leftOut0; // Infinity if unknown => no constraint

        // 3) Right in cannot go below 0
        const rightMinDelta = 0 - rightIn0;

        // 4) Right clip length >= MIN_LEN
        // rightLen = rightOut0 - (rightIn0 + delta)
        const rightMaxDelta = (rightOut0 - MIN_LEN) - rightIn0;

        // 5) Right start cannot go below 0 (timeline constraint)
        const startMinDelta = -rightStart0;

        // 6) Also keep the cut from going beyond the fixed right end - MIN_LEN (timeline version of #4)
        const cutMaxDeltaByRightLen = (rightEnd0 - MIN_LEN) - cut0;

        // Optional: if right source duration is known and rightOut0 exceeds it, clamp the effective rightOut limit.
        // (This avoids weirdness if metadata arrives late and out is past EOF.)
        const effectiveRightOut0 = Math.min(rightOut0, rightSrcLimit);

        

        // Recompute #4/#6 using the effective out (still works when Infinity)
        const rightMaxDelta2 = (effectiveRightOut0 - MIN_LEN) - rightIn0;
        const rightEnd0b = rightStart0 + Math.max(0, effectiveRightOut0 - rightIn0);
        const cutMaxDeltaByRightLen2 = (rightEnd0b - MIN_LEN) - cut0;

        const minDelta = Math.max(leftMinDelta, rightMinDelta, startMinDelta);
        const maxDelta = Math.min(leftMaxDelta, rightMaxDelta2, cutMaxDeltaByRightLen2);

        // If constraints invert, just lock movement (prevents NaNs / jitter)
        if (!(minDelta <= maxDelta)) {
          delta = 0;
        } else {
          delta = clamp(delta, minDelta, maxDelta);
        }

      const nextLeftOut = leftOut0 + delta;
      const nextRightIn = rightIn0 + delta;
      const nextRightStart = rightStart0 + delta;

      // Update tooltip (show left length change)
      const oldLeftLen = Math.max(0, leftOut0 - leftIn0);
      const newLeftLen = Math.max(0, nextLeftOut - leftIn0);
      const deltaLen = newLeftLen - oldLeftLen;

      setTrimTip({
        x: e.clientX + 12,
        y: e.clientY + 12,
        text: `Roll: ${fmtTime(newLeftLen)} (${fmtDelta(deltaLen)})`,
      });

      return prev.map((c) => {
        if (c.key === left.key) return { ...c, out: nextLeftOut };
        if (c.key === right.key) return { ...c, start: nextRightStart, in: nextRightIn };
        return c;
      });
    }

    // ---- TRIM / RIPPLE (your existing logic) ----
    const srcDur = Number(primary.sourceDuration || orig.sourceDuration || 0);
    const start0 = Number(orig.start || 0);
    const in0 = Number(orig.in || 0);
    const out0 = Number(orig.out || 0);

    const oldStart = start0;
    const oldEnd = Number(orig.end || (start0 + (out0 - in0)));
    const oldLen = Math.max(0, out0 - in0);

    let nextPrimary = primary;

    // Ripple shifting info
    let delta = 0;
    let thresholdT = null;
    let affect = "none"; // "right" | "left" | "none"

    if (side === "r") {
      // RIGHT trim: changes OUT
      let nextOut = out0 + dxSeconds;
      if (e.shiftKey) nextOut = snapSeconds(nextOut, 1);
      nextOut = clamp(nextOut, in0 + MIN_LEN, srcDur || nextOut);

      // Snap the moving END edge on timeline
      const laneEdges = getLaneEdgesSeconds(prev, {
        kind: laneKind,
        track: laneTrack,
        excludeKey: key,
      });

      let nextEnd = oldStart + Math.max(0, nextOut - in0);
      const snappedEnd = snapToNearest(nextEnd, laneEdges, EDGE_SNAP_SEC);

      nextEnd = snappedEnd;
      nextOut = clamp(in0 + (nextEnd - oldStart), in0 + MIN_LEN, srcDur || (in0 + (nextEnd - oldStart)));

      nextPrimary = { ...primary, out: nextOut };

      const newLen = Math.max(0, nextOut - in0);
      const deltaLen = newLen - oldLen;

      setTrimTip({
        x: e.clientX + 12,
        y: e.clientY + 12,
        text: formatTrimTooltip({
          side,
          inTime: in0,
          outTime: nextOut,
          length: newLen,
          deltaLength: deltaLen,
          isRipple,
        }),
      });

      if (isRipple) {
        const newEnd = oldStart + Math.max(0, nextOut - in0);
        delta = newEnd - oldEnd;
        thresholdT = oldEnd;
        affect = "right";
      }
    } else {
      // LEFT trim
      if (!isRipple) {
        // NORMAL left trim: move START and IN together, keeping right edge fixed.
        const laneEdges = getLaneEdgesSeconds(prev, {
          kind: laneKind,
          track: laneTrack,
          excludeKey: key,
        });

        let d = dxSeconds;

        d = Math.max(d, -start0);
        d = Math.max(d, -in0);
        d = Math.min(d, out0 - MIN_LEN - in0);

        let nextStart = start0 + d;
        let nextIn = in0 + d;

        const snappedStart = snapToNearest(nextStart, laneEdges, EDGE_SNAP_SEC);
        let dd = snappedStart - start0;

        dd = Math.max(dd, -start0);
        dd = Math.max(dd, -in0);
        dd = Math.min(dd, out0 - MIN_LEN - in0);

        nextStart = start0 + dd;
        nextIn = in0 + dd;

        if (e.shiftKey) {
          const s2 = snapSeconds(nextStart, 1);
          let dd2 = s2 - start0;

          dd2 = Math.max(dd2, -start0);
          dd2 = Math.max(dd2, -in0);
          dd2 = Math.min(dd2, out0 - MIN_LEN - in0);

          nextStart = start0 + dd2;
          nextIn = in0 + dd2;
        }

        nextPrimary = { ...primary, start: nextStart, in: nextIn };

        const newLen = Math.max(0, out0 - nextIn);
        const deltaLen = newLen - oldLen;

        setTrimTip({
          x: e.clientX + 12,
          y: e.clientY + 12,
          text: formatTrimTooltip({
            side,
            inTime: nextIn,
            outTime: out0,
            length: newLen,
            deltaLength: deltaLen,
            isRipple: false,
          }),
        });

        affect = "none";
      } else {
        // RIPPLE left-edge trim (backwards) — your fixed logic
        const laneEdges = getLaneEdgesSeconds(prev, {
          kind: laneKind,
          track: laneTrack,
          excludeKey: key,
        });

        let d = dxSeconds;

        d = Math.max(d, -start0);
        d = Math.max(d, -in0);
        d = Math.min(d, out0 - MIN_LEN - in0);

        let nextStart = start0 + d;
        let nextIn = in0 + d;

        const snappedStart = snapToNearest(nextStart, laneEdges, EDGE_SNAP_SEC);
        let dd = snappedStart - start0;

        dd = Math.max(dd, -start0);
        dd = Math.max(dd, -in0);
        dd = Math.min(dd, out0 - MIN_LEN - in0);

        nextStart = start0 + dd;
        nextIn = in0 + dd;

        if (e.shiftKey) {
          const s2 = snapSeconds(nextStart, 1);
          let dd2 = s2 - start0;

          dd2 = Math.max(dd2, -start0);
          dd2 = Math.max(dd2, -in0);
          dd2 = Math.min(dd2, out0 - MIN_LEN - in0);

          nextStart = start0 + dd2;
          nextIn = in0 + dd2;
        }

        nextPrimary = { ...primary, start: nextStart, in: nextIn };

        const newLen = Math.max(0, out0 - nextIn);
        const deltaLen = newLen - oldLen;

        setTrimTip({
          x: e.clientX + 12,
          y: e.clientY + 12,
          text: formatTrimTooltip({
            side,
            inTime: nextIn,
            outTime: out0,
            length: newLen,
            deltaLength: deltaLen,
            isRipple: true,
          }),
        });

        delta = nextStart - oldStart;
        thresholdT = oldStart;
        affect = "left";
      }
    }

    if (!isRipple || affect === "none" || Math.abs(delta) < 1e-9) {
      return prev.map((c) => (c.key === key ? nextPrimary : c));
    }

    const laneStarts = orig.laneStarts || new Map();

    return prev.map((c) => {
      if (!c) return c;

      if (c.key === key) return nextPrimary;

      if (c.kind !== laneKind) return c;
      if ((Number(c.track) || 0) !== laneTrack) return c;

      const baseStart = Number(laneStarts.get(c.key)) || 0;

      if (affect === "right") {
        if (baseStart >= thresholdT - 1e-6) {
          return { ...c, start: Math.max(0, baseStart + delta) };
        }
        return c;
      }

      if (affect === "left") {
        if (baseStart < thresholdT - 1e-6) {
          return { ...c, start: Math.max(0, baseStart + delta) };
        }
        return c;
      }

      return c;
    });
  });
}

function onTrimPointerUp(e) {
  if (!isTrimmingRef.current) return;

  isTrimmingRef.current = false;
  trimSideRef.current = null;
  trimKeyRef.current = null;
  trimStartXRef.current = 0;
  trimOrigRef.current = null;

  setTrimTip(null);

  try {
    e.currentTarget.releasePointerCapture(e.pointerId);
  } catch {}
}


  function findAdjacentOnLane(prevClips, { kind, track, atTime, direction, excludeKeys = [] }) {
  const EPS = 1e-4;
  const ex = new Set(excludeKeys || []);
  const candidates = prevClips.filter((c) => {
    if (!c) return false;
    if (ex.has(c.key)) return false;
    if (c.kind !== kind) return false;
    if ((Number(c.track) || 0) !== (Number(track) || 0)) return false;
    return true;
  });

  if (direction === "right") {
    // find clip whose start is ~ atTime
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
      const s = Number(c.start) || 0;
      const d = Math.abs(s - atTime);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD <= 0.2 ? best : null; // tolerance for "butted" edits
  }

  if (direction === "left") {
    // find clip whose end is ~ atTime
    let best = null;
    let bestD = Infinity;
    for (const c of candidates) {
      const e = (Number(c.start) || 0) + clipLen(c);
      const d = Math.abs(e - atTime);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD <= 0.02 ? best : null;
  }

  return null;
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
    const endSeconds = Math.max(10, Math.ceil(timelineWidth / PPS));
    const ticks = [];
    for (let t = 0; t <= endSeconds; t += 1) ticks.push({ t, major: t % 5 === 0 });
    return ticks;
  }, [timelineWidth, PPS]);

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

      // ✅ Don't switch tools while using modifier shortcuts (Ctrl/Cmd/Alt)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = (e.key || "").toLowerCase();

      if (k === "v") setTool("select");
      if (k === "c") setTool("razor");
      if (k === "b") setTool("ripple");
      if (k === "y") setTool("slip");
      if (k === "n") setTool("roll");
      if (k === "a") setTool("trackFwd"); // ✅ Track Select Forward (A)
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
    <div
      className={`genEditWrap ${
        tool === "razor" ? "toolRazor"
        : tool === "slip" ? "toolSlip"
        : tool === "ripple" ? "toolRipple"
        : tool === "roll" ? "toolRoll"
        : "toolSelect"
      }`}
    >
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

      {slipTip ? (
        <div className="genEditSlipTip" style={{ left: slipTip.x, top: slipTip.y }} role="status" aria-live="polite">
          {slipTip.text}
        </div>
      ) : null}

      {trimTip ? (
        <div className="genEditTrimTip" style={{ left: trimTip.x, top: trimTip.y }} role="status" aria-live="polite">
          {trimTip.text}
        </div>
      ) : null}

      <div className="genEditGrid">
        {/* LEFT: Library */}
        <aside className="genEditLibrary">
          <div className="genEditLibraryHead">
            <div className="genEditLibraryTitle">Library</div>

            <div className="genEditLibTabs" role="tablist" aria-label="Library type">
              <button
                type="button"
                className={`genEditLibTab ${libTab === "video" ? "active" : ""}`}
                onClick={() => setLibTab("video")}
              >
                Video
              </button>
              <button
                type="button"
                className={`genEditLibTab ${libTab === "audio" ? "active" : ""}`}
                onClick={() => setLibTab("audio")}
              >
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
              <button type="button" className={`genEditToolBtn ${tool === "ripple" ? "active" : ""}`} onClick={() => setTool("ripple")} title="Ripple Edit (B)">
                ↔
              </button>
              <button type="button" className={`genEditToolBtn ${tool === "slip" ? "active" : ""}`} onClick={() => setTool("slip")} title="Slip Tool (Y)">
                ⇆
              </button>
              <button type="button" className={`genEditToolBtn ${tool === "roll" ? "active" : ""}`} onClick={() => setTool("roll")} title="Rool Tool (N)">
                ⟺
              </button>
              <button
                type="button"
                className={`genEditToolBtn ${tool === "trackFwd" ? "active" : ""}`}
                onClick={() => setTool("trackFwd")}
                title="Track Select Forward (A)"
              >
                {/* placeholder icon until you swap it */}
                ⇥
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

                {/* V1 */}
                {VIDEO_TRACKS.map((lane) => (
                  <div key={`${lane.kind}-${lane.track}`} className={`genEditGutterCell ${lane.kind}`}>
                    <div className="genEditGutterCellInner">
                      <span>{lane.label}</span>
                    </div>
                  </div>
                ))}

                {/* A lanes */}
                {AUDIO_TRACKS.map((lane) => (
                  <div key={`${lane.kind}-${lane.track}`} className={`genEditGutterCell ${lane.kind}`}>
                    <div className="genEditGutterCellInner">
                      <span>{lane.label}</span>

                      {lane.track > 0 ? (
                        <button
                          type="button"
                          className="genEditLaneDelBtn"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            removeAudioLane(lane.track);
                          }}
                          title={`Remove ${lane.label}`}
                          aria-label={`Remove ${lane.label}`}
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}

                {/* Add audio row */}
                <button
                  type="button"
                  className="genEditAddLaneBtn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    addAudioLane();
                  }}
                  disabled={audioLaneCount >= 5}
                  title={audioLaneCount >= 5 ? "Max 5 audio lanes" : "Add audio lane"}
                >
                  ＋
                </button>
              </div>

              {/* Scrollable time area */}
              <div className="genEditTimelineViewport" ref={timelineViewportRef}>
                <div className="genEditTimelineScroll" ref={timelineScrollRef}>
                  {/* ✅ Time stack: header (timecode row) + lanes share same coordinate space */}
                  <div
                    ref={timelineOriginRef}
                    className="genEditTimeStack"
                    style={{ width: timelineWidth }}
                    onPointerMove={(e) => {
                      onTimelinePointerMove(e);
                    }}
                    onPointerLeave={() => {
                      onTimelinePointerLeave();
                    }}
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
                    {tool === "razor" && razorHoverT != null ? <div className="genEditRazorLine" style={{ left: `${razorHoverT * PPS}px` }} /> : null}

                    {boxSel ? (
                      <div
                        className="genEditBoxSelect"
                        style={{
                          left: `${boxSel.left}px`,
                          top: `${boxSel.top}px`,
                          width: `${boxSel.width}px`,
                          height: `${boxSel.height}px`,
                        }}
                      />
                    ) : null}

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

                    {/* Lanes */}
                    <div className="genEditTimeOrigin" onPointerDown={onLanesPointerDown} onMouseDown={onTimelineBackgroundPointerDown}>
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
                                      className={["genEditClip", c.kind, isSelected ? "selected active" : "", isBoxHot ? "boxHot" : ""].join(" ")}
                                      data-clip-key={c.key}
                                      style={{ left: `${left}px`, width: `${width}px` }}
                                      onPointerDown={(e) => onClipPointerDown(e, c.key)}
                                      onPointerMove={tool === "slip" ? onSlipPointerMove : onClipPointerMove}
                                      onPointerUp={tool === "slip" ? onSlipPointerUp : onClipPointerUp}
                                      onPointerCancel={tool === "slip" ? onSlipPointerUp : onClipPointerUp}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      onClick={(e) => e.stopPropagation()}
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

                                            if (e.shiftKey) rippleDelete([c.key]);
                                            else removeFromTimeline([c.key]);
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

                        {!clips.length ? <div className="genEditTimelineEmpty">Drag clips from your library onto the timeline.</div> : null}
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