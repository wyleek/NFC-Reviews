import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { adminApi } from "../../lib/adminApi";
import { CALL_LIST_STAGES, STAGE_LABELS } from "../../lib/stages";
import { PreCallLogForm } from "./PreCallLogForm";

const BUSINESS_FIELDS =
  "id, name, stage, google_place_id, tier, rank_score, category_group, corridor, " +
  "best_callback_window, do_not_contact, follow_up_at, created_at";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The Call List's only job is holding businesses someone put there on
// purpose — via Kanban drag (stage -> qualified/pre_called/visit_planned/
// rescheduled) or the quick-add below. It used to also geolocate the
// browser and sort nearest-first (crm-spec.md 2b's "location-sort" idea);
// that's gone per direct product direction — this is a schedule now, not
// a route planner, and no tab should be popping a location permission
// prompt. Sort is: scheduled calls grouped by day-of-week and ordered
// earliest-to-latest by the pre-call block's logged start time, then an
// "Unscheduled" bucket (no start time logged yet) using the old
// due/overdue follow-up logic, then add-order.
export function CallList({ search = "" }) {
  const [businesses, setBusinesses] = useState([]);
  const [visited, setVisited] = useState(new Set()); // business_id
  const [contacts, setContacts] = useState({}); // business_id -> contact
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loggingFor, setLoggingFor] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Quick-add: type a business name, press Enter, pick the Google Places
  // result — it's added straight to the list. Deliberately not the full
  // Admin-tab wizard (SearchStep.jsx's flow): no contact/cards steps, just
  // find-or-create + pull the phone number (add_lead in admin-api).
  const [addQuery, setAddQuery] = useState("");
  const [addHits, setAddHits] = useState([]);
  const [addBusy, setAddBusy] = useState(false);
  // Synchronous guard alongside addBusy — React's `disabled` doesn't apply
  // until the next render, so two fast clicks/Enter-presses can both slip
  // through before the button actually disables. A ref updates immediately.
  const addInFlight = useRef(false);
  const [addErr, setAddErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const bizRes = await supabase
      .from("businesses")
      .select(BUSINESS_FIELDS)
      .in("stage", CALL_LIST_STAGES)
      .eq("do_not_contact", false);

    if (bizRes.error) {
      setError(bizRes.error.message);
      setLoading(false);
      return;
    }
    const list = bizRes.data ?? [];
    const ids = list.map((b) => b.id);

    const [activitiesRes, contactsRes] = await Promise.all([
      ids.length
        ? supabase.from("activities").select("business_id, type").eq("type", "visit").in("business_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase.from("contacts").select("*").eq("is_primary", true).in("business_id", ids)
        : Promise.resolve({ data: [] }),
    ]);

    const contactMap = {};
    for (const c of contactsRes.data ?? []) contactMap[c.business_id] = c;

    setBusinesses(list);
    setVisited(new Set((activitiesRes.data ?? []).map((a) => a.business_id)));
    setContacts(contactMap);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  function refresh() {
    setLoggingFor(null);
    setRefreshToken((t) => t + 1);
  }

  async function doAddSearch() {
    if (!addQuery.trim()) return;
    setAddBusy(true);
    setAddErr("");
    try {
      const d = await adminApi.searchPlace(addQuery);
      setAddHits(d.places ?? []);
    } catch (e) {
      setAddErr(e.message);
    }
    setAddBusy(false);
  }

  async function pickAddResult(hit) {
    if (addInFlight.current) return;
    addInFlight.current = true;
    setAddBusy(true);
    setAddErr("");
    try {
      await adminApi.addLead(hit.place_id, hit.name);
      setAddQuery("");
      setAddHits([]);
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setAddErr(e.message);
    }
    addInFlight.current = false;
    setAddBusy(false);
  }

  if (loading) return <div className="board-status">Loading call list…</div>;
  if (error) return <div className="board-status error">{error}</div>;

  const q = search.trim().toLowerCase();
  const filtered = q ? businesses.filter((b) => b.name?.toLowerCase().includes(q)) : businesses;

  const rows = filtered.map((b) => {
    const contact = contacts[b.id];
    const followUpAt = b.follow_up_at ? new Date(b.follow_up_at) : null;
    return {
      business: b,
      isVisited: visited.has(b.id),
      contact,
      followUpAt,
      followUpDue: followUpAt != null && followUpAt.getTime() <= Date.now(),
    };
  });

  // A row is "scheduled" once the pre-call block has logged both a day
  // and a start time — that's the earliest point sorting-by-time makes
  // sense. Anything else (never called, or called but no start time
  // logged) falls into the trailing Unscheduled bucket.
  const scheduled = [];
  const unscheduled = [];
  for (const row of rows) {
    if (row.contact?.dm_window_start && row.contact?.dm_days?.length) scheduled.push(row);
    else unscheduled.push(row);
  }

  // A business can be marked available on multiple days. Grouping it
  // under every one of those days would show the same call twice (or
  // more) in what's meant to be a single flat list — confusing when
  // counting "how many calls today" or checking one off. Instead, group
  // each business once, under the earliest day it's available (Mon..Sun
  // order) — still fully ordered within the day by start time.
  function earliestDayIndex(dmDays) {
    let best = DAYS.length;
    for (const d of dmDays) {
      const i = DAYS.indexOf(d);
      if (i >= 0 && i < best) best = i;
    }
    return best;
  }

  const byDay = DAYS.map(() => []);
  for (const row of scheduled) {
    const i = earliestDayIndex(row.contact.dm_days);
    (byDay[i] ?? byDay[byDay.length - 1]).push(row);
  }
  for (const group of byDay) {
    group.sort((a, b) => a.contact.dm_window_start.localeCompare(b.contact.dm_window_start));
  }

  unscheduled.sort((a, b) => {
    if (a.followUpDue !== b.followUpDue) return a.followUpDue ? -1 : 1;
    if (a.followUpDue && b.followUpDue) return a.followUpAt - b.followUpAt;
    return new Date(a.business.created_at) - new Date(b.business.created_at);
  });

  const groups = [
    ...DAYS.map((day, i) => ({ label: day, rows: byDay[i] })),
    { label: "Unscheduled", rows: unscheduled },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="call-list">
      <div className="call-list-search">
        <input
          type="text"
          placeholder="Add a business… (search Google Places)"
          value={addQuery}
          onChange={(e) => setAddQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") doAddSearch();
          }}
        />
        <button type="button" className="btn sm" onClick={doAddSearch} disabled={addBusy}>
          {addBusy ? "…" : "Search"}
        </button>
      </div>
      {addErr ? <p className="board-status error">{addErr}</p> : null}
      {addHits.length ? (
        <ul className="call-list-rows">
          {addHits.map((h) => (
            <li key={h.place_id} onClick={() => pickAddResult(h)} style={{ cursor: "pointer" }}>
              <div className="call-row-main">
                <div>
                  <div className="call-row-name">{h.name}</div>
                  <div className="call-row-meta">
                    <span>{h.address || ""}</span>
                  </div>
                </div>
                <button type="button" className="btn ghost sm" disabled={addBusy} onClick={() => pickAddResult(h)}>
                  Add
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {groups.length === 0 ? (
        <p className="empty">{q ? `No businesses match "${search}".` : "Nothing to call right now."}</p>
      ) : null}

      {groups.map((group) => (
        <div key={group.label}>
          <div className="call-list-group-header">{group.label}</div>
          <ul className="call-list-rows">
            {group.rows.map(({ business, isVisited, contact, followUpAt, followUpDue }) => (
              <li key={business.id} className={isVisited ? "visited" : ""}>
                <div className="call-row-main">
                  <div>
                    <div className="call-row-name">{business.name}</div>
                    <div className="call-row-meta">
                      {contact?.dm_window_start ? (
                        <span className="pill">
                          {contact.dm_window_start}
                          {contact.dm_window_end ? `–${contact.dm_window_end}` : "+"}
                        </span>
                      ) : null}
                      {followUpAt ? (
                        <span className={`pill${followUpDue ? " status-lost" : ""}`}>
                          {followUpDue ? "Follow up: " : "Follow up "}
                          {followUpAt.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </span>
                      ) : null}
                      <span className="pill">{STAGE_LABELS[business.stage]}</span>
                      {business.tier ? <span className="pill">Tier {business.tier}</span> : null}
                      {isVisited ? <span className="pill">visited</span> : null}
                    </div>
                    {contact ? (
                      <div className="call-row-contact">
                        {contact.name ? `${contact.name} — ` : ""}
                        {contact.dm_days?.length ? contact.dm_days.join("/") : "days unknown"}
                        {contact.dm_window ? `, ${contact.dm_window}` : ""}
                        {contact.verified_at ? ` (as of ${new Date(contact.verified_at).toLocaleDateString()})` : ""}
                      </div>
                    ) : (
                      <div className="call-row-contact empty">No pre-call logged yet.</div>
                    )}
                  </div>
                  <button type="button" className="btn ghost sm" onClick={() => setLoggingFor(business.id)}>
                    Log call
                  </button>
                </div>
                {loggingFor === business.id ? (
                  <PreCallLogForm business={business} onLogged={refresh} onCancel={() => setLoggingFor(null)} />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
