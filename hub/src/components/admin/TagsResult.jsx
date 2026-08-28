import { dashboardUrl } from "../../lib/config";
import { NFC_OK, TagActions } from "./TagActions";

// Final screen after create_business — a tap-card link per card (PR #7)
// plus the client-dashboard link, built with the shared dashboardUrl()
// helper so it never needs a UUID typed by hand.
export function TagsResult({ created, contact, onReset }) {
  const dashUrl = dashboardUrl(created.business.id);

  return (
    <>
      <div className="card">
        <h2>{created.business.name}'s dashboard</h2>
        <p className="sub">Text or email this link — it opens straight to their numbers, no login or ID to type.</p>
        <div className="link">{dashUrl}</div>
        <TagActions url={dashUrl} copiedMessage="✓ Copied — ready to text or email" showWrite={false} />
      </div>

      <div className="card">
        <h2>{created.business.name} is set up</h2>
        <p className="sub">
          {NFC_OK
            ? "Hold each card to the top of your phone and press Write."
            : "Copy each link, then write it in the NFC Tools app (Write › Add record › URL)."}
        </p>
        {!NFC_OK && (
          <div className="warn">
            This iPhone can't write NFC tags from a browser — Apple doesn't support it. Everything else
            is done; only the write step needs NFC Tools.
          </div>
        )}
        {created.cards.map((k) => (
          <div className="tagbox" key={k.id}>
            <div className="lbl">{k.label}</div>
            <div className="ty">{k.card_type}</div>
            <div className="link">{k.url}</div>
            <TagActions url={k.url} />
          </div>
        ))}
      </div>

      <div className="card">
        <div className="step">Before you leave</div>
        <div className="checklist">
          {[
            "Tap-test every card on your own phone",
            "Place the stand where customers pay",
            "Book the 30-day check-in now, on their calendar",
            "Coach staff: ask every customer honestly, never request 5 stars",
            `Text or email the dashboard link above to ${contact.email || contact.phone || "them"}`,
          ].map((t) => (
            <div key={t}>
              <span className="dot"></span>
              {t}
            </div>
          ))}
        </div>
      </div>

      <button type="button" className="btn ghost" onClick={onReset}>
        Set up another business
      </button>
    </>
  );
}
