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

export default function GenerateAssets() {
  return (
    <SectionShell
      title="Assets"
      subtitle="Generate characters, props, and backgrounds you can reuse in shots."
    >
      <div className="genGrid">
        <PlaceholderCard title="Characters" desc="Create a cast. Pick style, wardrobe, and variations." actionLabel="Create character" />
        <PlaceholderCard title="Backgrounds" desc="Generate environments: streets, rooms, skies, etc." actionLabel="Create background" />
        <PlaceholderCard title="Props" desc="Objects used in scenes: phones, cars, weapons, etc." actionLabel="Create prop" />
        <PlaceholderCard title="Library" desc="Browse and manage generated assets." actionLabel="Open library" />
      </div>
    </SectionShell>
  );
}