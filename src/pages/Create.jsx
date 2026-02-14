import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadVideo } from "../api.js";
import "./Create.css";

export default function Create({ user, onRequireLogin }) {
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const canSubmit = title.trim() && file && !busy;

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (!user) return onRequireLogin?.("/create");
    if (!file) return setErr("Please choose an .mp4 file.");

    try {
      setBusy(true);
      const resp = await uploadVideo({
        title: title.trim(),
        description: description.trim(),
        tags,
        visibility,
        file,
      });

      // go to watch page
      nav(`/watch/${resp.video.id}`);
    } catch (e) {
      setErr(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="createCard">
        <div className="createTitle">Upload video</div>

        <form className="createForm" onSubmit={handleSubmit}>
          <label className="createLabel">
            Title
            <input
              className="createInput"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give it a title…"
              maxLength={120}
            />
          </label>

          <label className="createLabel">
            Description
            <textarea
              className="createTextarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this video about?"
              rows={5}
              maxLength={5000}
            />
          </label>

          <div className="createRow">
            <label className="createLabel" style={{ flex: 1 }}>
              Tags (comma separated)
              <input
                className="createInput"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comedy, ted, episode 1"
              />
            </label>

            <label className="createLabel" style={{ width: 220 }}>
              Visibility
              <select
                className="createSelect"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
          </div>

          <label className="createLabel">
            Video file (.mp4)
            <input
              className="createFile"
              type="file"
              accept="video/mp4"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            {file ? (
              <div className="createHint">
                Selected: <span style={{ opacity: 0.9 }}>{file.name}</span>
              </div>
            ) : (
              <div className="createHint">Choose an MP4 file to upload.</div>
            )}
          </label>

          {err ? <div className="createError">{err}</div> : null}

          <div className="createActions">
            {!user ? (
              <button
                type="button"
                className="createBtn"
                onClick={() => onRequireLogin?.("/create")}
              >
                Log in to upload
              </button>
            ) : (
              <button type="submit" className="createBtn primary" disabled={!canSubmit}>
                {busy ? "Uploading…" : "Upload"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
