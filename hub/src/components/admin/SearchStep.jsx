// Step 1 — find the business. Google gives us the Place ID automatically
// from a name search, same as admin.html.
export function SearchStep({ query, setQuery, hits, picked, busy, err, onSearch, onPick }) {
  return (
    <div className="card">
      <div className="step">Step 1</div>
      <h2>Find the business</h2>
      <p className="sub">Type the name — Google gives us the Place ID automatically.</p>
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
      <div style={{ marginTop: 14 }}>
        {hits.map((h, i) => (
          <div
            key={h.place_id}
            className={`hit${picked && picked.place_id === h.place_id ? " on" : ""}`}
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
    </div>
  );
}
