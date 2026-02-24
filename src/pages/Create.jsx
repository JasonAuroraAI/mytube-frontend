import { useMemo, useState } from "react";
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

  const [mediaType, setMediaType] = useState("video"); // "video" | "audio"
  const [assetScope, setAssetScope] = useState("public"); // "public" | "library"

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const accept = mediaType === "audio" ? "audio/*" : "video/*";
  const isLibrary = assetScope === "library";
  const finalVisibility = isLibrary ? "private" : visibility;

  const fileLabel = mediaType === "audio" ? "Audio file" : "Video file";
  const titleText = mediaType === "audio" ? "Upload audio" : "Upload media";

  const canSubmit = useMemo(() => {
    return Boolean(user && title.trim() && file && !busy);
  }, [user, title, file, busy]);

  function validateFile(f) {
    if (!f) return "Please choose a file.";

    // Browser-provided mimetype is usually reliable for common formats.
    const t = String(f.type || "");
    if (mediaType === "audio") {
      if (!t.startsWith("audio/")) return "Please choose an audio file.";
    } else {
      if (!t.startsWith("video/")) return "Please choose a video file.";
    }
    return "";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");

    if (!user) return onRequireLogin?.("/create");

    const fileErr = validateFile(file);
    if (fileErr) return setErr(fileErr);

    try {
      setBusy(true);

      const resp = await uploadVideo({
        title: title.trim(),
        description: description.trim(),
        tags, // keep as comma string; server can parse
        visibility: finalVisibility,

        // New metadata (server should store these)
        mediaType,
        assetScope,

        // File
        file,
      });

      const id = resp?.video?.id;

      // Public uploads go to watch. Library uploads send you back to editor flow.
      if (isLibrary) {
        nav("/generate/projects");
      } else if (id != null) {
        nav(`/watch/${id}`);
      } else {
        // Fallback if API doesn't return id
        nav("/");
      }
    } catch (e2) {
      setErr(e2?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <div className="createCard">
        <div className="createHead">
          <div className="createTitle">{titleText}</div>
          <div className="createSub">
            {isLibrary
              ? "Library assets only appear in GenerateEdit → Assets (Video/Audio)."
              : "Public assets appear on watch pages and feeds based on visibility."}
          </div>
        </div>

        <form className="createForm" onSubmit={handleSubmit}>
          <div className="createGrid">
            <label className="createLabel createSpan2">
              Title
              <input
                className="createInput"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give it a title…"
                maxLength={120}
                autoComplete="off"
              />
            </label>

            <label className="createLabel createSpan2">
              Description
              <textarea
                className="createTextarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={mediaType === "audio" ? "What is this audio about?" : "What is this video about?"}
                rows={5}
                maxLength={5000}
              />
            </label>

            <div className="createField">
              <div className="createLabelText">Media Type</div>
              <div className="createPills" role="radiogroup" aria-label="Media Type">
                <button
                  type="button"
                  className={`createPill ${mediaType === "video" ? "isActive" : ""}`}
                  onClick={() => setMediaType("video")}
                  disabled={busy}
                >
                  Video
                </button>
                <button
                  type="button"
                  className={`createPill ${mediaType === "audio" ? "isActive" : ""}`}
                  onClick={() => setMediaType("audio")}
                  disabled={busy}
                >
                  Audio
                </button>
              </div>
              <div className="createHint">
                {mediaType === "audio" ? "Audio goes to the Audio tab in GenerateEdit." : "Video goes to the Video tab in GenerateEdit."}
              </div>
            </div>

            <div className="createField">
              <div className="createLabelText">Asset Scope</div>
              <div className="createPills" role="radiogroup" aria-label="Asset Scope">
                <button
                  type="button"
                  className={`createPill ${assetScope === "public" ? "isActive" : ""}`}
                  onClick={() => setAssetScope("public")}
                  disabled={busy}
                >
                  Public
                </button>
                <button
                  type="button"
                  className={`createPill ${assetScope === "library" ? "isActive" : ""}`}
                  onClick={() => setAssetScope("library")}
                  disabled={busy}
                >
                  Library
                </button>
              </div>
              <div className="createHint">
                {isLibrary ? "Visibility is forced to Private for library assets." : "Public assets respect your visibility setting."}
              </div>
            </div>

            <label className="createLabel createSpan1">
              Tags (comma separated)
              <input
                className="createInput"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comedy, ted, episode 1"
                autoComplete="off"
              />
            </label>

            <label className="createLabel createSpan1">
              Visibility
              <select
                className="createSelect"
                value={finalVisibility}
                onChange={(e) => setVisibility(e.target.value)}
                disabled={isLibrary || busy}
                title={isLibrary ? "Library assets are always private" : ""}
              >
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
              {isLibrary ? (
                <div className="createHint">Forced: Private</div>
              ) : (
                <div className="createHint">Choose who can see it.</div>
              )}
            </label>

            <label className="createLabel createSpan2">
              {fileLabel}
              <input
                className="createFile"
                type="file"
                accept={accept}
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setFile(f);
                  if (err) setErr(""); // clear stale errors when user changes file
                }}
                disabled={busy}
              />
              {file ? (
                <div className="createHint">
                  Selected: <span className="createFileName">{file.name}</span>
                </div>
              ) : (
                <div className="createHint">
                  {mediaType === "audio"
                    ? "Choose an audio file (mp3, wav, m4a, etc.)."
                    : "Choose a video file (mp4, mov, webm, etc.)."}
                </div>
              )}
            </label>
          </div>

          {err ? <div className="createError">{err}</div> : null}

          <div className="createActions">
            {!user ? (
              <button type="button" className="createBtn" onClick={() => onRequireLogin?.("/create")}>
                Log in to upload
              </button>
            ) : (
              <button type="submit" className="createBtn primary" disabled={!canSubmit}>
                {busy ? "Uploading…" : isLibrary ? "Upload to Library" : "Upload"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}