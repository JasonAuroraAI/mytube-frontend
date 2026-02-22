import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./GenerateDashboard.css";

const LS_KEY = "mytube_generate_projects_v1";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function loadProjects() {
  const raw = localStorage.getItem(LS_KEY);
  const arr = safeParse(raw, []);
  return Array.isArray(arr) ? arr : [];
}

function saveProjects(projects) {
  localStorage.setItem(LS_KEY, JSON.stringify(projects));
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

// ✅ migrate older single-project saves: localStorage["genproj:<id>"]
function migrateFromGenprojKeysIfNeeded(existingList) {
  if (existingList.length > 0) return existingList;

  const migrated = [];

  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith("genproj:")) continue;

    const raw = localStorage.getItem(k);
    const p = safeParse(raw, null);
    if (!p || !p.id) continue;

    const name = String(p.name || p.sequenceTitle || "Untitled").trim() || "Untitled";
    const updatedAt = p.updatedAt
      ? (typeof p.updatedAt === "number" ? new Date(p.updatedAt).toISOString() : String(p.updatedAt))
      : nowIso();

    migrated.push({
      id: String(p.id),
      name,
      createdAt: p.createdAt || updatedAt,
      updatedAt,
      sequenceTitle: p.sequenceTitle || name,
      timeline: Array.isArray(p.timeline) ? p.timeline : [],
      playhead: Number.isFinite(Number(p.playhead)) ? Number(p.playhead) : 0,
    });
  }

  if (migrated.length) {
    migrated.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    saveProjects(migrated);
    return migrated;
  }

  return [];
}

export default function GenerateDashboard() {
  const nav = useNavigate();
  const [projects, setProjects] = useState([]);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("New Project");

  useEffect(() => {
    const loaded = loadProjects();
    const repaired = migrateFromGenprojKeysIfNeeded(loaded);
    setProjects(repaired.length ? repaired : loaded);
  }, []);

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }, [projects]);

  function persist(next) {
    setProjects(next);
    saveProjects(next);
  }

  function createProject() {
    const name = String(newName || "").trim() || "Untitled";
    const p = {
      id: newId(),
      name,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      sequenceTitle: name,
      timeline: [],
      playhead: 0,
    };

    const next = [p, ...projects];
    persist(next);
    setCreating(false);

    nav(`/generate/edit/${encodeURIComponent(p.id)}`);
  }

  function openProject(id) {
    nav(`/generate/edit/${encodeURIComponent(id)}`);
  }

  function deleteProject(id) {
    if (!confirm("Delete this project? This cannot be undone.")) return;

    // also delete older per-project key if it exists
    try {
      localStorage.removeItem(`genproj:${id}`);
    } catch {}

    const next = projects.filter((p) => p.id !== id);
    persist(next);
  }

  return (
    <div className="genDashPage">
      <div className="genDashTop">
        <div>
          <div className="genDashTitle">Projects</div>
          <div className="genDashSub">Create, open, and manage your edits.</div>
        </div>

        <button className="genDashBtn primary" onClick={() => setCreating(true)}>
          New project
        </button>
      </div>

      {creating ? (
        <div className="genDashCard">
          <div className="genDashCardTitle">Create new project</div>
          <div className="genDashRow">
            <input
              className="genDashInput"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") createProject();
                if (e.key === "Escape") setCreating(false);
              }}
            />
            <button className="genDashBtn" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="genDashBtn primary" onClick={createProject}>
              Create
            </button>
          </div>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <div className="genDashEmpty">
          <div className="genDashEmptyTitle">No projects yet</div>
          <div className="genDashEmptySub">Hit “New project” to start editing.</div>
        </div>
      ) : (
        <div className="genDashGrid">
          {sorted.map((p) => {
            const displayName = String(p.name || p.sequenceTitle || "Untitled").trim() || "Untitled";
            const clipCount = Array.isArray(p.timeline) ? p.timeline.length : 0;

            return (
              <div key={p.id} className="genDashProjectCard">
                <div
                  className="genDashProjectMain"
                  onClick={() => openProject(p.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="genDashProjectName" title={displayName}>
                    {displayName}
                  </div>
                  <div className="genDashProjectMeta">
                    <span className="muted">Updated</span>{" "}
                    {p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "—"}
                  </div>
                </div>

                <div className="genDashProjectActions">
                  <button className="genDashBtn" onClick={() => openProject(p.id)}>
                    Open
                  </button>
                  <button className="genDashBtn danger" onClick={() => deleteProject(p.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}