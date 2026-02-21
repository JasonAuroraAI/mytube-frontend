import { useMemo, useState } from "react";
import "./Generate.css";
import GenerateEdit from "./GenerateEdit.jsx";


const TABS = [
  { key: "assets", label: "Assets" },
  { key: "shots", label: "Shots" },
  { key: "edit", label: "Edit" },
];

function SectionShell({ title, subtitle, children }) {
  return (
    <div className="genSection">
      <div className="genSectionHead">
        <div className="genSectionTitle">{title}</div>
        {subtitle ? <div className="genSectionSub">{subtitle}</div> : null}
      </div>

      <div className="genSectionBody">{children}</div>
    </div>
  );
}

function PlaceholderCard({ title, desc, actionLabel = "Open", disabled = true }) {
  return (
    <div className="genCard">
      <div className="genCardTitle">{title}</div>
      <div className="genCardDesc">{desc}</div>
      <button className="genCardBtn" disabled={disabled} type="button">
        {actionLabel}
      </button>
    </div>
  );
}


export default function Generate({ user, onRequireLogin }) {
  const [tab, setTab] = useState("assets");

  const active = useMemo(() => TABS.find((t) => t.key === tab), [tab]);

  return (
    <div className="page">
      <div className="genWrap">
        <div className="genTopRow">
          <div className="genTitleBlock">
            <div className="genTitle">Generate</div>
            <div className="genHint">
              Build assets → assemble shots → edit into a video.
            </div>
          </div>

          {/* Segmented buttons */}
          <div className="genTabs" role="tablist" aria-label="Generate sections">
            {TABS.map((t) => {
              const isActive = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`genTab ${isActive ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Main panel */}
        <div className="genPanel">
          {active?.key === "assets" && (
            <SectionShell
              title="Assets"
              subtitle="Generate characters, props, and backgrounds you can reuse in shots."
            >
              <div className="genGrid">
                <PlaceholderCard
                  title="Characters"
                  desc="Create a cast. Pick style, wardrobe, and variations."
                  actionLabel="Create character"
                />
                <PlaceholderCard
                  title="Backgrounds"
                  desc="Generate environments: streets, rooms, skies, etc."
                  actionLabel="Create background"
                />
                <PlaceholderCard
                  title="Props"
                  desc="Objects used in scenes: phones, cars, weapons, etc."
                  actionLabel="Create prop"
                />
                <PlaceholderCard
                  title="Library"
                  desc="Browse and manage generated assets."
                  actionLabel="Open library"
                />
              </div>
            </SectionShell>
          )}

          {active?.key === "shots" && (
            <SectionShell
              title="Shots"
              subtitle="Assemble a shot by picking assets, camera, and timing."
            >
              <div className="genGrid">
                <PlaceholderCard
                  title="New Shot"
                  desc="Start a shot: choose background + characters."
                  actionLabel="Create shot"
                />
                <PlaceholderCard
                  title="Shot List"
                  desc="Your saved shots, ordered like a storyboard."
                  actionLabel="Open shot list"
                />
                <PlaceholderCard
                  title="Templates"
                  desc="Quick setups: dialogue, chase, montage, etc."
                  actionLabel="Browse templates"
                />
                <PlaceholderCard
                  title="Preview"
                  desc="Play the shot with blocking + camera moves."
                  actionLabel="Open preview"
                />
              </div>
            </SectionShell>
          )}

          {active?.key === "edit" && <GenerateEdit user={user} />}

        </div>
      </div>
    </div>
  );
}
