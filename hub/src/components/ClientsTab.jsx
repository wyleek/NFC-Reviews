import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { dashboardUrl } from "../lib/config";

// Same day-bucketing helpers as dashboard-app/src/Dashboard.jsx, kept local
// rather than shared since dashboard-app is a separate deployed app.
const DAY_MS = 86400000;
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Most recent snapshot with captured_on <= dateStr (snapshots must be sorted
// ascending) — ported from dashboard-app/src/Dashboard.jsx's snapshotAsOf().
function snapshotAsOf(snapshots, dateStr) {
  let found = null;
  for (const s of snapshots) {
    if (s.captured_on > dateStr) break;
    found = s;
  }
  return found;
}

// 🟢 gained ≥1 review in the last 14 days
// 🟡 0 in the last 14 days, but ≥1 in the last 30
// 🔴 0 reviews in the last 30+ days
// (thresholds per docs/BRANCH_BRIEF-hub-clients-tab.md — tune once real
// data is visible, not worth blocking on the exact numbers)
function healthOf(gained14, gained30) {
  if (gained14 >= 1) return "green";
  if (gained30 >= 1) return "yellow";
  return "red";
}

const HEALTH_RANK = { red: 0, yellow: 1, green: 2 };
const HEALTH_LABEL = { red: "No reviews in 30+ days", yellow: "Slowing down", green: "Healthy" };

export function ClientsTab() {
  const [state, setState] = useState({ loading: true, error: null, clients: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));

      const { data: businesses, error: bizErr } = await supabase
        .from("businesses")
        .select("id, name, current_review_count, current_rating")
        .eq("stage", "customer")
        .order("name");

      if (bizErr) {
        if (!cancelled) setState({ loading: false, error: bizErr.message, clients: [] });
        return;
      }
      if (!businesses?.length) {
        if (!cancelled) setState({ loading: false, error: null, clients: [] });
        return;
      }

      const ids = businesses.map((b) => b.id);
      const { data: snapshots, error: snapErr } = await supabase
        .from("review_snapshots")
        .select("business_id, captured_on, review_count, rating")
        .in("business_id", ids)
        .order("captured_on");

      if (snapErr) {
        if (!cancelled) setState({ loading: false, error: snapErr.message, clients: [] });
        return;
      }

      const byBusiness = new Map(ids.map((id) => [id, []]));
      for (const s of snapshots ?? []) byBusiness.get(s.business_id)?.push(s);

      const today = startOfDay(new Date());
      const keyToday = dateKey(today);
      const key14 = dateKey(addDays(today, -14));
      const key30 = dateKey(addDays(today, -30));

      const clients = businesses.map((b) => {
        const snaps = byBusiness.get(b.id) ?? [];
        const asOfToday = snapshotAsOf(snaps, keyToday);
        // Fall back to the durable count on `businesses` (kept in sync by
        // sync-reviews) when there's no snapshot history yet.
        const current = asOfToday?.review_count ?? b.current_review_count ?? 0;
        const as14 = snapshotAsOf(snaps, key14)?.review_count ?? current;
        const as30 = snapshotAsOf(snaps, key30)?.review_count ?? current;
        const gained14 = current - as14;
        const gained30 = current - as30;

        return {
          id: b.id,
          name: b.name,
          rating: asOfToday?.rating ?? b.current_rating ?? null,
          reviewCount: current,
          gained14,
          gained30,
          health: healthOf(gained14, gained30),
        };
      });

      clients.sort(
        (a, b) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.name.localeCompare(b.name),
      );

      if (!cancelled) setState({ loading: false, error: null, clients });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { loading, error, clients } = state;

  return (
    <div className="wrap">
      <div className="step">Clients</div>
      <h2>Customers</h2>
      <p className="sub">
        Worst health first — a slipping account shouldn't require opening its full dashboard to spot.
      </p>

      {loading && <div className="card">Loading…</div>}
      {!loading && error && <div className="card err">{error}</div>}
      {!loading && !error && clients.length === 0 && (
        <div className="card">
          <p className="sub" style={{ margin: 0 }}>
            No customers yet — businesses show up here once they close in the CRM.
          </p>
        </div>
      )}

      {!loading &&
        !error &&
        clients.map((c) => (
          <div key={c.id} className="hit" style={{ cursor: "default" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`health-dot ${c.health}`} title={HEALTH_LABEL[c.health]} />
              <span className="n">{c.name}</span>
            </div>
            <div className="stats" style={{ flexWrap: "wrap" }}>
              <span>
                <b>{c.rating ?? "—"}</b> ★
              </span>
              <span>
                <b>{c.reviewCount}</b> reviews
              </span>
              <span>
                <b>{c.gained14 >= 0 ? `+${c.gained14}` : c.gained14}</b> last 14d
              </span>
              <span>
                <b>{c.gained30 >= 0 ? `+${c.gained30}` : c.gained30}</b> last 30d
              </span>
            </div>
            <a
              className="btn ghost sm"
              style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}
              href={dashboardUrl(c.id)}
              target="_blank"
              rel="noreferrer"
            >
              View full dashboard ↗
            </a>
          </div>
        ))}
    </div>
  );
}
