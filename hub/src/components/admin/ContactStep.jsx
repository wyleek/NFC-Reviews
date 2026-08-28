// Step 2 — who to reach. Receipt, dashboard login, and the replacement
// guarantee all go here.
export function ContactStep({ contact, setContact }) {
  function set(field, value) {
    setContact({ ...contact, [field]: value });
  }

  return (
    <div className="card">
      <div className="step">Step 2</div>
      <h2>Who to reach</h2>
      <p className="sub">Receipt, dashboard login, and the replacement guarantee all go here.</p>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label>Name</label>
          <input value={contact.name} onChange={(e) => set("name", e.target.value)} placeholder="Marco" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Title</label>
          <input value={contact.title} onChange={(e) => set("title", e.target.value)} placeholder="Owner" />
        </div>
      </div>
      <div className="field">
        <label>Email</label>
        <input
          type="email"
          value={contact.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="marco@shop.com"
        />
      </div>
      <div className="field">
        <label>Phone</label>
        <input
          type="tel"
          value={contact.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="(202) 555-0134"
        />
      </div>
    </div>
  );
}
