import { useEffect, useMemo, useRef, useState } from "react";
import "./GenerateEdit.css";
import { getUserVideos, whoami, streamUrl, thumbUrl } from "../api.js";
import GeneratePublishModal from "./GeneratePublishModal.jsx";

function fmtTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function fmtRulerLabel(seconds) {
  // ruler wants 0:05 style
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `0:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clipLen(c) {
  return Math.max(0, (Number(c.out) || 0) - (Number(c.in) || 0));
}

function makeTimelineItem(video, start, sourceDuration) {
  const srcDur = Number(sourceDuration ?? video.durationSeconds ?? 12);
  return {
    key: `${video.id}-${start}-${Date.now()}`,
    video,
    start, // timeline start
    sourceDuration: srcDur, // full length of source
    in: 0, // in-point within source
    out: srcDur, // out-point within source
  };
}

function snapSeconds(t, step) {
  return Math.round(t / step) * step;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(n, b));
}

export default function GenerateEdit({ user }) {
  const [libTab, setLibTab] = useState("video");

  const [me, setMe] = useState(null);
  const [libraryVideos, setLibraryVideos] = useState([]);
  const [loadingLib, setLoadingLib] = useState(false);
  const [libErr, setLibErr] = useState("");

  const [selectedVideo, setSelectedVideo] = useState(null);

  const [timeline, setTimeline] = useState([]);
  const [playhead, setPlayhead] = useState(0); // TIMELINE seconds
  const [activeClipKey, setActiveClipKey] = useState(null);

  // Sequence name (editable “Timeline” label)
  const [sequenceTitle, setSequenceTitle] = useState("Timeline");
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Export modal
  const [publishOpen, setPublishOpen] = useState(false);

  // Refs
  const timelineViewportRef = useRef(null);
  const timelineTrackRef = useRef(null);
  const titleInputRef = useRef(null);

  const videoRef = useRef(null);
  const isScrubbingRef = useRef(false);

  const isDraggingPlayheadRef = useRef(false);

  const isDraggingClipRef = useRef(false);
  const dragClipKeyRef = useRef(null);
  const dragClipStartRef = useRef(0);
  const dragStartClientXRef = useRef(0);
  const didMoveClipRef = useRef(false);

  // Trim refs
  const isTrimmingRef = useRef(false);
  const trimSideRef = useRef(null); // "l" | "r"
  const trimKeyRef = useRef(null);
  const trimStartXRef = useRef(0);
  const trimOrigRef = useRef(null); // { start, in, out, sourceDuration }

  // Drag from library -> timeline (HTML5 DnD)
  const durationCacheRef = useRef(new Map()); // videoId -> seconds

  // Constants
  const PPS = 40;
  const MIN_LEN = 0.25;

  // Snap-to-clip-edge threshold (in seconds)
  const EDGE_SNAP_SEC = 0.2;

  // ---------- helpers: duration ----------
  async function getVideoDurationSeconds(video) {
    if (!video?.id) return 12;

    // if API already provides it, trust it
    const provided = Number(video.durationSeconds);
    if (Number.isFinite(provided) && provided > 0.01) {
      durationCacheRef.current.set(video.id, provided);
      return provided;
    }

    // cache
    const cached = durationCacheRef.current.get(video.id);
    if (Number.isFinite(cached) && cached > 0.01) return cached;

    // load metadata using an offscreen video element
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

        // warm cache quickly (optional)
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

  // -------- TIMELINE METRICS --------
  const timelineSorted = useMemo(() => {
    return timeline.slice().sort((a, b) => a.start - b.start);
  }, [timeline]);

  const timelineEnd = useMemo(() => {
    if (!timelineSorted.length) return 0;
    return Math.max(...timelineSorted.map((c) => c.start + clipLen(c)));
  }, [timelineSorted]);

  const timelineWidth = Math.max(600, Math.ceil((timelineEnd + 5) * PPS));
  const playheadMax = Math.max(0, Math.ceil(timelineEnd));

  // UI-selected clip (for highlight)
  const activeClip = useMemo(() => {
    if (!activeClipKey) return null;
    return timeline.find((x) => x.key === activeClipKey) || null;
  }, [timeline, activeClipKey]);

  // Clip under playhead (drives playback)
  const currentClip = useMemo(() => {
    const t = playhead;
    return (
      timelineSorted.find((c) => t >= c.start && t < c.start + clipLen(c)) || null
    );
  }, [timelineSorted, playhead]);

  const playbackVideo = currentClip?.video || activeClip?.video || selectedVideo || null;

  const playbackSrc = useMemo(() => {
    if (!playbackVideo) return "";
    return streamUrl(playbackVideo);
  }, [playbackVideo]);

  // -------- FIND CLIP AT TIME --------
  function findClipAtTime(t) {
    return timelineSorted.find((c) => t >= c.start && t < c.start + clipLen(c)) || null;
  }

  // -------- TRACK -> TIME --------
  function getTimeFromClientX(clientX) {
    const track = timelineTrackRef.current;
    if (!track) return 0;

    const rect = track.getBoundingClientRect();
    const viewport = timelineViewportRef.current;
    const scrollLeft = viewport ? viewport.scrollLeft : 0;

    const x = clientX - rect.left + scrollLeft;
    return Math.max(0, x / PPS);
  }

  // -------- SNAP TO NEAR CLIP EDGES --------
  function snapToEdges(nextStart, movingKey) {
    // snap moving clip start/end to other clip edges if close
    const moving = timeline.find((c) => c.key === movingKey);
    if (!moving) return nextStart;

    const movingLen = clipLen(moving);
    const movingStart = nextStart;
    const movingEnd = nextStart + movingLen;

    let best = null; // { value, dist }

    for (const c of timelineSorted) {
      if (c.key === movingKey) continue;
      const s = c.start;
      const e = c.start + clipLen(c);

      // snap start to other's start/end
      for (const target of [s, e]) {
        const d = Math.abs(movingStart - target);
        if (d <= EDGE_SNAP_SEC && (!best || d < best.dist)) best = { value: target, dist: d };
      }

      // snap end to other's start/end (adjust start so end matches)
      for (const target of [s, e]) {
        const d = Math.abs(movingEnd - target);
        if (d <= EDGE_SNAP_SEC && (!best || d < best.dist)) {
          best = { value: target - movingLen, dist: d };
        }
      }
    }

    return best ? Math.max(0, best.value) : nextStart;
  }

  // -------- TIMELINE time -> VIDEO time (respecting clip.in) --------
  function seekTimelineTo(t) {
    const v = videoRef.current;
    const nextT = Math.max(0, t);
    setPlayhead(nextT);

    if (!v) return;

    const clip = findClipAtTime(nextT);
    if (!clip) {
      // keep it simple for now: if no clip, go to 0 on current src
      try {
        v.currentTime = 0;
      } catch {}
      return;
    }

    const local = clamp(nextT - clip.start, 0, clipLen(clip)); // 0..trimLen
    const videoTime = (Number(clip.in) || 0) + local;

    try {
      v.currentTime = videoTime;
    } catch {}
  }

  // When src changes, seek to correct local time once metadata is available
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onLoaded = () => {
      if (!currentClip) return;
      const local = clamp(playhead - currentClip.start, 0, clipLen(currentClip));
      const videoTime = (Number(currentClip.in) || 0) + local;
      try {
        v.currentTime = videoTime;
      } catch {}
    };

    v.addEventListener("loadedmetadata", onLoaded);
    return () => v.removeEventListener("loadedmetadata", onLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackSrc]);

  // Advance to next clip when current one ends (or reaches trim out)
  function advanceToNextClip() {
    if (!currentClip) return;

    const endT = currentClip.start + clipLen(currentClip);
    // move a tiny epsilon forward so we fall into the next clip if it starts exactly at endT
    const nextT = endT + 0.0001;

    const nextClip = findClipAtTime(nextT);
    if (!nextClip) return;

    isScrubbingRef.current = true;
    seekTimelineTo(nextT);
    isScrubbingRef.current = false;

    // try keep playing
    const v = videoRef.current;
    if (v) {
      v.play?.().catch(() => {});
    }
  }

  // VIDEO time -> TIMELINE time (respecting clip.in/out), plus auto-advance
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      if (isScrubbingRef.current) return;
      if (!currentClip) return;

      const clipIn = Number(currentClip.in) || 0;
      const clipOut = Number(currentClip.out) || 0;

      const local = clamp((v.currentTime || 0) - clipIn, 0, clipLen(currentClip));
      setPlayhead(currentClip.start + local);

      // If we're at/after trimmed out, advance
      if ((v.currentTime || 0) >= clipOut - 0.03) {
        advanceToNextClip();
      }
    };

    const onSeeked = () => {
      if (isScrubbingRef.current) return;
      if (!currentClip) return;

      const local = clamp(
        (v.currentTime || 0) - (Number(currentClip.in) || 0),
        0,
        clipLen(currentClip)
      );

      setPlayhead(currentClip.start + local);
    };

    const onEnded = () => {
      // Sometimes fires when source ends (not when trim ends). Still useful.
      advanceToNextClip();
    };

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("ended", onEnded);

    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("ended", onEnded);
    };
  }, [currentClip?.key, playbackSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------- PLAYHEAD HANDLE DRAG --------
  function onTimelinePointerDown(e) {
    if (isDraggingClipRef.current) return;
    if (isTrimmingRef.current) return;

    const targetEl = e.target;
    if (targetEl?.closest?.(".genEditClip")) return;
    if (targetEl?.closest?.(".genEditPlayheadHandle")) return;

    isScrubbingRef.current = true;
    seekTimelineTo(getTimeFromClientX(e.clientX));
    isScrubbingRef.current = false;
  }

  function onPlayheadPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    isDraggingPlayheadRef.current = true;
    isScrubbingRef.current = true;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    seekTimelineTo(getTimeFromClientX(e.clientX));
  }

  function onPlayheadPointerMove(e) {
    if (!isDraggingPlayheadRef.current) return;
    e.preventDefault();
    seekTimelineTo(getTimeFromClientX(e.clientX));
  }

  function onPlayheadPointerUp(e) {
    if (!isDraggingPlayheadRef.current) return;

    isDraggingPlayheadRef.current = false;
    isScrubbingRef.current = false;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  // -------- CLIP ADD (used by drop) / REMOVE --------
  async function addToTimelineAt(video, start) {
    const dur = await getVideoDurationSeconds(video);
    const item = makeTimelineItem(video, Math.max(0, start), dur);

    setTimeline((t) => [...t, item]);
    setActiveClipKey(item.key);

    requestAnimationFrame(() => {
      const el = timelineViewportRef.current;
      if (el) el.scrollLeft = el.scrollWidth;
    });
  }

  function removeFromTimeline(key) {
    setTimeline((t) => t.filter((x) => x.key !== key));
    if (activeClipKey === key) setActiveClipKey(null);
  }

  // -------- CLIP DRAG (Shift snap = 1s, plus edge snap) --------
  function onClipPointerDown(e, clipKey) {
    if (isTrimmingRef.current) return;

    e.preventDefault();
    e.stopPropagation();

    const t = e.target;
    if (t?.closest?.(".genEditClipX")) return;
    if (t?.closest?.(".genEditTrimHandle")) return;

    const clip = timeline.find((c) => c.key === clipKey);
    if (!clip) return;

    isDraggingClipRef.current = true;
    dragClipKeyRef.current = clipKey;
    dragClipStartRef.current = clip.start;
    dragStartClientXRef.current = e.clientX;
    didMoveClipRef.current = false;

    

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    setActiveClipKey(clipKey);
  }

  function onClipPointerMove(e) {
    if (!isDraggingClipRef.current) return;
    if (isDraggingPlayheadRef.current) return;

    const key = dragClipKeyRef.current;
    if (!key) return;

    const dxPx = e.clientX - dragStartClientXRef.current;
    if (!didMoveClipRef.current && Math.abs(dxPx) < 3) return;

    didMoveClipRef.current = true;

    const dxSeconds = dxPx / PPS;
    let nextStart = Math.max(0, dragClipStartRef.current + dxSeconds);

    // shift = snap to 1 second grid
    if (e.shiftKey) nextStart = Math.max(0, snapSeconds(nextStart, 1));

    // edge snap (only when not shift snapping hard — you can keep it on either way, but this feels nicer)
    nextStart = snapToEdges(nextStart, key);

    setTimeline((prev) =>
      prev.map((c) => (c.key === key ? { ...c, start: nextStart } : c))
    );
  }

  function onClipPointerUp(e) {
    if (!isDraggingClipRef.current) return;

    isDraggingClipRef.current = false;
    dragClipKeyRef.current = null;
    dragClipStartRef.current = 0;
    dragStartClientXRef.current = 0;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  }

  // -------- TRIM (Shift snap = 1s) --------
  function onTrimPointerDown(e, clipKey, side) {
    e.preventDefault();
    e.stopPropagation();

    const clip = timeline.find((c) => c.key === clipKey);
    if (!clip) return;

    isTrimmingRef.current = true;
    trimSideRef.current = side; // "l" or "r"
    trimKeyRef.current = clipKey;
    trimStartXRef.current = e.clientX;
    trimOrigRef.current = {
      start: clip.start,
      in: clip.in,
      out: clip.out,
      sourceDuration: clip.sourceDuration,
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

    setTimeline((prev) =>
      prev.map((c) => {
        if (c.key !== key) return c;

        const srcDur = Number(c.sourceDuration || orig.sourceDuration || 0);
        const in0 = Number(orig.in || 0);
        const out0 = Number(orig.out || 0);
        const start0 = Number(orig.start || 0);

        if (side === "r") {
          // Right trim: change OUT, keep START/IN
          let nextOut = out0 + dxSeconds;
          if (e.shiftKey) nextOut = snapSeconds(nextOut, 1);
          nextOut = clamp(nextOut, in0 + MIN_LEN, srcDur);
          return { ...c, out: nextOut };
        }

        // Left trim: move START and IN together by delta, OUT stays
        let delta = dxSeconds;

        // start cannot go below 0
        delta = Math.max(delta, -start0);

        // in cannot go below 0
        delta = Math.max(delta, -in0);

        // maintain min length
        delta = Math.min(delta, (out0 - MIN_LEN) - in0);

        let nextStart = start0 + delta;
        let nextIn = in0 + delta;

        if (e.shiftKey) {
          const snappedStart = snapSeconds(nextStart, 1);
          const snapDelta = snappedStart - start0;

          let d = snapDelta;
          d = Math.max(d, -start0);
          d = Math.max(d, -in0);
          d = Math.min(d, (out0 - MIN_LEN) - in0);

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

  // -------- Library drag start --------
  function onLibDragStart(e, v) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/json", JSON.stringify({ videoId: v.id }));
    // Optional: show nice ghost image by using the thumbnail node
  }

  function onTimelineDragOver(e) {
    // allow drop
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
    await addToTimelineAt(v, t);
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

  
    const exportClips = useMemo(() => {
    return timelineSorted.map((c) => ({
        videoId: c.video.id,
        start: c.start,
        in: c.in,
        out: c.out,
    }));
    }, [timelineSorted]);


  // -------- RULER TICKS --------
  const rulerTicks = useMemo(() => {
    const end = Math.max(10, Math.ceil(timelineEnd + 1));
    const ticks = [];
    for (let t = 0; t <= end; t += 1) {
      const major = t % 5 === 0;
      ticks.push({ t, major });
    }
    return ticks;
  }, [timelineEnd]);

  // -------- Export publish stub --------
  async function onPublish(meta) {
    // This is where you’ll POST to your server so it can run ffmpeg.
    const payload = {
      sequenceTitle,
      ...meta,
      timeline: timelineSorted.map((c) => ({
        videoId: c.video.id,
        start: c.start,
        in: c.in,
        out: c.out,
      })),
    };

    console.log("PUBLISH payload (stub):", payload);

    // TODO: implement API call:
    // await publishGenerated(payload)
    // then navigate to the new video page.

    alert("Publish stub: check console for payload.");
    setPublishOpen(false);
  }

  

  return (
    <div className="genEditWrap">
      <GeneratePublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        timelineName={sequenceTitle}
        defaultTitle={sequenceTitle}
        timeline={timelineSorted.map((c) => ({
            videoId: c.video?.id,
            start: c.start,
            in: c.in,
            out: c.out,
        }))}
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
              <div className="genEditEmpty">
                No uploads yet. Upload a video, then it’ll appear here.
              </div>
            ) : (
              <div className="genEditLibList">
                {libraryVideos.map((v) => {
                  const isActive = selectedVideo?.id === v.id;
                  const src = thumbUrl(v);
                  const dur = Number(v.durationSeconds);
                  const durLabel = Number.isFinite(dur) && dur > 0 ? fmtTime(dur) : "—";

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
                        {src ? <img src={src} alt="" /> : <div className="genEditThumbPh" />}
                      </div>

                      <div className="genEditLibMeta">
                        <div className="genEditLibName" title={v.title}>
                          {v.title}
                        </div>
                        <div className="genEditLibSub">
                          <span className="muted">dur:</span> {durLabel}
                        </div>
                      </div>

                      {/* no button anymore */}
                      <div className="genEditLibActions">
                        <div className="muted" style={{ fontSize: 11, fontWeight: 800 }}>
                          drag →
                        </div>
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
          <div className="genEditPlayerShell">
            <div className="genEditPlayerTop">
              <div className="genEditPlayerLabel">
                {currentClip?.video?.title
                  ? `Playing: ${currentClip.video.title}`
                  : playbackVideo?.title
                  ? `Preview: ${playbackVideo.title}`
                  : "Playback"}
              </div>

              <div className="genEditPlayerRight">
                <span className="muted">Playhead:</span> <span>{fmtTime(playhead)}</span>
              </div>
            </div>

            <div className="genEditPlayer">
              {playbackSrc ? (
                <video
                  ref={videoRef}
                  key={playbackSrc}
                  className="genEditVideo"
                  controls
                  preload="metadata"
                  src={playbackSrc}
                />
              ) : (
                <div className="genEditPlayerEmpty">&lt;Playback&gt;</div>
              )}
            </div>
          </div>

          <div className="genEditTimelineShell">
            <div className="genEditTimelineTop">
              <div
                className="genEditTimelineTitle"
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
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
              </div>

              <div className="genEditTimelineControls">
                <button type="button" className="genEditBtn primary" onClick={() => setPublishOpen(true)}>
                Export
                </button>
              </div>
            </div>

            <div className="genEditTimelineViewport" ref={timelineViewportRef}>
              <div
                className="genEditTimelineRuler"
                style={{ width: timelineWidth }}
                aria-hidden="true"
              >
                {rulerTicks.map(({ t, major }) => {
                  const x = t * PPS;
                  return (
                    <div
                      key={t}
                      className={`genEditRulerTick ${major ? "major" : ""}`}
                      style={{ left: `${x}px` }}
                    >
                      {major ? <div className="genEditRulerLabel">{fmtRulerLabel(t)}</div> : null}
                    </div>
                  );
                })}
              </div>

              <div
                ref={timelineTrackRef}
                className="genEditTimelineTrack"
                style={{ width: timelineWidth }}
                onPointerDown={onTimelinePointerDown}
                onDragOver={onTimelineDragOver}
                onDrop={onTimelineDrop}
                role="presentation"
              >
                {/* Playhead line */}
                <div className="genEditPlayheadLine" style={{ left: `${playhead * PPS}px` }} />

                {/* Playhead handle */}
                <div
                  className="genEditPlayheadHandle"
                  style={{ left: `${playhead * PPS}px` }}
                  onPointerDown={onPlayheadPointerDown}
                  onPointerMove={onPlayheadPointerMove}
                  onPointerUp={onPlayheadPointerUp}
                  onPointerCancel={onPlayheadPointerUp}
                  role="slider"
                  aria-label="Playhead"
                  aria-valuemin={0}
                  aria-valuemax={playheadMax}
                  aria-valuenow={playhead}
                  tabIndex={0}
                />

                {timeline.map((c) => {
                  const left = c.start * PPS;
                  const width = Math.max(140, clipLen(c) * PPS);
                  const isActive = c.key === activeClipKey;

                  return (
                    <div
                      key={c.key}
                      className={`genEditClip ${isActive ? "active" : ""}`}
                      style={{ left: `${left}px`, width: `${width}px` }}
                      onPointerDown={(e) => onClipPointerDown(e, c.key)}
                      onPointerMove={onClipPointerMove}
                      onPointerUp={onClipPointerUp}
                      onPointerCancel={onClipPointerUp}
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={() => setActiveClipKey(c.key)}
                      role="button"
                      tabIndex={0}
                    >
                      {/* Left trim handle */}
                      <div
                        className="genEditTrimHandle left"
                        onPointerDown={(e) => onTrimPointerDown(e, c.key, "l")}
                        onPointerMove={onTrimPointerMove}
                        onPointerUp={onTrimPointerUp}
                        onPointerCancel={onTrimPointerUp}
                      />

                      {/* Right trim handle */}
                      <div
                        className="genEditTrimHandle right"
                        onPointerDown={(e) => onTrimPointerDown(e, c.key, "r")}
                        onPointerMove={onTrimPointerMove}
                        onPointerUp={onTrimPointerUp}
                        onPointerCancel={onTrimPointerUp}
                      />

                      <div className="genEditClipTop">
                        <div className="genEditClipTitle" title={c.video.title}>
                          {c.video.title}
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

                      <div className="genEditClipSub">
                        <span className="muted">Start</span> {fmtTime(c.start)}
                        <span className="dot">•</span>
                        <span className="muted">Len</span> {fmtTime(clipLen(c))}
                        <span className="dot">•</span>
                        <span className="muted">In</span> {fmtTime(c.in)}
                        <span className="dot">•</span>
                        <span className="muted">Out</span> {fmtTime(c.out)}
                      </div>
                    </div>
                  );
                })}

                {!timeline.length && (
                  <div className="genEditTimelineEmpty">
                    Drag clips from your library onto the timeline.
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
