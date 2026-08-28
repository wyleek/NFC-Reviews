const CARD_TYPES = ["stand", "placard", "badge", "card"];

// Step 3 — name each card, pick its type, set its own price. Cards
// carrying an `id` (from lookup_business/quick_link) are ones already
// written in the field; create_business updates those rows in place
// instead of minting duplicates.
export function CardsStep({ cards, setCards, subtotal, busy, err, onCreate }) {
  function updateCard(i, patch) {
    setCards(cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function removeCard(i) {
    setCards(cards.filter((_, idx) => idx !== i));
  }
  function addCard() {
    setCards([...cards, { label: "", type: "placard", price: "" }]);
  }

  const reusedCount = cards.filter((c) => c.id).length;

  return (
    <>
      <div className="card">
        <div className="step">Step 3</div>
        <h2>Cards</h2>
        <p className="sub">
          Name each card, pick its type, and set its own price — whatever you're actually charging for
          it.
        </p>
        {reusedCount > 0 && (
          <p className="note" style={{ marginTop: -8, marginBottom: 14 }}>
            Found {reusedCount} card{reusedCount > 1 ? "s" : ""} already made for this business (e.g. a
            demo tag from Link Maker) — reusing {reusedCount > 1 ? "them" : "it"} below, same URL that's
            already written.
          </p>
        )}
        {cards.map((c, i) => (
          <div className="cardrow" key={c.id ?? `new-${i}`}>
            <input
              value={c.label}
              onChange={(e) => updateCard(i, { label: e.target.value })}
              placeholder="Where it goes"
            />
            <select value={c.type} onChange={(e) => updateCard(i, { type: e.target.value })}>
              {CARD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className="price"
              type="text"
              inputMode="decimal"
              value={c.price}
              onChange={(e) => updateCard(i, { price: e.target.value })}
              placeholder="$"
            />
            <button type="button" className="del" onClick={() => removeCard(i)}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn ghost sm" onClick={addCard}>
          + Add card
        </button>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Collect</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>${subtotal.toFixed(2)}</div>
          </div>
        </div>
        <button type="button" className="btn" onClick={onCreate} disabled={busy}>
          {busy ? "Creating…" : "Create and get links"}
        </button>
        {err && <div className="err">{err}</div>}
      </div>
    </>
  );
}
