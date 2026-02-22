import "./Generate.css";

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

export default function GenerateShots() {
  return (
    <SectionShell title="Shots" subtitle="Assemble a shot by picking assets, camera, and timing.">
      <div className="genGrid">
        <PlaceholderCard title="New Shot" desc="Start a shot: choose background + characters." actionLabel="Create shot" />
        <PlaceholderCard title="Shot List" desc="Your saved shots, ordered like a storyboard." actionLabel="Open shot list" />
        <PlaceholderCard title="Templates" desc="Quick setups: dialogue, chase, montage, etc." actionLabel="Browse templates" />
        <PlaceholderCard title="Preview" desc="Play the shot with blocking + camera moves." actionLabel="Open preview" />
      </div>
    </SectionShell>
  );
}