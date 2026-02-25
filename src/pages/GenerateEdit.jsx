// GenerateEdit.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./GenerateEdit.css";
import { getUserVideos, whoami, streamUrl, thumbUrl } from "../api.js";
import GeneratePublishModal from "./GeneratePublishModal.jsx";

const PROJECTS_INDEX_LS_KEY = "mytube_generate_projects_v1"; // list of { id, sequenceTitle, updatedAt }
function projectKey(id) { return `genproj:${id}`; }

function makeProjectId() {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function clampTrackForKind(kind, track) {
  if (kind === "video") return 0;
  return clamp(Number(track) || 0, 0, 4);
}

function serializeClips(clips) {
  const arr = Array.isArray(clips) ? clips : [];
  return arr
    .filter(Boolean)
    .map((c) => {
      const kind = c?.kind === "audio" ? "audio" : "video";
      const videoId = c?.video?.id ?? c?.videoId ?? null;

      return {
        key: String(c?.key || ""),
        kind,
        track: clampTrackForKind(kind, c?.track),
        start: Math.max(0, Number(c?.start) || 0),
        in: Math.max(0, Number(c?.in) || 0),
        out: Math.max(0, Number(c?.out) || 0),
        sourceDuration: Math.max(
          0,
          Number(c?.sourceDuration || c?.video?.durationSeconds || 0) || 0
        ),
        videoId,
      };
    })
    // if key somehow blank, give it one so React + persistence are stable
    .map((c) => ({
      ...c,
      key: c.key || `${c.kind}-${c.videoId || "x"}-${c.track}-${c.start}-${Date.now()}`,
    }));
}

function requiredAudioLaneCountFromLite(clipsLite) {
  const maxTrack =
    (Array.isArray(clipsLite) ? clipsLite : [])
      .filter((c) => c?.kind === "audio")
      .reduce((m, c) => Math.max(m, Number(c.track) || 0), -1);

  return Math.max(1, maxTrack + 1);
}

function hydrateClipsFromSaved(savedClips, libraryVideos) {
  const lite = Array.isArray(savedClips) ? savedClips : [];

  return lite
    .filter(Boolean)
    .map((c) => {
      const kind = c.kind === "audio" ? "audio" : "video";
      const track = clampTrackForKind(kind, c.track);
      const videoId = c?.videoId ?? c?.video?.id ?? null;

      const bound =
        videoId != null && Array.isArray(libraryVideos)
          ? libraryVideos.find((v) => String(v.id) === String(videoId))
          : null;

      const srcDur =
        Number(c.sourceDuration || bound?.durationSeconds || 0) || 0;

      const in0 = Math.max(0, Number(c.in) || 0);
      const out0 = Math.max(in0, Number(c.out) || 0);

      return {
        key: String(
          c.key || `${kind}-${videoId || "x"}-${track}-${Number(c.start) || 0}-${Date.now()}`
        ),
        kind,
        track,
        start: Math.max(0, Number(c.start) || 0),
        in: in0,
        out: out0,
        sourceDuration: srcDur,
        videoId,
        video: bound || (videoId != null ? { id: videoId, title: "(loading…)" } : null),
      };
    });
}

function canUseLocalStorage() {
  if (typeof window === "undefined") return false;
  try {
    const k = "__ls_test__";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch (e) {
    console.warn("[GenerateEdit] localStorage unavailable:", e);
    return false;
  }
}

function loadProjectIndex() {
  if (!canUseLocalStorage()) return [];
  const raw = window.localStorage.getItem(PROJECTS_INDEX_LS_KEY);
  const arr = safeJsonParse(raw, []);
  const out = Array.isArray(arr) ? arr : [];
  console.log("[GenerateEdit] loadProjectIndex", out);
  return out;
}

function saveProjectIndex(arr) {
  if (!canUseLocalStorage()) return false;
  try {
    window.localStorage.setItem(PROJECTS_INDEX_LS_KEY, JSON.stringify(arr || []));
    console.log("[GenerateEdit] saveProjectIndex OK", arr);
    return true;
  } catch (e) {
    console.error("[GenerateEdit] saveProjectIndex FAILED", e);
    return false;
  }
}

  function getIndexedProjectTitle(id) {
    const idx = loadProjectIndex();
   const hit = idx.find((x) => String(x?.id) === String(id));
    const t = String(hit?.sequenceTitle || "").trim();
    return t || "";
  }

  function loadProjectById(id) {
    if (!canUseLocalStorage()) return null;
    const key = projectKey(id);
    const raw = window.localStorage.getItem(key);

    if (raw == null) return null;

    const obj = safeJsonParse(raw, "__PARSE_FAIL__");
    if (obj === "__PARSE_FAIL__") {
      console.error("[GenerateEdit] Project JSON parse failed for", key, "raw=", raw.slice(0, 200));
      return { __parseFailed: true, raw }; // sentinel
    }

    return obj && typeof obj === "object" ? obj : null;
  }

function saveProjectById(id, payload) {
  if (!canUseLocalStorage()) return false;
  try {
    const key = projectKey(id);
    window.localStorage.setItem(key, JSON.stringify(payload));
    console.log("[GenerateEdit] saveProjectById OK", id, "key=", key, "bytes=", JSON.stringify(payload).length);
    return true;
  } catch (e) {
    console.error("[GenerateEdit] saveProjectById FAILED", e);
    return false;
  }
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
  
  const params = useParams();
  const routeProjectId = params.projectId || params.id || "";

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

  // ---- Multi-track audio pool ----
  const audioHostRef = useRef(null); // hidden DOM container to hold <audio> nodes
  const audioPoolRef = useRef(new Map());

  // ---- Library audio preview (click-to-play on thumbnail) ----
  const previewAudioRef = useRef(null);        // single <audio> used for library previews
  const [previewAudioId, setPreviewAudioId] = useState(null); // which library audio is currently previewing

  // key -> {
  //   el: HTMLAudioElement,
  //   src: string,
  //   srcNorm: string,
  //   swapping: boolean,
  //   lastSyncAt: number,
  //   lastWantedAt: number,     // ✅ hysteresis to avoid thrash/crackle
  //   everPlayed: boolean,
  // }

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

  // ✅ clocking
  const rafTickRef = useRef(0);
  const rvfcHandleRef = useRef(0); // ✅ requestVideoFrameCallback handle
  const lastUiPlayheadSetRef = useRef(0);
  const lastAudioSyncCallRef = useRef(0);

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

  // Trim/Ripple tooltip
  const [trimTip, setTrimTip] = useState(null);
  // trimTip: { x, y, text } using client coords (position:fixed)

  // UI-only duration overrides for videos missing durationSeconds
  const [libDurMap, setLibDurMap] = useState(() => new Map());

  // Tracks
  const VIDEO_TRACKS = useMemo(() => [{ kind: "video", track: 0, label: "V1" }], []);

  // dynamic audio lanes (A1..A5)
  const [audioLaneCount, setAudioLaneCount] = useState(1); // start with just A1


  const clipsRef = useRef([]);
  const sequenceTitleRef = useRef("Timeline");
  const playheadStateRef = useRef(0);
  const audioLaneCountRef = useRef(1);

  useEffect(() => { clipsRef.current = clips; }, [clips]);
  useEffect(() => { sequenceTitleRef.current = sequenceTitle; }, [sequenceTitle]);
  useEffect(() => { playheadStateRef.current = playhead; }, [playhead]);
  useEffect(() => { audioLaneCountRef.current = audioLaneCount; }, [audioLaneCount]);

  function setClipsSynced(updater) {
  setClips((prev) => {
    const next = typeof updater === "function" ? updater(prev) : updater;
    clipsRef.current = next;
    return next;
  });
}

  function normalizeMediaUrl(u) {
    try {
      return new URL(String(u || ""), window.location.href).href;
    } catch {
      return String(u || "");
    }
  }

  function resolveVideoById(id) {
    if (id == null) return null;
    const hit = (libraryVideos || []).find((v) => String(v.id) === String(id));
    return hit || null;
  }

  function resolveMediaForClip(c) {
    const id = c?.videoId ?? c?.video?.id ?? null;
    if (id == null) return null;

    // Prefer up-to-date library object if we have it
    const fresh = resolveVideoById(id);
    if (fresh) return fresh;

    // Fallback: id-only object so streamUrl({id}) can still work
    return { id };
  }

  // ✅ helper used by audio swap detection
  function normalizeUrl(u) {
    return normalizeMediaUrl(u);
  }

  function getMediaType(v) {
    // support both server styles
    return String(v?.media_type ?? v?.mediaType ?? "").toLowerCase().trim();
  }

  function isAudioMedia(v) {
    const mt = getMediaType(v);
    return mt === "audio" || mt.startsWith("audio/");
  }

  const libVideosOnly = useMemo(() => (libraryVideos || []).filter((v) => !isAudioMedia(v)), [libraryVideos]);
  const libAudioOnly = useMemo(() => (libraryVideos || []).filter((v) => isAudioMedia(v)), [libraryVideos]);

  const activeLibList = libTab === "audio" ? libAudioOnly : libVideosOnly;

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

  const clipsSorted = useMemo(() => {
    return clips
      .slice()
      .sort((a, b) => a.start - b.start || (Number(b.track) || 0) - (Number(a.track) || 0));
  }, [clips]);

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
        kind: c.kind,
        track: Number(c.track) || 0,
        start: Number(c.start) || 0,
        in: Number(c.in) || 0,
        out: Number(c.out) || 0,
        sourceDuration: Number(c.sourceDuration) || Number(c?.video?.durationSeconds) || 0,
        video: c.video || null,
        videoId: c?.videoId ?? c?.video?.id ?? null,
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

    const newClips = clipb.items.map((it) => {
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

    setClipsSynced((prev) => [...prev, ...newClips]);

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
    return () => {
      // stop clocks
      stopAllClocks();

      for (const { el } of audioPoolRef.current.values()) {
        try {
          el.pause();
        } catch {}
        try {
          el.removeAttribute("src");
          el.load();
        } catch {}
        try {
          el.remove();
        } catch {}
      }
      audioPoolRef.current.clear();
    };
  }, []);

  function stopLibraryPreview() {
  const a = previewAudioRef.current;
  if (!a) return;

  try { a.pause(); } catch {}
  try {
    a.removeAttribute("src");
    a.load();
  } catch {}

  setPreviewAudioId(null);
}

  async function toggleLibraryAudioPreview(v) {
    if (!v?.id) return;
    if (!isAudioMedia(v)) return;

    const src = normalizeMediaUrl(streamUrl(v) || "");
    if (!src) return;

    const a = previewAudioRef.current;
    if (!a) return;

    // If clicking the same item that's currently previewing -> stop
    if (String(previewAudioId) === String(v.id) && !a.paused) {
      stopLibraryPreview();
      return;
    }

    // Otherwise start / switch preview
    try {
      a.pause();
    } catch {}

    setPreviewAudioId(v.id);

    try {
      a.src = src;
      a.currentTime = 0;
      a.muted = muted;
      a.volume = clamp(Number(volume), 0, 1);

      // play (ignore autoplay rejection)
      const p = a.play?.();
      if (p?.catch) p.catch(() => {});
    } catch {
      // if anything goes wrong, reset state
      stopLibraryPreview();
    }
  }

  // Copy / Paste hotkeys
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (isTyping) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && key === "c" && !e.shiftKey) {
        e.preventDefault();
        copySelectedClips();
        return;
      }

      if (mod && key === "v" && !e.shiftKey) {
        e.preventDefault();
        pasteClipboardAtPlayhead();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sequenceTitle, clips, playhead, audioLaneCount]);

  function applySnapshot(snap) {
    if (!snap) return;
    setSequenceTitle(String(snap.sequenceTitle || "Timeline"));
    setClipsSynced(Array.isArray(snap.clips) ? snap.clips : []);
    setAudioLaneCount(clamp(Number(snap.audioLaneCount) || 1, 1, 5));
    setPlayhead(Math.max(0, Number(snap.playhead) || 0));
    playheadRef.current = Math.max(0, Number(snap.playhead) || 0);

    setSelectedClipKeys(new Set());
    setActiveClipKey(null);

    loadedClipKeyRef.current = null;
    loadedSrcRef.current = "";
    requestAnimationFrame(() => {
      ensureLoadedForTimelineTime(playheadRef.current, { autoplay: wantedPlayRef.current }).finally(() => {
        if (wantedPlayRef.current) forceResume("applySnapshot");
      });
    });
  }

  function pushUndo(reason = "") {
    if (!didHydrateRef.current) return;

    const snap = getSnapshot();
    const stack = undoStackRef.current;

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
      redoStackRef.current = [];
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
    if (undoStackRef.current.length > UNDO_LIMIT)
      undoStackRef.current.splice(0, undoStackRef.current.length - UNDO_LIMIT);

    applySnapshot(next);
  }

  // Ensure we have a valid projectId in the URL
  useEffect(() => {
    const rid = String(routeProjectId || "").trim();
    const valid = rid && rid !== "undefined" && rid !== "null";

    if (!valid) {
      const newId = makeProjectId();
      nav(`/generate/edit/${newId}`, { replace: true });
      return;
    }

    setProjectId(rid);
  }, [routeProjectId, nav]);

  useEffect(() => {
  console.log("[CLIPS state changed]", {
    total: clips.length,
    audio: clips.filter((c) => c?.kind === "audio").length,
    video: clips.filter((c) => c?.kind === "video").length,
    sample: clips.slice(0, 5).map((c) => ({
      key: c.key,
      kind: c.kind,
      track: c.track,
      start: c.start,
      in: c.in,
      out: c.out,
      videoId: c?.videoId ?? c?.video?.id ?? null,
    })),
  });
}, [clips]);

  // -------- Load project on id change --------
useEffect(() => {
  if (!projectId) return;

  didHydrateRef.current = false;
  setDirty(false);
  setIsEditingTitle(false);

  // optional but helpful: reset undo/redo for this project load
  undoStackRef.current = [];
  redoStackRef.current = [];

  const p = loadProjectById(projectId);

  if (p?.__parseFailed) {
    // DO NOT overwrite. Keep empty state and show an error.
    setLibErr("Saved project data is corrupted and could not be loaded. Check console for details.");
    setClipsSynced([]);
    setAudioLaneCount(1);
    setPlayhead(0);
    playheadRef.current = 0;
    return;
  }

  if (p) {
    // ✅ hydrate title FIRST (this was missing)
    const loadedTitle =
      String(p.sequenceTitle || "").trim() ||
      getIndexedProjectTitle(projectId) ||
      "Timeline";

    setSequenceTitle(loadedTitle);

    const loadedAny =
    Array.isArray(p.clips) ? p.clips :
    Array.isArray(p.timeline) ? p.timeline :
    [];

    // ✅ normalize: accept both "lite" and older "full" shapes
    const normalizedLite = loadedAny
      .filter(Boolean)
      .map((c) => {
        const kind = c?.kind === "audio" ? "audio" : "video";
        const videoId = c?.videoId ?? c?.video?.id ?? null;

        const track = kind === "video" ? 0 : clamp(Number(c?.track) || 0, 0, 4);

        const start = Math.max(0, Number(c?.start) || 0);
        const in0 = Math.max(0, Number(c?.in) || 0);
        const out0 = Math.max(in0, Number(c?.out) || 0);

        const srcDur = Math.max(
          0,
          Number(c?.sourceDuration || c?.video?.durationSeconds || 0) || 0
        );

        const key =
          String(c?.key || "").trim() ||
          `${kind}-${videoId || "x"}-${track}-${start}-${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}`;

        return { key, kind, track, start, in: in0, out: out0, sourceDuration: srcDur, videoId };
      });

  // ✅ hydrate: bind video objects if available
  const migrated = normalizedLite.map((c) => {
  const bound =
    c.videoId != null && Array.isArray(libraryVideos)
      ? libraryVideos.find((v) => String(v.id) === String(c.videoId))
      : null;

  // ✅ IMPORTANT: never leave video null if we have a videoId
  // This allows streamUrl({id}) to work immediately, even before library loads.
  const placeholder =
    c.videoId != null
      ? {
          id: c.videoId,
          title: c.kind === "audio" ? "(audio…)" : "(video…)",
          // include a media_type hint if your API uses it
          media_type: c.kind === "audio" ? "audio" : "video",
        }
      : null;

  return {
    ...c,
    videoId: c.videoId ?? bound?.id ?? null,
    video: bound || placeholder,
  };
});

  setClipsSynced(migrated);

  // ✅ ensure audio lanes
  const requiredFromClips =
    migrated
      .filter((c) => c?.kind === "audio")
      .reduce((m, c) => Math.max(m, Number(c.track) || 0), -1) + 1;

  const savedLaneCount = Number(p.audioLaneCount);
  const base = Number.isFinite(savedLaneCount) && savedLaneCount > 0 ? savedLaneCount : 1;

  setAudioLaneCount(clamp(Math.max(base, requiredFromClips || 1), 1, 5));

    const ph = Number.isFinite(Number(p.playhead)) ? Math.max(0, Number(p.playhead)) : 0;
    setPlayhead(ph);
    playheadRef.current = ph;
  } else {
    // new project
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
      ...idx.filter((x) => String(x?.id) !== String(projectId)),
    ];
    saveProjectIndex(nextIdx);

    setClipsSynced([]);
    setAudioLaneCount(1);
    setPlayhead(0);
    playheadRef.current = 0;
  }

  // reset player state
  loadedClipKeyRef.current = null;
  loadedSrcRef.current = "";
  wantedPlayRef.current = false;
  setIsPlaying(false);

  // clear any audios (so they don't keep crackling between projects)
  for (const key of Array.from(audioPoolRef.current.keys())) {
    unloadAndRemoveAudioKey(key);
  }

  const v = videoRef.current;
  if (v) {
    try {
      v.pause();
    } catch {}
  }

  requestAnimationFrame(() => {
    // seed undo with the freshly loaded snapshot
    undoStackRef.current = [getSnapshot()];
    redoStackRef.current = [];
    didHydrateRef.current = true;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [projectId]);

  // -------- Mark dirty when editing (after hydrate) --------
  useEffect(() => {
    if (!didHydrateRef.current) return;
    setDirty(true);
  }, [sequenceTitle, clips, playhead, audioLaneCount]);

  function rectsIntersect(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  function setSelectionFromKeys(keys, { additive } = { additive: false }) {
    setSelectedClipKeys((prev) => {
      const base = additive ? new Set(prev) : new Set();
      for (const k of keys) base.add(k);
      return base;
    });

    const arr = Array.from(keys || []);
    if (arr.length) setActiveClipKey(arr[arr.length - 1]);
    else if (!additive) setActiveClipKey(null);
  }

  function setSelectionImmediate(keys, { additive } = { additive: false }) {
    const next = additive ? new Set(selectedClipKeysRef.current || []) : new Set();
    for (const k of keys || []) next.add(k);

    setSelectedClipKeys(next);
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

  function formatTrimTooltip({ side, length, deltaLength, isRipple }) {
    const sideLabel = side === "l" ? (isRipple ? "Ripple Trim" : "Trim") : isRipple ? "Ripple Trim" : "Trim";
    const deltaLabel = Math.abs(deltaLength) > 1e-6 ? ` (${fmtDelta(deltaLength)})` : "";
    return `${sideLabel}: ${fmtTime(length)}${deltaLabel}`;
  }

  function addAudioLane() {
    pushUndo("add audio lane");
    setAudioLaneCount((n) => clamp((Number(n) || 1) + 1, 1, 5));
  }

  function removeAudioLane(trackToRemove) {
    pushUndo("remove audio lane");
    if (Number(trackToRemove) === 0) return;

    setClipsSynced((prev) => {
      const t = Number(trackToRemove);
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
    if (tool === "razor") return;

    if (tool === "trackFwd") {
      if (e.target?.closest?.(".genEditClip")) return;
      if (e.target?.closest?.(".genEditPlayheadHandle")) return;

      e.preventDefault();
      e.stopPropagation();

      const lane = getLaneFromClientY(e.clientY);
      if (!lane) return;

      const t = getTimeFromClientX(e.clientX);

      selectTrackForwardFrom({
        kind: lane.kind,
        track: Number(lane.track) || 0,
        time: t,
        allLanes: !!e.shiftKey,
      });

      return;
    }

    if (e.target?.closest?.(".genEditClip")) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;

    e.preventDefault();
    e.stopPropagation();

    isBoxSelectingRef.current = true;
    boxAdditiveRef.current = !!e.shiftKey;

    boxStartRef.current = { x: e.clientX, y: e.clientY };

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

      if (dragDx < 3 && dragDy < 3) {
        setBoxSel(null);
        setBoxHoverKeys(new Set());
        if (!boxAdditiveRef.current) clearSelection();
        return;
      }

      const selRectClient = {
        left: Math.min(x1, x2),
        top: Math.min(y1, y2),
        right: Math.max(x1, x2),
        bottom: Math.max(y1, y2),
      };

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
      setBoxHoverKeys(new Set());
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
      sequenceTitle: String(sequenceTitleRef.current || "Timeline"),
      updatedAt: Date.now(),
      playhead: Number(playheadStateRef.current || 0),
      clips: Array.isArray(clipsRef.current) ? clipsRef.current : [],
      audioLaneCount: clamp(Number(audioLaneCountRef.current) || 1, 1, 5),
    };

    console.log("[SAVE payload]", payload);

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

        if (!selectedVideo && arr.length) {
          const firstVideo = arr.find((v) => !isAudioMedia(v));
          const firstAudio = arr.find((v) => isAudioMedia(v));
          setSelectedVideo(firstVideo || firstAudio || null);
        }

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

    setClipsSynced((prev) =>
      prev.map((c) => {
        const vid = c?.video;
        const id = c?.videoId ?? vid?.id;
        if (!id) return c;

        const fresh = libraryVideos.find((v) => String(v.id) === String(id));
        return fresh ? { ...c, videoId: id, video: fresh } : c;
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

    if (timelineWidth < prevW - 1) {
      requestAnimationFrame(() => {
        const maxScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth);

        if (viewport.scrollLeft > maxScroll) viewport.scrollLeft = maxScroll;

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
    const EPS = 0.03; // 30ms grace
    return t >= s && t < e - EPS;
  }

  function audioClipCoversTime(c, t) {
    const s = Number(c.start) || 0;
    const e = s + clipLen(c);

    // Keep audio alive slightly past the edge to avoid thrash
    const IN_PAD = 0.01;
    const OUT_PAD = 0.01; // ✅ slightly larger pad -> fewer stop/start crackles
    return t >= s - IN_PAD && t < e + OUT_PAD;
  }

  function ensureAudioElementForKey(key) {
    let entry = audioPoolRef.current.get(key);
    if (entry?.el) return entry;

    const host = audioHostRef.current;
    const el = document.createElement("audio");
    el.preload = "auto";
    el.style.display = "none";
    el.playsInline = true;

    // ✅ helps some browsers with crackles during rapid play/pause
    try {
      el.crossOrigin = "anonymous";
    } catch {}

    try {
      host?.appendChild(el);
    } catch {}

    entry = {
      el,
      src: "",
      srcNorm: "",
      swapping: false,
      lastSyncAt: 0,
      lastWantedAt: performance.now(),
      everPlayed: false,
    };
    audioPoolRef.current.set(key, entry);
    return entry;
  }

  function unloadAndRemoveAudioKey(key) {
    const entry = audioPoolRef.current.get(key);
    if (!entry) return;

    const a = entry.el;

    try {
      a.pause();
    } catch {}
    try {
      a.removeAttribute("src");
      a.load();
    } catch {}
    try {
      a.remove();
    } catch {}

    audioPoolRef.current.delete(key);
  }

  function desiredAudiosAtTime(t) {
    const timelineT = Math.max(0, Number(t) || 0);

    const candidates = clipsSorted.filter((c) => c?.kind === "audio" && audioClipCoversTime(c, timelineT));
    if (!candidates.length) return [];

    // top-most tracks first (higher track index wins), then later starts
    candidates.sort(
      (a, b) =>
        (Number(b.track) || 0) - (Number(a.track) || 0) ||
        (Number(b.start) || 0) - (Number(a.start) || 0)
    );

    const out = [];
    for (const clip of candidates) {
      const media = resolveMediaForClip(clip);
      if (!media) continue;

      const srcRaw = streamUrl(media) || "";
      const src = normalizeMediaUrl(srcRaw);
      if (!src) continue;

      const local = clamp(timelineT - (Number(clip.start) || 0), 0, clipLen(clip));
      const targetTime = (Number(clip.in) || 0) + local;

      out.push({ clip, src, targetTime });
    }
    return out;
  }

  // keep mute/vol applied to video + all audio elements
  function applyMuteVolAll() {
    const vv = videoRef.current;
    try {
      if (vv) {
        vv.muted = muted;
        vv.volume = clamp(Number(volume), 0, 1);
      }
    } catch {}

    for (const { el } of audioPoolRef.current.values()) {
      try {
        el.muted = muted;
        el.volume = clamp(Number(volume), 0, 1);
      } catch {}
    }
  }

  function findVideoClipAtTime(t) {
    const candidates = clipsSorted.filter((c) => c?.kind === "video" && clipCoversTime(c, t));
    if (!candidates.length) return null;
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
    const EPS = 1e-6;
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

  function atTimelineEnd(t) {
    const tt = Number(t) || 0;
    return tt >= Math.max(0, Number(timelineEnd) || 0) - 0.04;
  }

  const currentVideoClip = useMemo(() => findVideoClipAtTime(playhead), [clipsSorted, playhead]);

  const viewerSrc = useMemo(() => {
    const c = currentVideoClip;
    const media = resolveMediaForClip(c);
    if (!media) return "";
    return streamUrl(media) || "";
  }, [currentVideoClip, libraryVideos]);

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

  function snapToPlayhead(nextStart, movingKey, snapSec = EDGE_SNAP_SEC) {
    const moving = clips.find((c) => c.key === movingKey);
    if (!moving) return nextStart;

    const len = clipLen(moving);
    const ph = Number(playheadRef.current ?? playhead) || 0;

    const startD = Math.abs(nextStart - ph);
    const endD = Math.abs(nextStart + len - ph);

    if (startD <= snapSec && startD <= endD) return ph;        // snap START to playhead
    if (endD <= snapSec) return ph - len;                      // snap END to playhead
    return nextStart;
  }

  function getLaneEdgeTargets({ kind, track, excludeKey }) {
  const out = [];
  for (const c of clipsSorted) {
    if (!c) continue;
    if (c.key === excludeKey) continue;
    if (c.kind !== kind) continue;
    if ((Number(c.track) || 0) !== (Number(track) || 0)) continue;

    const s = Number(c.start) || 0;
    const e = s + clipLen(c);
    out.push(s, e);
  }
  return out;
}

/**
 * Magnetic snapping for a moving clip:
 * - snaps moving START to lane edges
 * - snaps moving END to lane edges (by adjusting start)
 * - lane-aware: only snaps within same kind+track
 * - optional: snap to playhead too
 */
  function snapToMagneticLane(nextStart, movingKey, lane, { includePlayhead = true } = {}) {
    const moving = clips.find((c) => c.key === movingKey);
    if (!moving) return nextStart;

    const kind = lane?.kind ?? moving.kind;
    const track = Number(lane?.track ?? moving.track) || 0;

    const movingLen = clipLen(moving);
    const movingStart = Number(nextStart) || 0;
    const movingEnd = movingStart + movingLen;

    const targets = getLaneEdgeTargets({ kind, track, excludeKey: movingKey });

    // optional: playhead as a snap target too
    if (includePlayhead) {
      const ph = Number(playheadRef.current ?? playhead) || 0;
      targets.push(ph);
    }

    let best = null;

    for (const target of targets) {
      // snap START to target
      const dStart = Math.abs(movingStart - target);
      if (dStart <= EDGE_SNAP_SEC && (!best || dStart < best.dist)) {
        best = { value: target, dist: dStart };
      }

      // snap END to target (adjust start)
      const dEnd = Math.abs(movingEnd - target);
      if (dEnd <= EDGE_SNAP_SEC && (!best || dEnd < best.dist)) {
        best = { value: target - movingLen, dist: dEnd };
      }
    }

    return best ? Math.max(0, best.value) : nextStart;
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
        if (d <= EDGE_SNAP_SEC && (!best || d < best.dist))
          best = { value: target - movingLen, dist: d };
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

    const targets = [];
    targets.push(Number(playheadRef.current ?? playhead) || 0);
    targets.push(snapSeconds(tt, 1));

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

  useEffect(() => {
    applyMuteVolAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted, volume]);

  useEffect(() => {
    const a = previewAudioRef.current;
    if (!a) return;
    try {
      a.muted = muted;
      a.volume = clamp(Number(volume), 0, 1);
    } catch {}
  }, [muted, volume]);

  function waitForEvent(el, evt, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!el) return reject(new Error("no media element"));
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

  /**
   * ✅ BIG AUDIO FIX:
   * - No more aggressive currentTime yanks while playing (that causes crackles).
   * - Hysteresis for removing audio elements to avoid stop/start jitter.
   * - Only hard-resync when drift is large OR when scrubbing/paused.
   */
  async function syncAllAudioToTimelineTime(t, { autoplay } = { autoplay: false }) {
    const desired = desiredAudiosAtTime(t);

    if (!desired.length) {
    for (const { el } of audioPoolRef.current.values()) {
      try { el.pause(); } catch {}
    }
    return;
  }


    const desiredKeys = new Set(desired.map((d) => d.clip.key));

    const now = performance.now();

    // mark wanted
    for (const d of desired) {
      const entry = ensureAudioElementForKey(d.clip.key);
      entry.lastWantedAt = now;
    }

    // ✅ don't instantly remove audios: pause after ~700ms not-wanted, remove after ~6s
    for (const [key, entry] of audioPoolRef.current.entries()) {
      if (desiredKeys.has(key)) continue;

      const age = now - (entry.lastWantedAt || 0);
      if (age > 700) {
        try {
          entry.el.pause();
        } catch {}
      }
      if (age > 6000) {
        unloadAndRemoveAudioKey(key);
      }
    }

    // desired audios: ensure src, gently align
    const videoEl = videoRef.current;
    const playing = !!(wantedPlayRef.current || autoplay) && videoEl && !videoEl.paused && !videoEl.ended;

    for (const d of desired) {
      const { clip, src, targetTime } = d;
      const entry = ensureAudioElementForKey(clip.key);
      const a = entry.el;

      if (entry.swapping) continue;

      const srcNorm = normalizeUrl(src);
      const curNorm = normalizeUrl(a.currentSrc || a.src || "");
      const needsSwap = entry.srcNorm !== srcNorm || (curNorm && curNorm !== srcNorm);

      if (needsSwap) {
        entry.swapping = true;
        try {
          try {
            a.pause();
          } catch {}

          entry.src = src;
          entry.srcNorm = srcNorm;

          a.src = src;
          try {
            a.load();
          } catch {}

          if (a.readyState < 1) {
            try {
              await waitForEvent(a, "loadedmetadata", 8000);
            } catch {}
          }
        } finally {
          entry.swapping = false;
        }
      }

      applyMuteVolAll();

      const cur = Number(a.currentTime || 0);
      const drift = Math.abs(cur - targetTime);

      // ✅ if scrubbing or not playing: allow tighter seek
      const scrubbing = isScrubbingRef.current || isDraggingPlayheadRef.current;

      // ✅ playing: only resync if drift is big (avoids crackles)
      const HARD_DRIFT_PLAYING = 0.45;
      const HARD_DRIFT_IDLE = 0.08;

      const RESYNC_COOLDOWN = 450;

      const shouldResync = scrubbing
        ? drift > HARD_DRIFT_IDLE
        : playing
        ? drift > HARD_DRIFT_PLAYING
        : drift > HARD_DRIFT_IDLE;

      if (shouldResync && now - (entry.lastSyncAt || 0) > RESYNC_COOLDOWN) {
        entry.lastSyncAt = now;
        try {
          if (typeof a.fastSeek === "function") a.fastSeek(targetTime);
          else a.currentTime = targetTime;
        } catch {}
      }

      // ✅ play/pause behavior
      if (autoplay || wantedPlayRef.current) {
        // only attempt play if we actually want playback
        if (a.paused) {
          const p = a.play?.();
          if (p?.catch) p.catch(() => {});
        }
        entry.everPlayed = true;
      } else {
        // if user is idle, pause (but keep element; hysteresis handles removal)
        try {
          a.pause();
        } catch {}
      }
    }
  }

  async function ensureLoadedForTimelineTime(t, { autoplay } = { autoplay: false }) {
    const v = videoRef.current;
    if (!v) return;

    const token = ++loadTokenRef.current;

    const timelineT = Math.max(0, Number(t) || 0);
    const clip = findVideoClipAtTime(timelineT);

    const media = clip ? resolveMediaForClip(clip) : null;

    if (!clip || !media) {
      if (wantedPlayRef.current || autoplay) {
        const ns = findNextVideoStart(timelineT);
        if (ns == null) {
          wantedPlayRef.current = false;
          try {
            v.pause();
          } catch {}
          setIsPlaying(false);
          loadedClipKeyRef.current = null;
          loadedSrcRef.current = "";
          return;
        }
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

    const src = streamUrl(media) || "";
    if (!src) return;

    const local = clamp(timelineT - (Number(clip.start) || 0), 0, clipLen(clip));
    const targetVideoTime = (Number(clip.in) || 0) + local;

    const needsSrcChange = loadedClipKeyRef.current !== clip.key || loadedSrcRef.current !== src;

    if (needsSrcChange) {
      isSwappingSrcRef.current = true;
      try {
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

        applyMuteVolAll();

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
      applyMuteVolAll();
      const cur = Number(v.currentTime || 0);
      // keep this tolerance modest; too tight causes jitter
      if (Math.abs(cur - targetVideoTime) > 0.05) {
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

  // ✅ unified "tick" used by RAF and requestVideoFrameCallback
  function tickPlayback() {
    if (isScrubbingRef.current) return;

    const v = videoRef.current;
    if (!v) return;

    // Only run the "live" clock when user wants playback
    if (!wantedPlayRef.current) return;

    const t = playheadRef.current ?? playhead;
    const clip = findVideoClipAtTime(t);

    if (!clip) {
      ensureLoadedForTimelineTime(t, { autoplay: true }).finally(() => forceResume("tick-gap"));
      return;
    }

    const clipIn = Number(clip.in) || 0;
    const clipOut = Number(clip.out) || 0;

    const local = clamp((v.currentTime || 0) - clipIn, 0, clipLen(clip));
    const newPlayhead = (Number(clip.start) || 0) + local;

    // update refs always
    playheadRef.current = newPlayhead;

    // ✅ UI updates throttled (but playhead ALWAYS moves, because we update state regularly)
    const now = performance.now();
    if (now - lastUiPlayheadSetRef.current > 33) {
      lastUiPlayheadSetRef.current = now;
      setPlayhead(newPlayhead);
    }

    // ✅ Throttle audio sync (and much gentler inside sync)
    if (now - lastAudioSyncCallRef.current > 90) {
      lastAudioSyncCallRef.current = now;
      syncAllAudioToTimelineTime(newPlayhead, { autoplay: true });
    }

    // End-of-clip advance
    const ct = Number(v.currentTime || 0);
    if (ct >= clipOut - 0.12 && !isAdvancingRef.current) {
      advanceToNextClip(clip);
    }
  }

  function startRafClock() {
    if (rafTickRef.current) return;

    const loop = () => {
      rafTickRef.current = requestAnimationFrame(loop);
      tickPlayback();
    };

    rafTickRef.current = requestAnimationFrame(loop);
  }

  function stopRafClock() {
    if (!rafTickRef.current) return;
    cancelAnimationFrame(rafTickRef.current);
    rafTickRef.current = 0;
  }

  // ✅ requestVideoFrameCallback clock (better “playhead moves” reliability)
  function startRvfcClock() {
    const v = videoRef.current;
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;

    if (rvfcHandleRef.current) return;

    const cb = () => {
      // keep going only if playing intent is still true
      if (!wantedPlayRef.current) {
        rvfcHandleRef.current = 0;
        return;
      }
      tickPlayback();
      rvfcHandleRef.current = v.requestVideoFrameCallback(cb);
    };

    rvfcHandleRef.current = v.requestVideoFrameCallback(cb);
  }

  function stopRvfcClock() {
    // requestVideoFrameCallback has no standard cancel; clearing handle is enough since we gate by wantedPlayRef
    rvfcHandleRef.current = 0;
  }

  function stopAllClocks() {
    stopRafClock();
    stopRvfcClock();
  }

  function forceResume(reason = "") {
    const v = videoRef.current;
    if (!v) return;
    if (!wantedPlayRef.current) return;

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

      if (v.paused || v.ended) {
        const p = v.play?.();
        if (p?.catch) p.catch(() => {});
      }

      syncAllAudioToTimelineTime(playheadRef.current ?? playhead, { autoplay: true });

      if (triesLeft <= 0) return;
      window.setTimeout(() => attempt(triesLeft - 1), 140);
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

      if (curT > start.t + 0.02) return;
      if (now - start.at < 300) return;

      forceResume(`progressKick:${label}`);

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

  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;

    if (wantedPlayRef.current) {
      wantedPlayRef.current = false;
      stopAllClocks();

      try {
        v.pause();
      } catch {}
      for (const { el } of audioPoolRef.current.values()) {
        try {
          el.pause();
        } catch {}
      }
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
      await syncAllAudioToTimelineTime(target, { autoplay: true });

      forceResume("togglePlay-gap");
      // start clocks after play intent
      startRvfcClock();
      startRafClock();
      return;
    }

    await ensureLoadedForTimelineTime(t, { autoplay: true });
    await syncAllAudioToTimelineTime(t, { autoplay: true });

    forceResume("togglePlay");

    // ✅ start clocks after play begins
    startRvfcClock();
    startRafClock();
  }

  function onSequenceScrub(value) {
    const t = Number(value) || 0;
    isScrubbingRef.current = true;

    // ✅ keep playhead state in sync immediately (so handle moves)
    setPlayhead(t);
    playheadRef.current = t;

    ensureLoadedForTimelineTime(t, { autoplay: false });
    syncAllAudioToTimelineTime(t, { autoplay: false });
  }

  function onSequenceScrubCommit(value) {
    const t = Number(value) || 0;
    isScrubbingRef.current = false;

    setPlayhead(t);
    playheadRef.current = t;

    ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
      if (wantedPlayRef.current) forceResume("scrubCommit");
    });
    syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
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
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
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
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
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
      syncAllAudioToTimelineTime(target, { autoplay: wantedPlayRef.current });
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
      syncAllAudioToTimelineTime(target, { autoplay: wantedPlayRef.current });
      if (wantedPlayRef.current) forceResume("nextClip");
    });
  }

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
      stopAllClocks();
      return;
    }

    setPlayhead(nextStart);
    playheadRef.current = nextStart;

    await ensureLoadedForTimelineTime(nextStart, { autoplay: true });
    forceResume("advanceToNextClip");
    await syncAllAudioToTimelineTime(nextStart, { autoplay: true });

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
      const playing = !v.paused && !v.ended;
      setIsPlaying(playing);

      // ✅ start/stop clocks when actual media state changes
      if (playing && wantedPlayRef.current) {
        startRvfcClock();
        startRafClock();
      }
      if (!playing) {
        // don’t kill clocks if user still intends play; forceResume will restart
        if (!wantedPlayRef.current) stopAllClocks();
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      lastProgressTimeRef.current = { t: Number(v.currentTime || 0), at: performance.now() };
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onPause = () => {
      if (!wantedPlayRef.current) return;
      if (isSwappingSrcRef.current) return;

      const t = playheadRef.current ?? playhead;
      if (atTimelineEnd(t)) {
        wantedPlayRef.current = false;
        setIsPlaying(false);
        stopAllClocks();
        return;
      }

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

  // When clips change, re-align audio/video as needed
  useEffect(() => {
    const t = playheadRef.current ?? playhead;
    if (wantedPlayRef.current) return; // ✅ don’t fight the live clock

    syncAllAudioToTimelineTime(t, { autoplay: false });

    const clip = findVideoClipAtTime(t);
    if (!clip) return;

    if (loadedClipKeyRef.current !== clip.key) {
      ensureLoadedForTimelineTime(t, { autoplay: false }).finally(() => {
        syncAllAudioToTimelineTime(t, { autoplay: false });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipsSorted.length]);

  // When viewerSrc changes, ensure element aligned
  useEffect(() => {
    if (!viewerSrc) return;
    const t = playheadRef.current ?? playhead;
    ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
      if (wantedPlayRef.current) forceResume("viewerSrcChanged");
      ensureProgressKick("viewerSrcChanged");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerSrc]);

  // -------- Playhead drag --------
  const dragPointerIdRef = useRef(null);

  function onTimelineBackgroundPointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;
    if (isDraggingPlayheadRef.current) return;
    if (tool === "trackFwd") return;

    if (e.target?.closest?.(".genEditClip")) return;
    if (e.target?.closest?.(".genEditTrimHandle")) return;
    if (e.target?.closest?.(".genEditClipX")) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;
    if (e.target?.closest?.(".genEditTimeHeader")) return;
    if (e.target?.closest?.(".genEditTimeHeaderHit")) return;

    if (e.shiftKey) return;
    clearSelection();
  }

  // ✅ playhead “handle doesn’t move” fix:
  // - Update state immediately on pointer move (already done)
  // - Add touchAction none + pointer capture + transform-based positioning in render (below)
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
    syncAllAudioToTimelineTime(t, { autoplay: false });

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
      syncAllAudioToTimelineTime(tt, { autoplay: false });
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

  function onTimeHeaderPointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;
    if (e.target?.closest?.(".genEditPlayheadHandle")) return;

    const t = getTimeFromClientX(e.clientX);

    isScrubbingRef.current = true;
    setPlayhead(t);
    playheadRef.current = t;

    ensureLoadedForTimelineTime(t, { autoplay: false }).finally(() => {
      syncAllAudioToTimelineTime(t, { autoplay: false });
      isScrubbingRef.current = false;
      if (wantedPlayRef.current) {
        ensureLoadedForTimelineTime(t, { autoplay: true }).finally(() => forceResume("timeHeaderClick"));
        syncAllAudioToTimelineTime(t, { autoplay: true }).finally(() => forceResume("timeHeaderClick"));
      }
    });
  }

  // -------- Clip add/remove --------
  async function addMediaToTimelineAt(video, start, { forceKind = null, forceTrack = null } = {}) {
    pushUndo("add clip");

    const isAudio = isAudioMedia(video);
    const kind = forceKind ?? (isAudio ? "audio" : "video");

    let track = kind === "video" ? 0 : Number(forceTrack) || 0;

    if (kind === "audio") {
      setAudioLaneCount((n) => clamp(Math.max(Number(n) || 1, track + 1), 1, 5));
      track = clamp(track, 0, 4);
    }

    const dur = await getVideoDurationSeconds(video);

    const item = makeTimelineItem({
      kind,
      track,
      video,
      start: Math.max(0, start),
      sourceDuration: dur,
    });

    setClipsSynced((t) => [...t, item]);
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

    setClipsSynced((prev) => prev.filter((c) => c && !keys.includes(c.key)));

    setSelectedClipKeys(new Set());
    setActiveClipKey(null);

    requestAnimationFrame(() => {
      const t = playheadRef.current ?? playhead;

      if (removingLoaded) {
        loadedClipKeyRef.current = null;
        loadedSrcRef.current = "";
      }

      // also drop any removed audio keys
      for (const k of keys) unloadAndRemoveAudioKey(k);

      ensureLoadedForTimelineTime(t, { autoplay: wantedPlayRef.current }).finally(() => {
        syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
        if (wantedPlayRef.current) forceResume("plainDelete");
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

        console.log("SAVE uses clipsRef:", clipsRef.current?.map(c => ({k:c.key, start:c.start, kind:c.kind, track:c.track})));

        saveProjectNow();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, isSaving]);

  // Undo/Redo hotkeys
  useEffect(() => {
    const onKeyDown = (e) => {
      const key = (e.key || "").toLowerCase();
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
      if (isTyping) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

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
        removeFromTimeline(toRemove);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeClipKey]);

  // -------- Clip drag / Razor split --------
  function splitClipAtTime(clipKey, timelineT) {
    pushUndo("razor split");
    setClipsSynced((prev) => {
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

    if (tool === "slip") {
      onSlipPointerDown(e, clipKey);
      return;
    }

    if (tool === "razor") {
      const raw = getTimeFromClientX(e.clientX);
      const tt = e.shiftKey ? snapRazorTime(raw) : raw;
      setRazorHoverT(tt);
      splitClipAtTime(clipKey, tt);
      return;
    }

    if (tool === "ripple") {
      if (e.shiftKey) toggleSelectionKey(clipKey);
      else {
        const sel = selectedClipKeysRef.current;
        if (!sel || !sel.has(clipKey)) setSingleSelection(clipKey);
        else setActiveClipKey(clipKey);
      }
      return;
    }

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

      setSelectionImmediate(keys, { additive: false });
      // continue into drag
    }

    const clip = clips.find((c) => c.key === clipKey);
    if (!clip) return;

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

    const primaryOrig =
      group.find((g) => g.key === primaryKey) || { start: dragClipStartRef.current, kind: null, track: null };
    const dxSeconds = dxPx / PPS;

    let nextPrimaryStart = Math.max(0, Number(primaryOrig.start || 0) + dxSeconds);

    if (e.shiftKey) nextPrimaryStart = Math.max(0, snapSeconds(nextPrimaryStart, 1));

    // decide what lane we’re snapping within (based on where you’re dragging)
    const lane = getLaneFromClientY(e.clientY);

    // IMPORTANT: only snap within same kind lane (video stays video, audio stays audio)
    const targetLane =
      lane && lane.kind === (dragOrigTrackRef.current?.kind ?? primaryOrig.kind)
        ? lane
        : { kind: dragOrigTrackRef.current?.kind ?? primaryOrig.kind, track: dragOrigTrackRef.current?.track ?? primaryOrig.track };

    // magnetic snap (same kind+track)
    nextPrimaryStart = snapToMagneticLane(nextPrimaryStart, primaryKey, targetLane, { includePlayhead: true });

    nextPrimaryStart = snapToEdges(nextPrimaryStart, primaryKey);

    const delta = nextPrimaryStart - (Number(primaryOrig.start) || 0);

    const orig = dragOrigTrackRef.current;
    let nextKind = orig?.kind;
    let nextTrack = orig?.track;

    //const lane = getLaneFromClientY(e.clientY);
    //if (lane && orig?.kind === lane.kind) {
     // nextKind = lane.kind;
     // nextTrack = lane.track;
     // if (nextKind === "video") nextTrack = 0;
    //}

    const groupKeySet = new Set(group.map((g) => g.key));

    setClipsSynced((prev) =>
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

    requestAnimationFrame(() => {
      const t = playheadRef.current ?? playhead;
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
    });
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

    requestAnimationFrame(() => {
      const t = playheadRef.current ?? playhead;
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
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

    setClipsSynced((prev) =>
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

    requestAnimationFrame(() => {
      const t = playheadRef.current ?? playhead;
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
    });
  }

  // -------- Trim / Ripple trim / Roll (verbatim from your paste) --------
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

    const laneStarts = new Map();
    for (const c of clips) {
      if (!c) continue;
      if (c.kind !== laneKind) continue;
      if ((Number(c.track) || 0) !== laneTrack) continue;
      laneStarts.set(c.key, Number(c.start) || 0);
    }

    const start0 = Number(clip.start) || 0;
    const end0 = start0 + clipLen(clip);

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
          const left0 = clip;
          const right0 = rightNeighbor;

          roll = {
            leftKey: left0.key,
            rightKey: right0.key,
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
      roll,
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

    setClipsSynced((prev) => {
      const primary = prev.find((c) => c.key === key);
      if (!primary) return prev;

      const laneKind = orig.kind;
      const laneTrack = Number(orig.track) || 0;

      if (isRoll && orig.roll) {
        const left = prev.find((c) => c.key === orig.roll.leftKey);
        const right = prev.find((c) => c.key === orig.roll.rightKey);
        if (!left || !right) return prev;

        const r0 = orig.roll;
        const leftStart0 = Number(left.start) || 0;
        const leftIn0 = Number(r0.leftIn0) || 0;
        const leftOut0 = Number(r0.leftOut0) || 0;
        const leftSrcDur = Number(left.sourceDuration || left?.video?.durationSeconds || 0);

        const rightStart0 = Number(r0.rightStart0) || 0;
        const rightIn0 = Number(r0.rightIn0) || 0;
        const rightOut0 = Number(r0.rightOut0) || 0;
        const rightSrcDur = Number(right.sourceDuration || right?.video?.durationSeconds || 0);

        const cut0 = Number(r0.cut0) || 0;
        const rightEnd0 = rightStart0 + Math.max(0, rightOut0 - rightIn0);

        let delta = dxSeconds;
        if (e.shiftKey) {
          const snappedCut = snapSeconds(cut0 + delta, 1);
          delta = snappedCut - cut0;
        }

        const laneEdges = getLaneEdgesSeconds(prev, {
          kind: laneKind,
          track: laneTrack,
          excludeKey: null,
        }).filter((t) => {
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

        const safeSrcDur = (d) => (Number.isFinite(d) && d > 0.01 ? d : Infinity);

        const leftSrcLimit = safeSrcDur(leftSrcDur);
        const rightSrcLimit = safeSrcDur(rightSrcDur);

        const leftMinDelta = leftIn0 + MIN_LEN - leftOut0;
        const leftMaxDelta = leftSrcLimit - leftOut0;

        const rightMinDelta = 0 - rightIn0;
        const effectiveRightOut0 = Math.min(rightOut0, rightSrcLimit);

        const rightMaxDelta2 = effectiveRightOut0 - MIN_LEN - rightIn0;
        const rightEnd0b = rightStart0 + Math.max(0, effectiveRightOut0 - rightIn0);
        const cutMaxDeltaByRightLen2 = rightEnd0b - MIN_LEN - cut0;

        const startMinDelta = -rightStart0;

        const minDelta = Math.max(leftMinDelta, rightMinDelta, startMinDelta);
        const maxDelta = Math.min(leftMaxDelta, rightMaxDelta2, cutMaxDeltaByRightLen2);

        if (!(minDelta <= maxDelta)) {
          delta = 0;
        } else {
          delta = clamp(delta, minDelta, maxDelta);
        }

        const nextLeftOut = leftOut0 + delta;
        const nextRightIn = rightIn0 + delta;
        const nextRightStart = rightStart0 + delta;

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

      const srcDur = Number(primary.sourceDuration || orig.sourceDuration || 0);
      const start0 = Number(orig.start || 0);
      const in0 = Number(orig.in || 0);
      const out0 = Number(orig.out || 0);

      const oldStart = start0;
      const oldEnd = Number(orig.end || start0 + (out0 - in0));
      const oldLen = Math.max(0, out0 - in0);

      let nextPrimary = primary;

      let delta = 0;
      let thresholdT = null;
      let affect = "none";

      if (side === "r") {
        let nextOut = out0 + dxSeconds;
        if (e.shiftKey) nextOut = snapSeconds(nextOut, 1);
        nextOut = clamp(nextOut, in0 + MIN_LEN, srcDur || nextOut);

        const laneEdges = getLaneEdgesSeconds(prev, {
          kind: laneKind,
          track: laneTrack,
          excludeKey: key,
        });

        let nextEnd = oldStart + Math.max(0, nextOut - in0);
        const snappedEnd = snapToNearest(nextEnd, laneEdges, EDGE_SNAP_SEC);

        nextEnd = snappedEnd;
        nextOut = clamp(in0 + (nextEnd - oldStart), in0 + MIN_LEN, srcDur || in0 + (nextEnd - oldStart));

        nextPrimary = { ...primary, out: nextOut };

        const newLen = Math.max(0, nextOut - in0);
        const deltaLen = newLen - oldLen;

        setTrimTip({
          x: e.clientX + 12,
          y: e.clientY + 12,
          text: formatTrimTooltip({
            side,
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
            length: newLen,
            deltaLength: deltaLen,
            isRipple,
          }),
        });

        if (isRipple) {
          delta = nextStart - oldStart;
          thresholdT = oldStart;
          affect = "left";
        } else {
          affect = "none";
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

    requestAnimationFrame(() => {
      const t = playheadRef.current ?? playhead;
      syncAllAudioToTimelineTime(t, { autoplay: wantedPlayRef.current });
    });
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
      return bestD <= 0.2 ? best : null;
    }

    if (direction === "left") {
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
  // --- END TRIM BLOCK ---

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
    const isAudio = isAudioMedia(v);
    const lane = getLaneFromClientY(e.clientY);

    if (isAudio) {
      const targetTrack = lane?.kind === "audio" ? Number(lane.track) || 0 : 0;
      await addMediaToTimelineAt(v, t, { forceKind: "audio", forceTrack: targetTrack });
    } else {
      await addMediaToTimelineAt(v, t, { forceKind: "video", forceTrack: 0 });
    }
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

  // ✅ Publish modal timeline payload (VIDEO + AUDIO)
  const publishTimeline = useMemo(() => {
    return clipsSorted.map((c) => ({
      kind: c.kind,                 // "video" | "audio"
      track: Number(c.track || 0),  // audio lane index
      videoId: c?.videoId ?? c?.video?.id ?? null,
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
  }

  function setPlayerVolume(next) {
    const x = clamp(Number(next), 0, 1);
    setVolume(x);
    if (x > 0) setMuted(false);
  }

  // Light alignment when idle
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

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const k = (e.key || "").toLowerCase();

      if (k === "v") setTool("select");
      if (k === "c") setTool("razor");
      if (k === "b") setTool("ripple");
      if (k === "y") setTool("slip");
      if (k === "n") setTool("roll");
      if (k === "a") setTool("trackFwd");
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

  const playPauseIcon = useMemo(() => {
    const v = videoRef.current;
    const actuallyPlaying = v ? !v.paused && !v.ended : isPlaying;
    return actuallyPlaying ? "⏸" : "▶";
  }, [isPlaying, viewerSrc, playhead]);

  // ✅ CSS-independent positioning: use transform for playhead visuals
  const playheadX = useMemo(() => (Number(playhead) || 0) * PPS, [playhead, PPS]);

  return (
    <div
      className={`genEditWrap ${
        tool === "razor"
          ? "toolRazor"
          : tool === "slip"
          ? "toolSlip"
          : tool === "ripple"
          ? "toolRipple"
          : tool === "roll"
          ? "toolRoll"
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
            {loadingLib ? (
              <div className="genEditEmpty">{libTab === "audio" ? "Loading your audio…" : "Loading your videos…"}</div>
            ) : libErr ? (
              <div className="genEditEmpty">{libErr}</div>
            ) : activeLibList.length === 0 ? (
              <div className="genEditEmpty">
                {libTab === "audio"
                  ? "No audio uploads yet. Upload audio, then it’ll appear here."
                  : "No video uploads yet. Upload a video, then it’ll appear here."}
              </div>
            ) : (
              <div className="genEditLibList">
                {activeLibList.map((v) => {
                  const isActive = selectedVideo?.id === v.id;
                  const isAudio = isAudioMedia(v);

                  // ✅ only compute thumbs for video
                  const src = !isAudio ? thumbUrl(v) : "";

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
                      <div className="genEditLibThumb">
                        {isAudio ? (
                          <div
                            className={`genEditAudioPh ${String(previewAudioId) === String(v.id) ? "isPreviewing" : ""}`}
                            role="button"
                            tabIndex={0}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleLibraryAudioPreview(v);
                            }}
                          >
                            {/* Default musical note */}
                            <span className="genEditAudioNote">🎵</span>

                            {/* Hover / active icon */}
                            <span className="genEditAudioOverlayIcon">
                              {String(previewAudioId) === String(v.id) ? "⏹" : "▶"}
                            </span>
                          </div>
                        ) : src ? (
                          <img src={src} alt="" />
                        ) : (
                          <div className="genEditThumbPh" />
                        )}
                      </div>

                      <div className="genEditLibMeta">
                        <div className="genEditLibName" title={v.title}>
                          {v.title}
                        </div>
                        <div className="genEditLibSub">
                          <span className="muted">Duration: </span> {durLabel}
                          {isAudio ? <span className="muted"> · Audio</span> : null}
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
                <button
                  type="button"
                  className="genEditTitleEditBtn"
                  onClick={() => setIsEditingTitle(true)}
                  title="Rename sequence"
                >
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
              <div className="genEditPlayerLabel">
                {currentVideoClip?.video?.title ? `Playing: ${currentVideoClip.video.title}` : "Playback"}
              </div>

              <div className="genEditPlayerRight">
                <span className="muted">Playhead:</span> <span>{fmtTime(playhead)}</span>
              </div>
            </div>

            <div className="genEditPlayer">
              {viewerSrc ? (
                <div className="genEditVideoWrap">
                  <div className="genEditVideoStage">
                    <video ref={videoRef} className="genEditVideo" preload="auto" playsInline src={viewerSrc} />
                    <div ref={audioHostRef} style={{ display: "none" }} />
                    <audio
                      ref={previewAudioRef}
                      preload="auto"
                      style={{ display: "none" }}
                      playsInline
                      onEnded={() => setPreviewAudioId(null)}
                    />

                    <div className="genEditOverlayControls" role="group" aria-label="Player controls">
                      <button
                        type="button"
                        className="genEditPBtn"
                        onClick={togglePlay}
                        disabled={!hasAnyClips}
                        aria-label={isPlaying ? "Pause" : "Play"}
                      >
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
                ⇥
              </button>
            </div>

            <div className="genEditZoomRight">
              <div className="genEditZoomGroup">
                <div className="genEditZoomLabel">
                  <span className="muted">Zoom</span>{" "}
                  <span style={{ fontWeight: 900 }}>{Math.round(pps)} px/s</span>
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
              </div>

              <button type="button" className="genEditZoomBtn" onClick={() => setPps(40)}>
                Reset
              </button>
            </div>
          </div>

          {/* Timeline */}
          <div className="genEditTimelineShell">
            <div className="genEditTimelineMulti">
              {/* Fixed gutter labels */}
              <div className="genEditLaneGutter" aria-hidden="true">
                <div className="genEditGutterSpacer" />

                {VIDEO_TRACKS.map((lane) => (
                  <div key={`${lane.kind}-${lane.track}`} className={`genEditGutterCell ${lane.kind}`}>
                    <div className="genEditGutterCellInner">
                      <span>{lane.label}</span>
                    </div>
                  </div>
                ))}

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
                  <div
                    ref={timelineOriginRef}
                    className="genEditTimeStack"
                    style={{ width: timelineWidth }}
                    onPointerMove={(e) => onTimelinePointerMove(e)}
                    onPointerLeave={() => onTimelinePointerLeave()}
                    onDragOver={onTimelineDragOver}
                    onDrop={onTimelineDrop}
                    role="presentation"
                  >
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

                    {tool === "razor" && razorHoverT != null ? (
                      <div className="genEditRazorLine" style={{ left: `${razorHoverT * PPS}px` }} />
                    ) : null}

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

                    {/* ✅ transform-based playhead rendering (more robust than left updates) */}
                    <div
                      className="genEditPlayheadLine"
                      style={{
                        transform: `translateX(${playheadX}px)`,
                        willChange: "transform",
                      }}
                    />

                    <div
                      className="genEditPlayheadHandle"
                      style={{
                        transform: `translateX(${playheadX}px) translateX(-50%)`, // ✅ center handle on the line
                        willChange: "transform",
                        touchAction: "none",
                      }}
                      onPointerDown={onPlayheadPointerDown}
                      role="slider"
                      aria-label="Playhead"
                      aria-valuemin={0}
                      aria-valuemax={playheadMax}
                      aria-valuenow={playhead}
                      tabIndex={0}
                    />

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
                                          {resolveMediaForClip(c)?.title || (c.kind === "audio" ? "Audio clip" : "Untitled clip")}
                                        </div>

                                        <button
                                          type="button"
                                          className="genEditClipX"
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            removeFromTimeline([c.key]);
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