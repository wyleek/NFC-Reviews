import { TagActions } from "./TagActions";

// "Before you go in" — the walk-in-the-door link (PR #8 on admin.html):
// one working card, right now, before contact info or pricing exist.
export function QuickLinkCard({ picked, quickLink, busy, err, onGetLink }) {
  return (
    <div className="card">
      <div className="step">Before you go in</div>
      <h2>{quickLink ? "Your working link" : "Get one link now"}</h2>
      {quickLink ? (
        <>
          <p className="sub">
            Walk in with this — write it to a card or copy it. It's already attached to {picked.name};
            finishing the sale below reuses this exact card instead of making a new one.
          </p>
          <div className="link">{quickLink.url}</div>
          <TagActions url={quickLink.url} />
        </>
      ) : (
        <>
          <p className="sub">
            Skip contact info and pricing for now — get one working link you can hand over or write to
            a card before you've made the sale.
          </p>
          <button type="button" className="btn" onClick={onGetLink} disabled={busy}>
            {busy ? "…" : "Get a link now"}
          </button>
          {err && <div className="err">{err}</div>}
        </>
      )}
    </div>
  );
}
