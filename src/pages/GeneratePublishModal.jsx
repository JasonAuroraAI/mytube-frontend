// GeneratePublishModal.jsx
import { useEffect, useMemo, useState } from "react";
import "./GeneratePublishModal.css";
import { publishGeneratedVideo } from "../api.js";

export default function GeneratePublishModal({
  open,
  onClose,
  timelineName = "Timeline",
  defaultTitle = "",
  timeline = [],
  onPublished,
}) {
  const [title, setTitle] = useState(defaultTitle || "");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("other");
  const [visibility, setVisibility] = useState("public");

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const canPublish = useMemo(() => {
    const t = String(title || "").trim();
    return !!t && Array.isArray(timeline) && timeline.length > 0 && !submitting;
  }, [title, timeline, submitting]);

  useEffect(() => {
    if (!open) return;
    setErr("");
    setSubmitting(false);
    setTitle((defaultTitle || "").trim() || "Untitled edit");
    setDescription("");
    setTags("other");
    setVisibility("public");
  }, [open, defaultTitle]);

  if (!open) return null;

  async function submit() {
    setErr("");

    if (!timeline?.length) {
      setErr("Your timeline is empty.");
      return;
    }

    const payload = {
      title: String(title || "").trim(),
      description: String(description || "").trim(),
      tags: String(tags || ""),
      visibility: String(visibility || "public"),
      timelineName: String(timelineName || "Timeline"),
      timeline: timeline.map((c) => ({
        videoId: c.videoId ?? c.video?.id,
        start: Number(c.start || 0),
        in: Number(c.in || 0),
        out: Number(c.out || 0),
      })),
    };

    try {
      setSubmitting(true);
      const result = await publishGeneratedVideo(payload);
      onPublished?.(result);
      onClose?.();
    } catch (e) {
      setErr(e?.message || "Publish failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="gpOverlay" role="dialog" aria-modal="true">
      <div className="gpModal">
        <div className="gpTop">
          <div>
            <div className="gpTitle">Publish</div>
            <div className="gpSub">Timeline: {timelineName}</div>
          </div>

          <button className="gpClose" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="gpBody">
          <label className="gpLabel">Title</label>
          <input className="gpInput" value={title} onChange={(e) => setTitle(e.target.value)} />

          <label className="gpLabel">Description</label>
          <textarea
            className="gpTextarea"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="gpRow">
            <div className="gpCol">
              <label className="gpLabel">Tags (comma separated)</label>
              <input className="gpInput" value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>

            <div className="gpCol">
              <label className="gpLabel">Visibility</label>
              <select
                className="gpSelect"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          {err ? <div className="gpError">{err}</div> : null}
        </div>

        <div className="gpBottom">
          <button className="gpBtn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="gpBtn primary" onClick={submit} disabled={!canPublish}>
            {submitting ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </div>
  );
}
