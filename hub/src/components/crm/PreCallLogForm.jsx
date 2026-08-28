import { useState } from "react";
import { adminApi } from "../../lib/adminApi";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// lead-engine-spec.md §5.2 — exactly the 4 things the pre-call block logs,
// nothing more. This is not a sales call; keep the form as fast as the
// call itself (~65s including no-answers, per §5.3).
export function PreCallLogForm({ business, onLogged, onCancel }) {
  const [contactName, setContactName] = useState("");
  const [dmDays, setDmDays] = useState([]);
  const [dmWindow, setDmWindow] = useState("");
  const [disqualifier, setDisqualifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggleDay(day) {
    setDmDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.logPreCall(business.id, {
        contact_name: contactName.trim() || undefined,
        dm_days: dmDays.length ? dmDays : undefined,
        dm_window: dmWindow.trim() || undefined,
        disqualifier: disqualifier.trim() || undefined,
      });
      onLogged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="precall-form" onSubmit={submit}>
      {error ? <p className="outcome-error">{error}</p> : null}
      <label>
        Owner/manager name
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Maria" />
      </label>
      <div className="precall-days">
        {DAYS.map((d) => (
          <button
            type="button"
            key={d}
            className={dmDays.includes(d) ? "day-on" : "day-off"}
            onClick={() => toggleDay(d)}
          >
            {d}
          </button>
        ))}
      </div>
      <label>
        Time window
        <input value={dmWindow} onChange={(e) => setDmWindow(e.target.value)} placeholder="Mornings before 10" />
      </label>
      <label>
        Disqualifier (optional — sets do-not-contact)
        <input
          value={disqualifier}
          onChange={(e) => setDisqualifier(e.target.value)}
          placeholder="e.g. corporate, closing next month"
        />
      </label>
      <div className="precall-actions">
        <button type="submit" className="btn sm" disabled={busy}>
          {busy ? "Saving…" : "Log call"}
        </button>
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
