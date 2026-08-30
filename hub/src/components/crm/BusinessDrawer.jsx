import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { ACTIVITY_TYPE_LABELS, STAGE_LABELS } from "../../lib/stages";
import { OutcomeButtons } from "./OutcomeButtons";
import { VoiceNote } from "./VoiceNote";
import { FollowUpPicker } from "./FollowUpPicker";

// crm-spec.md 2a: "Clicking a business opens a detail drawer: the
// activities timeline + any open deals." (contacts included too — it's
// the natural place for them, and admin-api already writes a contact
// there on sale.)
export function BusinessDrawer({ businessId, onClose, onChanged, onManageInAdmin }) {
  const [business, setBusiness] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [activities, setActivities] = useState([]);
  const [deals, setDeals] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [bizRes, contactsRes, activitiesRes, dealsRes] = await Promise.all([
      supabase.from("businesses").select("*").eq("id", businessId).single(),
      supabase.from("contacts").select("*").eq("business_id", businessId).order("is_primary", { ascending: false }),
      supabase.from("activities").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
      supabase.from("deals").select("*").eq("business_id", businessId).order("created_at", { ascending: false }),
    ]);
    if (bizRes.error) setError(bizRes.error.message);
    else setError(null);
    setBusiness(bizRes.data);
    setContacts(contactsRes.data ?? []);
    setActivities(activitiesRes.data ?? []);
    setDeals(dealsRes.data ?? []);
  }, [businessId]);

  useEffect(() => {
    load();
  }, [load]);

  function refresh() {
    load();
    onChanged();
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
              // Deep link into Admin's card/contact management for this
              // same business — no more re-searching Google (or anything)
              // to get from a CRM card to fixing a phone number or adding
              // a card. See App.jsx's adminDeepLinkId.
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
                    <li key={c.id}>
                      <strong>{c.name || "Unnamed"}</strong>
                      {c.title ? ` — ${c.title}` : ""}
                      {c.phone ? ` · ${c.phone}` : ""}
                      {c.email ? ` · ${c.email}` : ""}
                      {c.is_primary ? <span className="pill">primary</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>Deals</h3>
              {deals.length === 0 ? (
                <p className="empty">No deals yet.</p>
              ) : (
                <ul className="deal-list">
                  {deals.map((d) => (
                    <li key={d.id}>
                      <span className={`pill status-${d.status}`}>{d.status}</span>
                      {d.is_trial ? ` Trial (${d.trial_start} → ${d.trial_end})` : ` ${d.product_sku ?? "Sale"}`}
                      {d.amount != null ? ` · $${d.amount}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>Activity timeline</h3>
              {activities.length === 0 ? (
                <p className="empty">No activity yet.</p>
              ) : (
                <ul className="activity-list">
                  {activities.map((a) => (
                    <li key={a.id}>
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
