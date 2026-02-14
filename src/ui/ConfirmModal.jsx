import { useEffect } from "react";
import "./ConfirmModal.css";

export default function ConfirmModal({
  title = "Are you sure?",
  message = "This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}) {
  // 🔐 Close on ESC key
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") {
        onCancel?.();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div
        className="confirm-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-title">{title}</div>

        <div className="confirm-message">{message}</div>

        <div className="confirm-actions">
          <button
            className="confirm-btn cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>

          <button
            className={`confirm-btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
