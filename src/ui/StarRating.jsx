import { useState } from "react";
import "./StarRating.css";

export default function StarRating({
  value = null,
  avg = null,
  count = 0,
  disabled = false,
  onRate,
}) {
  const [hover, setHover] = useState(0);
  const stars = [1, 2, 3, 4, 5];

  const displayAvg =
    avg == null
      ? "—"
      : Number.isFinite(Number(avg))
      ? Number(avg).toFixed(2)
      : String(avg);

  function starClass(n) {
    if (hover > 0) {
      return n <= hover ? "starBtn hoverOn" : "starBtn";
    }
    if (value != null) {
      return n <= value ? "starBtn on" : "starBtn";
    }
    return "starBtn";
  }

  return (
    <div className="ratingRow">
      <div
        className="ratingStars"
        onMouseLeave={() => setHover(0)}
        aria-label="Rate this video"
      >
        {stars.map((n) => (
          <button
            key={n}
            type="button"
            className={starClass(n)}
            disabled={disabled}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onRate?.(n)}
          >
            ★
          </button>
        ))}

        {/* INLINE META ON SAME ROW */}
        <span className="ratingInline">
          {}
          <span className="ratingCount"></span>
        </span>
      </div>
    </div>
  );
}
