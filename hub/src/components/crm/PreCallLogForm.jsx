import { useState } from "react";
import { adminApi } from "../../lib/adminApi";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// lead-engine-spec.md §5.2 — exactly the 4 things the pre-call block logs,
// nothing more. This is not a sales call; keep the form as fast as the
// call itself (~65s including no-answers, per §5.3).
//
// Availability used to be a single free-text "time window" note. The Call
// List now sorts earliest-to-latest, which needs a real time — so this
// captures a required start time (dm_window_start) and optional end time
// (dm_window_end), and keeps the free-text field around as an optional
// extra note (dm_window) rather than the primary way to record timing.
//
// `contact` — the business's current primary contact, if any — pre-fills
// every field below. log_pre_call (admin-api) always writes a fresh full
// record on submit (dm_days/dm_window/times are overwritten, not merged),
// so reopening this form blank on a business that's already been called
// once meant an unchanged resubmit would silently wipe out whatever was
// logged last time. Pre-filling from `contact` fixes that: what's already
// known shows up already selected, ready to confirm or correct.
export function PreCallLogForm({ business, contact, onLogged, onCancel }) {
  const [contactName, setContactName] = useState(contact?.name ?? "");
  const [dmDays, setDmDays] = useState(contact?.dm_days ?? []);
  // Distinguishes "asked, and there's genuinely no fixed schedule" from
  // "just haven't touched this yet" — otherwise an empty day row looks the
  // same either way. Defaults on when this contact was already verified
  // once (a prior call happened) but came back with no specific days.
  const [daysUnknown, setDaysUnknown] = useState(
    Boolean(contact?.verified_at) && !contact?.dm_days?.length,
  );
  const [windowStart, setWindowStart] = useState(contact?.dm_window_start ?? "");
  const [windowEnd, setWindowEnd] = useState(contact?.dm_window_end ?? "");
  const [dmWindow, setDmWindow] = useState(contact?.dm_window ?? "");
  const [disqualifier, setDisqualifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggleDay(day) {
    setDaysUnknown(false);
    setDmDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  function toggleDaysUnknown() {
    setDaysUnknown((prev) => {
      const next = !prev;
      if (next) setDmDays([]);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);

    // dm_window_start is required for the row to land in a scheduled
    // (rather than "Unscheduled") group in the Call List — unless the
    // call turned up a disqualifier, in which case timing is moot.
    if (!windowStart && !disqualifier.trim()) {
      setError("Available-from time is required (or log a disqualifier instead).");
      return;
    }

    setBusy(true);
    try {
      await adminApi.logPreCall(business.id, {
        contact_name: contactName.trim() || undefined,
        dm_days: dmDays.length ? dmDays : undefined,
        dm_window_start: windowStart || undefined,
        dm_window_end: windowEnd || undefined,
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
            disabled={daysUnknown}
            onClick={() => toggleDay(d)}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          className={daysUnknown ? "day-on" : "day-off"}
          onClick={toggleDaysUnknown}
        >
          Days unknown
        </button>
      </div>
      <div className="precall-window">
        <label>
          Available from
          <input
            type="time"
            value={windowStart}
            onChange={(e) => setWindowStart(e.target.value)}
            required={!disqualifier.trim()}
          />
        </label>
        <label>
          Until (optional)
          <input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
        </label>
      </div>
      <label>
        Note (optional — extra detail beyond the time window)
        <input value={dmWindow} onChange={(e) => setDmWindow(e.target.value)} placeholder="e.g. call the back line, not the front counter" />
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
