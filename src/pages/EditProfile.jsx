import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getMyProfile, updateMyProfile } from "../api.js";
import "./Profile.css";

export default function EditProfile({ user, onRequireLogin }) {
  const nav = useNavigate();

  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      // If user hasn’t restored yet (refresh), wait for user prop to resolve
      if (!user) {
        setLoading(false);
        setForm(null);
        setErr("You must be logged in to edit your profile.");
        return;
      }

      try {
        setLoading(true);
        setErr("");
        const me = await getMyProfile();
        if (!alive) return;
        setForm(me);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Failed to load profile");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [user]);

  function setField(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setErr("");

    try {
      setBusy(true);

      const updated = await updateMyProfile(form);

      // Hard refresh after successful save
      window.location.href = `/u/${updated?.profile?.username || user.username}`;

    } catch (e) {
      setErr(e?.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  }


  if (loading) return <div className="shell">Loading…</div>;

  if (!user) {
    return (
      <div className="shell">
        <div className="profileCard">
          <div className="profileSectionTitle">Edit profile</div>

          <div style={{ marginTop: 10, opacity: 0.9 }}>
            {err || "You must be logged in to edit your profile."}
          </div>

          <div className="formActions" style={{ marginTop: 14 }}>
            <button
              className="commentMiniBtn primary"
              type="button"
              onClick={() => onRequireLogin?.("/me/profile")}
            >
              Log in
            </button>
            <button className="commentMiniBtn" type="button" onClick={() => nav("/watch")}>
              Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="shell">
        <div className="profileCard">
          <div className="profileSectionTitle">Edit profile</div>
          <div style={{ marginTop: 10, opacity: 0.9 }}>
            {err || "Could not load profile."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="profileCard">
        <div className="profileSectionTitle">Edit profile</div>

        <div className="profileForm">
          <label className="field">
            <span>Display name</span>
            <input
              value={form.displayName || ""}
              onChange={(e) => setField("displayName", e.target.value)}
            />
          </label>

          <label className="field">
            <span>Bio</span>
            <textarea
              rows={4}
              value={form.bio || ""}
              onChange={(e) => setField("bio", e.target.value)}
            />
          </label>

          <label className="field">
            <span>Avatar URL</span>
            <input
              value={form.avatarUrl || ""}
              onChange={(e) => setField("avatarUrl", e.target.value)}
            />
          </label>

          <label className="field">
            <span>Banner URL</span>
            <input
              value={form.bannerUrl || ""}
              onChange={(e) => setField("bannerUrl", e.target.value)}
            />
          </label>

          <label className="field">
            <span>Location</span>
            <input
              value={form.location || ""}
              onChange={(e) => setField("location", e.target.value)}
            />
          </label>

          <label className="field">
            <span>Website</span>
            <input
              value={form.website || ""}
              onChange={(e) => setField("website", e.target.value)}
            />
          </label>

          {err && <div className="commentError">{err}</div>}

          <div className="formActions">
            <button className="commentMiniBtn" type="button" onClick={() => nav(-1)} disabled={busy}>
              Cancel
            </button>
            <button className="commentMiniBtn primary" type="button" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
