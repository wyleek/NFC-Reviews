import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { adminApi } from "../../lib/adminApi";
import { ACTIVITY_TYPE_LABELS, STAGE_LABELS } from "../../lib/stages";
import { OutcomeButtons } from "./OutcomeButtons";
import { VoiceNote } from "./VoiceNote";
import { FollowUpPicker } from "./FollowUpPicker";

const CARD_TYPES = ["stand", "placard", "badge", "card"];
const DEAL_STATUSES = ["open", "won", "lost"];

// crm-spec.md 2a: "Clicking a business opens a detail drawer: the
// activities timeline + any open deals." (contacts included too — it's
// the natural place for them, and admin-api already writes a contact
// there on sale.)
//
// This drawer is the single place to manage everything about a business —
// contacts, deals, activity, and cards — so field admins don't need to jump
// to the separate Admin tab (that tab's "Manage in Admin" deep link from
// here still exists for the full onboarding wizard, but day-to-day edits —
// fix a phone number, close out a deal, add a card — happen right here).
// Every mutation goes through admin-api (see hub/src/lib/adminApi.js),
// never a direct Supabase write, same rule as the rest of the app.
export function BusinessDrawer({ businessId, onClose, onChanged, onManageInAdmin }) {
  const [business, setBusiness] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [activities, setActivities] = useState([]);
  const [deals, setDeals] = useState([]);
  const [cards, setCards] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [bizRes, contactsRes, activitiesRes, dealsRes, cardsRes] = await Promise.all([
      supabase.from("businesses").select("*").eq("id", businessId).single(),
      supabase.from("contacts").select("*").eq("business_id", businessId).order("is_primary", { ascending: false }),
      supabase.from("activities").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
      supabase.from("deals").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
      // Only active cards — a soft-deleted (retired) card shouldn't show up
      // as something to manage here. See admin-api's delete_card.
      supabase.from("cards").select("*").eq("business_id", businessId).eq("active", true).order("created_at"),
    ]);
    if (bizRes.error) setError(bizRes.error.message);
    else setError(null);
    setBusiness(bizRes.data);
    setContacts(contactsRes.data ?? []);
    setActivities(activitiesRes.data ?? []);
    setDeals(dealsRes.data ?? []);
    setCards(cardsRes.data ?? []);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    load();
    onChanged();
  }

  // ---------------------------------------------------------------- contacts
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
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addContactRow() {
    try {
      await adminApi.addContact({ business_id: business.id, name: "", title: "", email: "", phone: "" });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeContact(id) {
    if (!window.confirm("Delete this contact?")) return;
    try {
      await adminApi.deleteContact(id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  // ------------------------------------------------------------------ deals
  function editDeal(id, patch) {
    setDeals(deals.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  async function saveDeal(deal) {
    try {
      await adminApi.updateDeal({
        id: deal.id,
        business_id: deal.business_id,
        product_sku: deal.product_sku,
        amount: deal.amount === "" || deal.amount == null ? null : Number(deal.amount),
        is_trial: deal.is_trial,
        trial_start: deal.trial_start,
        trial_end: deal.trial_end,
        status: deal.status,
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeDeal(id) {
    if (!window.confirm("Delete this deal?")) return;
    try {
      await adminApi.deleteDeal(id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  // -------------------------------------------------------------- activity
  async function removeActivity(id) {
    // Activities stay append-only — this removes an entry, it does not
    // rewrite one. See admin-api's delete_activity docstring.
    if (!window.confirm("Delete this activity entry?")) return;
    try {
      await adminApi.deleteActivity(id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  // ------------------------------------------------------------------ cards
  function editCard(id, patch) {
    setCards(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function saveCard(card) {
    try {
      await adminApi.updateCard({ id: card.id, label: card.label, card_type: card.card_type });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function addCardRow() {
    try {
      await adminApi.addCard({
        business_id: business.id,
        label: `Card ${cards.length + 1}`,
        card_type: "stand",
      });
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  async function removeCard(id) {
    if (!window.confirm("Remove this card? It stops redirecting taps but its history is kept.")) return;
    try {
      await adminApi.deleteCard(id);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {error ? <div className="board-status error">{error}</div> : null}
        {!business ? (
          <div className="board-status">Loading…</div>
        ) : (
          <>
            <h2>{business.name}</h2>
            <div className="drawer-stage-pill">{STAGE_LABELS[business.stage]}</div>

            {onManageInAdmin ? (
              // Deep link into Admin's full onboarding wizard for this same
              // business — most day-to-day edits (contacts/deals/activity/
              // cards) now happen right here in the sections below instead.
              <button
                type="button"
                className="btn ghost sm"
                style={{ marginBottom: 14 }}
                onClick={() => {
                  onManageInAdmin(business.id);
                  onClose();
                }}
              >
                Manage in Admin ↗
              </button>
            ) : null}

            <section>
              <h3>Follow-up</h3>
              <FollowUpPicker business={business} onSaved={refresh} />
            </section>

            <section>
              <h3>Outcome</h3>
              <OutcomeButtons business={business} onDone={refresh} />
            </section>

            <section>
              <h3>Voice / text note</h3>
              <VoiceNote businessId={business.id} onSaved={refresh} />
            </section>

            <section>
              <h3>Contacts</h3>
              {contacts.length === 0 ? (
                <p className="empty">No contacts yet.</p>
              ) : (
                <ul className="contact-list">
                  {contacts.map((c) => (
                    <li key={c.id} className="editable-row">
                      <button
                        type="button"
                        className="row-delete"
                        onClick={() => removeContact(c.id)}
                        aria-label="Delete contact"
                      >
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
            </section>

            <section>
              <h3>Deals</h3>
              {deals.length === 0 ? (
                <p className="empty">No deals yet.</p>
              ) : (
                <ul className="deal-list">
                  {deals.map((d) => (
                    <li key={d.id} className="editable-row">
                      <button
                        type="button"
                        className="row-delete"
                        onClick={() => removeDeal(d.id)}
                        aria-label="Delete deal"
                      >
                        ×
                      </button>
                      <div className="row-fields">
                        <select
                          value={d.status}
                          onChange={(e) => {
                            editDeal(d.id, { status: e.target.value });
                            saveDeal({ ...d, status: e.target.value });
                          }}
                        >
                          {DEAL_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        <input
                          value={d.product_sku || ""}
                          placeholder="Product / SKU"
                          onChange={(e) => editDeal(d.id, { product_sku: e.target.value })}
                          onBlur={() => saveDeal(d)}
                        />
                        <input
                          className="price"
                          type="number"
                          value={d.amount ?? ""}
                          placeholder="$"
                          onChange={(e) => editDeal(d.id, { amount: e.target.value })}
                          onBlur={() => saveDeal(d)}
                        />
                      </div>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={Boolean(d.is_trial)}
                          onChange={(e) => {
                            editDeal(d.id, { is_trial: e.target.checked });
                            saveDeal({ ...d, is_trial: e.target.checked });
                          }}
                        />
                        Trial
                      </label>
                      {d.is_trial ? (
                        <div className="row-fields">
                          <input
                            type="date"
                            value={d.trial_start || ""}
                            onChange={(e) => editDeal(d.id, { trial_start: e.target.value })}
                            onBlur={() => saveDeal(d)}
                          />
                          <input
                            type="date"
                            value={d.trial_end || ""}
                            onChange={(e) => editDeal(d.id, { trial_end: e.target.value })}
                            onBlur={() => saveDeal(d)}
                          />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>Cards</h3>
              {cards.length === 0 ? (
                <p className="empty">No cards yet.</p>
              ) : (
                <ul className="card-list">
                  {cards.map((c) => (
                    <li key={c.id} className="editable-row">
                      <button
                        type="button"
                        className="row-delete"
                        onClick={() => removeCard(c.id)}
                        aria-label="Remove card"
                      >
                        ×
                      </button>
                      <div className="row-fields">
                        <input
                          value={c.label || ""}
                          placeholder="Where it goes"
                          onChange={(e) => editCard(c.id, { label: e.target.value })}
                          onBlur={() => saveCard(c)}
                        />
                        <select
                          value={c.card_type || "stand"}
                          onChange={(e) => {
                            editCard(c.id, { card_type: e.target.value });
                            saveCard({ ...c, card_type: e.target.value });
                          }}
                        >
                          {CARD_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="note" style={{ marginTop: 4, wordBreak: "break-all" }}>
                        slug: {c.slug}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={addCardRow}>
                + Add card
              </button>
            </section>

            <section>
              <h3>Activity timeline</h3>
              {activities.length === 0 ? (
                <p className="empty">No activity yet.</p>
              ) : (
                <ul className="activity-list">
                  {activities.map((a) => (
                    <li key={a.id} className="editable-row">
                      <button
                        type="button"
                        className="row-delete"
                        onClick={() => removeActivity(a.id)}
                        aria-label="Delete activity entry"
                      >
                        ×
                      </button>
                      <span className="pill">{ACTIVITY_TYPE_LABELS[a.type] ?? a.type}</span>
                      <span className="activity-time">{new Date(a.created_at).toLocaleString()}</span>
                      {a.body ? <div className="activity-body">{a.body}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
