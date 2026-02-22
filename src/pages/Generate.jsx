import { NavLink, Outlet } from "react-router-dom";
import "./Generate.css";

const TABS = [
  { to: "/generate/assets", label: "Assets" },
  { to: "/generate/shots", label: "Shots" },
  { to: "/generate/projects", label: "Edit" }, // Edit = Projects page
];

export default function Generate({ user, onRequireLogin }) {
  return (
    <div className="page">
      <div className="genWrap">
        <div className="genTopRow">
          <div className="genTitleBlock">
            <div className="genTitle">Generate</div>
            <div className="genHint">Build assets → assemble shots → edit into a video.</div>
          </div>

          {/* Segmented buttons (ALWAYS visible) */}
          <div className="genTabs" role="tablist" aria-label="Generate sections">
            {TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                role="tab"
                className={({ isActive }) => `genTab ${isActive ? "active" : ""}`}
              >
                {t.label}
              </NavLink>
            ))}
          </div>
        </div>

        {/* Main panel (changes by route) */}
        <div className="genPanel">
          <Outlet context={{ user, onRequireLogin }} />
        </div>
      </div>
    </div>
  );
}