import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { adminApi } from "../../lib/adminApi";

// Owner = one point of contact that can own SEVERAL businesses. Assigning an
// owner here is exactly what lets that owner open ONE dashboard link
// (?owner=<uuid>) and switch between all their businesses, instead of a
// separate link per storefront. Most businesses have no owner grouping and
// stay exactly as they are ("— No owner —").
//
// Reads come straight from Supabase (owners has public-read RLS, same as the
// rest of the drawer's reads); the create/assign WRITES go through admin-api
// like every other mutation in the hub (never a direct client write).
export function OwnerPicker({ business, onChanged }) {
  const [owners, setOwners] = useState([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState(null);

  async function loadOwners() {
    const { data } = await supabase.from("owners").select("id, name").order("name");
    setOwners(data ?? []);
  }
  useEffect(() => {
    loadOwners();
  }, []);

  async function assign(ownerId) {
    setBusy(true);
    setErr(null);
    try {
      await adminApi.assignBusinessOwner(business.id, ownerId || null);
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function createAndAssign() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr(null);
    try {
      const { owner } = await adminApi.createOwner({ name });
      await adminApi.assignBusinessOwner(business.id, owner.id);
      setNewName("");
      setCreating(false);
      await loadOwners();
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const current = owners.find((o) => o.id === business.owner_id) || null;
  // Where this owner's combined dashboard lives. Kept in sync with
  // dashboard-app's ?owner=<uuid> resolver.
  const dashBase = "https://dashboard-app-omega-beige.vercel.app";

  if (creating) {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="New owner's name"
            value={newName}
            autoFocus
            disabled={busy}
            style={{ width: "auto", flex: "1 1 160px" }}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createAndAssign()}
          />
          <button type="button" className="btn sm" disabled={busy || !newName.trim()} onClick={createAndAssign}>
            Create &amp; assign
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={busy}
            onClick={() => {
              setCreating(false);
              setNewName("");
            }}
          >
            Cancel
          </button>
        </div>
        {err && <div style={{ color: "#c0392b", fontSize: 12, marginTop: 6 }}>{err}</div>}
      </div>
    );
  }

  return (
    <div>
      <select
        value={business.owner_id ?? ""}
        disabled={busy}
        onChange={(e) => (e.target.value === "__new" ? setCreating(true) : assign(e.target.value))}
      >
        <option value="">— No owner —</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
        <option value="__new">+ New owner…</option>
      </select>
      {current && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
          One combined dashboard for all of {current.name}&rsquo;s businesses:
          <br />
          <code style={{ wordBreak: "break-all" }}>
            {dashBase}/?owner={current.id}
          </code>
        </div>
      )}
      {err && <div style={{ color: "#c0392b", fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}
