import "./LoginModal.css";

export default function LoginModal({ onClose, onSuccess }) {
  function handleSubmit(e) {
    e.preventDefault();

    // Temporary fake login
    //onSuccess({ username: "Jason", tokens: 120 });
    onSuccess(data);
    onClose();
  }
  console.log("AppLayout props:", { onAuthSuccess, authOpen, authMode });
  
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
            <div className="modal-header-left">
              <h2 className="modal-title">Log in</h2>

              <span className="signup-hint inline">
                Not a member?{" "}
                <button
                  className="signup-link"
                  type="button"
                  onClick={() => alert("Switch to signup")}
                >
                  Sign up now
                </button>
              </span>
            </div>

            <button
              className="icon-btn"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>


        <form className="modal-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="label">Email</span>
            <input autoFocus type="email" placeholder="you@example.com" />
          </label>

          <label className="field">
            <span className="label">Password</span>
            <input type="password" placeholder="••••••••" />
          </label>

          <div className="modal-actions">
            <button className="btn btn-primary" type="submit">
              Log in
            </button>
            <button className="btn btn-ghost" type="button" onClick={onClose}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
