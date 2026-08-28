import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { PreCallLogForm } from "./PreCallLogForm";

// lead-engine-spec.md §6's "Sun eve: score, tier, export call list" step —
// freshly-scored leads (feature/lead-scoring's v_call_list) ready for
// their FIRST pre-call, before they've been qualified at all. This is
// deliberately a separate tab from "Call list" (CallList.jsx), which
// routes *already-qualified* pipeline businesses to a visit — different
// stage of the funnel, different question ("who's worth calling at all"
// vs. "who's next on my route"). Read-only source: v_call_list already
// does the tier/score filtering, the 14-day pre-call exclusion, and the
// do-not-contact exclusion server-side (see feature/lead-scoring) —
// this component just displays it and offers the same pre-call log
// action as the other list.
export function NewLeadsList() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loggingFor, setLoggingFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("v_call_list").select("*");
    if (error) setError(error.message);
    else setError(null);
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    setLoggingFor(null);
    load();
  }

  if (loading) return <div className="board-status">Loading new leads…</div>;
  if (error) return <div className="board-status error">{error}</div>;

  return (
    <div className="call-list">
      {rows.length === 0 ? (
        <p className="empty">
          No fresh leads right now — nothing scored tier A/B that hasn't already been pre-called
          in the last 14 days. Run scrape_prospects.py on a corridor, then `select refresh_tiers();`.
        </p>
      ) : null}
      <ul className="call-list-rows">
        {rows.map((r) => (
          <li key={r.business_id}>
            <div className="call-row-main">
              <div>
                <div className="call-row-name">
                  {r.display_name} <span className={`pill tier-${r.tier?.toLowerCase()}`}>Tier {r.tier}</span>{" "}
                  <span className="pill">Score {r.score}</span>
                </div>
                <div className="call-row-meta">
                  <span>{r.corridor ?? "no corridor"}</span>
                  <span>{r.national_phone}</span>
                  <span>{r.user_rating_count ?? "?"} reviews</span>
                  {r.reviews_per_30d != null ? <span>{r.reviews_per_30d}/30d</span> : null}
                </div>
                <div className="call-row-contact">{r.pitch_hook}</div>
                {r.contact_name ? (
                  <div className="call-row-contact">Known contact: {r.contact_name}</div>
                ) : null}
              </div>
              <button type="button" className="btn ghost sm" onClick={() => setLoggingFor(r.business_id)}>
                Log call
              </button>
            </div>
            {loggingFor === r.business_id ? (
              <PreCallLogForm
                business={{ id: r.business_id, name: r.display_name }}
                onLogged={refresh}
                onCancel={() => setLoggingFor(null)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
