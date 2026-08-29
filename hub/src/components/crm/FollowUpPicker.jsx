import { useState } from "react";
import { adminApi } from "../../lib/adminApi";

// Structured "call back on this date at this time" — distinct from the
// free-text best_callback_window and from the "rescheduled" stage, neither
// of which pins down an actual date/time. Writes businesses.follow_up_at
// via admin-api's set_follow_up action.
function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FollowUpPicker({ business, onSaved }) {
  const [value, setValue] = useState(toLocalInputValue(business.follow_up_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(nextValue) {
    setSaving(true);
    setError(null);
    try {
      const iso = nextValue ? new Date(nextValue).toISOString() : null;
      await adminApi.setFollowUp(business.id, iso);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const due = business.follow_up_at ? new Date(business.follow_up_at) : null;
  const overdue = due && due.getTime() < Date.now();

  return (
    <div className="follow-up-picker">
      {error ? <p className="outcome-error">{error}</p> : null}
      {due ? (
        <div className={`pill${overdue ? " status-lost" : ""}`}>
          {overdue ? "Overdue: " : "Follow up "}
          {due.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </div>
      ) : (
        <p className="empty">No follow-up scheduled.</p>
      )}
      <div className="follow-up-actions">
        <input
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={saving}
        />
        <button type="button" className="btn sm" onClick={() => save(value)} disabled={!value || saving}>
          {saving ? "Saving…" : "Set"}
        </button>
        {business.follow_up_at ? (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => { setValue(""); save(null); }}
            disabled={saving}
          >
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
