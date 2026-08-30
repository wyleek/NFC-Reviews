import { STAGE_LABELS } from "../../lib/stages";

// Step 1 — find the business. Local-first: `onSearch` checks our own
// `businesses` table (free) before ever calling Google (billed) — see
// AdminTab.jsx's doSearch. Local matches render here tagged "Already on
// file"; Google's results (if the local check came up empty, or the user
// explicitly asks via `onSearchGoogle`) render below them, visually
// distinct, still giving the Place ID automatically.
export function SearchStep({
  query,
  setQuery,
  hits,
  localHits,
  picked,
  busy,
  err,
  onSearch,
  onSearchGoogle,
  onPick,
  onPickLocal,
}) {
  return (
    <div className="card">
      <div className="step">Step 1</div>
      <h2>Find the business</h2>
      <p className="sub">
        Type the name — we check existing customers/leads first, free, before ever asking Google.
      </p>
      <div className="row">
        <input
          value={query}
          placeholder="Bluebird Coffee, Kennedy St"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSearch();
          }}
        />
        <button type="button" className="btn sm" onClick={onSearch} disabled={busy}>
          {busy ? "…" : "Search"}
        </button>
      </div>
      {err && <div className="err">{err}</div>}

      {localHits.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {localHits.map((b) => (
            <div
              key={b.id}
              className={`hit local${picked && picked._localId === b.id ? " on" : ""}`}
              onClick={() => onPickLocal(b)}
            >
              <div className="n">
                {b.name}
                <span className="tag-local">Already on file</span>
              </div>
              <div className="a">Stage: {STAGE_LABELS[b.stage] ?? b.stage}</div>
              <div className="stats">
                <span>
                  <b>{b.current_review_count ?? "—"}</b> reviews
                </span>
                <span>
                  <b>{b.current_rating ?? "—"}</b> ★
                </span>
              </div>
            </div>
          ))}
          <button type="button" className="btn ghost sm" onClick={onSearchGoogle} disabled={busy}>
            Not it — search Google instead
          </button>
        </div>
      )}

      {hits.length > 0 && (
        <div style={{ marginTop: 14 }}>
          {localHits.length > 0 && <p className="note" style={{ marginTop: 0 }}>Google results</p>}
          {hits.map((h, i) => (
            <div
              key={h.place_id}
              className={`hit${picked && !picked._localId && picked.place_id === h.place_id ? " on" : ""}`}
              onClick={() => onPick(i)}
            >
              <div className="n">{h.name}</div>
              <div className="a">{h.address || ""}</div>
              <div className="stats">
                <span>
                  <b>{h.review_count}</b> reviews
                </span>
                <span>
                  <b>{h.rating ?? "—"}</b> ★
                </span>
                {h.velocity_estimate ? (
                  <span>
                    ~<b>{h.velocity_estimate}</b> reviews/mo (est.)
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
