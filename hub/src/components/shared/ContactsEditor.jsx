import { adminApi } from "../../lib/adminApi";

// Multi-contact CRUD editor — add/edit/delete, inline, saved on blur, with
// a hover-revealed (always-visible on touch) delete "×" per row. Originally
// built for the CRM drawer (BusinessDrawer.jsx) and extracted here so
// Admin's edit flow (AdminTab.jsx, for a business already in the system)
// can reuse the exact same component instead of the two tabs maintaining
// diverging contact-editing implementations — see the CRM handoff notes'
// "Admin and CRM kind of need to function the same way."
//
// Only usable once `businessId` is real (the business row already exists —
// every mutation here goes straight through admin-api). A business that
// hasn't been created yet has nowhere to save a contact to; that path
// still uses AdminTab's local-state ContactStep until creation.
// `onSaved` fires after an inline field edit — local state (via
// setContacts) already reflects the change, so this is just a
// lightweight "something changed" notification (e.g. re-syncing a parent
// board view), not a reason to refetch.
// `onListChanged` fires after add/remove, which change the row count
// itself — the caller is expected to reload the contacts list here.
export function ContactsEditor({ businessId, contacts, setContacts, onSaved, onListChanged, onError }) {
  function editContact(id, patch) {
    setContacts(contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function saveContact(contact) {
    try {
      await adminApi.updateContact({
        id: contact.id,
        name: contact.name,
        title: contact.title,
        email: contact.email,
        phone: contact.phone,
      });
      onSaved?.();
    } catch (e) {
      onError?.(e.message);
    }
  }

  async function addContactRow() {
    try {
      await adminApi.addContact({ business_id: businessId, name: "", title: "", email: "", phone: "" });
      onListChanged?.();
    } catch (e) {
      onError?.(e.message);
    }
  }

  async function removeContact(id) {
    if (!window.confirm("Delete this contact?")) return;
    try {
      await adminApi.deleteContact(id);
      onListChanged?.();
    } catch (e) {
      onError?.(e.message);
    }
  }

  return (
    <>
      {contacts.length === 0 ? (
        <p className="empty">No contacts yet.</p>
      ) : (
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id} className="editable-row">
              <button type="button" className="row-delete" onClick={() => removeContact(c.id)} aria-label="Delete contact">
                ×
              </button>
              {c.is_primary ? <span className="pill">primary</span> : null}
              <div className="row-fields">
                <input
                  value={c.name || ""}
                  placeholder="Name"
                  onChange={(e) => editContact(c.id, { name: e.target.value })}
                  onBlur={() => saveContact(c)}
                />
                <input
                  value={c.title || ""}
                  placeholder="Title"
                  onChange={(e) => editContact(c.id, { title: e.target.value })}
                  onBlur={() => saveContact(c)}
                />
              </div>
              <div className="row-fields">
                <input
                  type="email"
                  value={c.email || ""}
                  placeholder="Email"
                  onChange={(e) => editContact(c.id, { email: e.target.value })}
                  onBlur={() => saveContact(c)}
                />
                <input
                  type="tel"
                  value={c.phone || ""}
                  placeholder="Phone"
                  onChange={(e) => editContact(c.id, { phone: e.target.value })}
                  onBlur={() => saveContact(c)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={addContactRow}>
        + Add contact
      </button>
    </>
  );
}
