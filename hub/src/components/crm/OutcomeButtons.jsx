import { useState } from "react";
import { adminApi } from "../../lib/adminApi";
import { OUTCOMES } from "../../lib/stages";

// crm-spec.md 2b: one tap does 3 things atomically (from the UI's point of
// view) — activity + stage flip, and for Trial, a deal + consent capture.
// Default trial length: the spec doesn't set a duration, so this uses
// 14 days as a reasonable default — adjust in the deal afterward if the
// actual offer differs.
const TRIAL_DAYS = 14;

export function OutcomeButtons({ business, onDone }) {
  const [pending, setPending] = useState(null); // outcome awaiting confirm (trial consent)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function apply(outcome) {
    setBusy(true);
    setError(null);
    try {
      await adminApi.logActivity(business.id, "outcome", outcome.label);
      await adminApi.updateStage(business.id, outcome.stage);
      if (outcome.createsDeal) {
        const start = new Date();
        const end = new Date(start.getTime() + TRIAL_DAYS * 86400000);
        await adminApi.upsertDeal({
          business_id: business.id,
          is_trial: true,
          status: "open",
          trial_start: start.toISOString().slice(0, 10),
          trial_end: end.toISOString().slice(0, 10),
        });
      }
      onDone();
      setPending(null);
    } catch (err) {
      // Leave `pending` as-is on failure so a failed trial-consent confirm
      // doesn't silently drop back to the plain button row — the user
      // needs to see the error and can retry or cancel explicitly.
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function tap(outcome) {
    // crm-spec.md 2c: trial requires explicit consent capture before it
    // can proceed — surfaced as a confirm step, not a silent flag flip.
    if (outcome.createsDeal && !business.sms_consent) {
      setPending(outcome);
      return;
    }
    apply(outcome);
  }

  async function confirmConsent(outcome) {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setSmsConsent(business.id, true);
      await apply(outcome);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="consent-confirm">
        <p>
          Starting a trial requires SMS opt-in consent (crm-spec.md 2c) —
          confirm <strong>{business.name}</strong> has agreed to receive texts from Tap2Review.
        </p>
        {error ? <p className="outcome-error">{error}</p> : null}
        <div className="consent-actions">
          <button type="button" className="btn sm" disabled={busy} onClick={() => confirmConsent(pending)}>
            {busy ? "Saving…" : "Confirm opt-in & start trial"}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              setPending(null);
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="outcome-buttons-wrap">
      {error ? <p className="outcome-error">{error}</p> : null}
      <div className="outcome-buttons">
        {OUTCOMES.map((o) => (
          <button key={o.key} type="button" disabled={busy} className={`outcome-${o.key}`} onClick={() => tap(o)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
