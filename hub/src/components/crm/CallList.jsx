import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { adminApi } from "../../lib/adminApi";
import { CALL_LIST_STAGES, STAGE_LABELS } from "../../lib/stages";
import { PreCallLogForm } from "./PreCallLogForm";

const BUSINESS_FIELDS =
  "id, name, stage, google_place_id, tier, rank_score, category_group, corridor, " +
  "best_callback_window, do_not_contact, follow_up_at, created_at";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// tel: needs digits (and an optional leading +) only — strip whatever
// formatting Google Places / a human typing handed us (spaces, dashes,
// parens) so the link actually dials instead of erroring on punctuation.
function telHref(phone) {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, "");
  return cleaned ? `tel:${cleaned}` : null;
}

// dm_window_start/end are stored as raw <input type="time"> values
// ("HH:MM", 24h) — format for display since that's this list's whole
// reason for existing (deciding who to visit when).
function formatTime12(t) {
  if (!t) return null;
  const [hStr, mStr] = t.split(":");
  let h = parseInt(hStr, 10);
  if (Number.isNaN(h)) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr ?? "00"} ${ampm}`;
}

function formatWindow(contact) {
  const start = formatTime12(contact.dm_window_start);
  if (!start) return null;
  const end = formatTime12(contact.dm_window_end);
  return end ? `${start}–${end}` : `${start}+`;
}

function normalizeName(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Batch-add heuristic: auto-add only when the top Google Places result's
// name is a confident match for the typed line (an exact or substring
// match, case/punctuation-insensitive) AND there isn't a similarly-named
// runner-up (e.g. two locations of the same chain) that would make picking
// the top result a guess. Anything else gets flagged for manual review
// instead of silently adding the wrong location — see the batch-add UX
// decision in the CRM handoff notes.
function isConfidentMatch(query, top, second) {
  if (!top) return false;
  const nq = normalizeName(query);
  const nt = normalizeName(top.name);
  if (!nq || !nt) return false;
  const namesMatch = nt === nq || nt.includes(nq) || nq.includes(nt);
  if (!namesMatch) return false;
  if (second && normalizeName(second.name) === nt) return false;
  return true;
}

// The Call List's only job is holding businesses someone put there on
// purpose — via Kanban drag (stage -> qualified/pre_called/visit_planned/
// rescheduled) or the quick-add below. It used to also geolocate the
// browser and sort nearest-first (crm-spec.md 2b's "location-sort" idea);
// that's gone per direct product direction — this is a schedule now, not
// a route planner, and no tab should be popping a location permission
// prompt. Sort is: scheduled calls grouped by day-of-week and ordered
// earliest-to-latest by the pre-call block's logged start time, then an
// "Unscheduled" bucket (no start time logged yet) using the old
// due/overdue follow-up logic, then add-order. A day/time filter (below)
// can narrow this down further — see filterDays/timeFrom/timeTo.
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
  const [addErr, setAddErr] = useState("");

  // Batch-add: paste a list of names (one per line), each run through the
  // same add_lead pipeline as the single quick-add above. Confident matches
  // land immediately; anything ambiguous or unresolved is flagged below for
  // a manual pick, instead of blocking the whole batch on one uncertain line.
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState([]); // [{line, status, business, candidates, reason}]

  // Day-of-week + time-range filter — narrows the scheduled list down to
  // "who's free Wednesday afternoon", say. Empty/blank = no filter.
  const [dayFilter, setDayFilter] = useState(() => new Set());
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");

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
    setAddBusy(false);
  }

  // Runs every pasted line through search_place, auto-adding confident
  // matches and collecting the rest (no match, ambiguous match, or a
  // request error) into batchResults for review — see isConfidentMatch.
  async function runBatchAdd() {
    const lines = batchText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return;
    setBatchBusy(true);
    setBatchResults([]);
    const results = [];
    for (const line of lines) {
      try {
        const d = await adminApi.searchPlace(line);
        const places = d.places ?? [];
        if (!places.length) {
          results.push({ line, status: "flagged", reason: "No match found", candidates: [] });
          continue;
        }
        if (isConfidentMatch(line, places[0], places[1])) {
          await adminApi.addLead(places[0].place_id, places[0].name);
          results.push({ line, status: "added", business: places[0] });
        } else {
          results.push({ line, status: "flagged", reason: "Ambiguous match — pick one", candidates: places.slice(0, 3) });
        }
      } catch (e) {
        results.push({ line, status: "error", reason: e.message, candidates: [] });
      }
      // Show progress as each line finishes rather than only at the end.
      setBatchResults([...results]);
    }
    setBatchBusy(false);
    setRefreshToken((t) => t + 1);
  }

  async function pickBatchCandidate(line, hit) {
    try {
      await adminApi.addLead(hit.place_id, hit.name);
      setBatchResults((prev) =>
        prev.map((r) => (r.line === line ? { ...r, status: "added", business: hit, candidates: [] } : r)),
      );
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setBatchResults((prev) => prev.map((r) => (r.line === line ? { ...r, status: "error", reason: e.message } : r)));
    }
  }

  function dismissBatchLine(line) {
    setBatchResults((prev) => prev.map((r) => (r.line === line ? { ...r, status: "skipped" } : r)));
  }

  function toggleDayFilter(d) {
    setDayFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function clearFilters() {
    setDayFilter(new Set());
    setTimeFrom("");
    setTimeTo("");
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

  const dayFilterActive = dayFilter.size > 0;
  const timeFilterActive = Boolean(timeFrom || timeTo);

  function passesTimeFilter(row) {
    const start = row.contact.dm_window_start;
    if (timeFrom && start < timeFrom) return false;
    if (timeTo && start > timeTo) return false;
    return true;
  }

  // A business can be marked available on multiple days. Grouping it
  // under every one of those days would show the same call twice (or
  // more) in what's meant to be a single flat list — confusing when
  // counting "how many calls today" or checking one off. Instead, group
  // each business once, under the earliest day it's available (Mon..Sun
  // order) — still fully ordered within the day by start time.
  //
  // That dedup only makes sense for the full, unfiltered view though —
  // once the user has explicitly picked specific days to look at, a
  // business available on more than one of those days should show up
  // under each one they asked for (that's what filtering by day means).
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
    if (!passesTimeFilter(row)) continue;
    if (dayFilterActive) {
      if (!row.contact.dm_days.some((d) => dayFilter.has(d))) continue;
      for (const d of row.contact.dm_days) {
        if (!dayFilter.has(d)) continue;
        const i = DAYS.indexOf(d);
        if (i >= 0) byDay[i].push(row);
      }
    } else {
      const i = earliestDayIndex(row.contact.dm_days);
      (byDay[i] ?? byDay[byDay.length - 1]).push(row);
    }
  }
  for (const group of byDay) {
    group.sort((a, b) => a.contact.dm_window_start.localeCompare(b.contact.dm_window_start));
  }

  unscheduled.sort((a, b) => {
    if (a.followUpDue !== b.followUpDue) return a.followUpDue ? -1 : 1;
    if (a.followUpDue && b.followUpDue) return a.followUpAt - b.followUpAt;
    return new Date(a.business.created_at) - new Date(b.business.created_at);
  });

  // Unscheduled rows have no day/time to filter against — hide the bucket
  // entirely while a day/time filter is active rather than show a group
  // that can't actually match what was asked for.
  const showUnscheduled = !dayFilterActive && !timeFilterActive;

  const groups = [
    ...DAYS.map((day, i) => ({ label: day, rows: byDay[i] })),
    ...(showUnscheduled ? [{ label: "Unscheduled", rows: unscheduled }] : []),
  ].filter((g) => g.rows.length > 0);

  const filtersActive = dayFilterActive || timeFilterActive;
  const pendingBatch = batchResults.filter((r) => r.status === "flagged" || r.status === "error");
  const addedBatch = batchResults.filter((r) => r.status === "added");

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
        <button type="button" className="btn ghost sm" onClick={() => setBatchOpen((v) => !v)}>
          {batchOpen ? "Hide batch add" : "Batch add"}
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

      {batchOpen ? (
        <div className="call-list-batch">
          <textarea
            rows={4}
            placeholder={"One business name per line…\nBluebird Coffee\nKennedy St Barbershop"}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
            disabled={batchBusy}
          />
          <div className="call-list-batch-actions">
            <button type="button" className="btn sm" onClick={runBatchAdd} disabled={batchBusy || !batchText.trim()}>
              {batchBusy ? "Adding…" : "Add all"}
            </button>
            {batchResults.length > 0 && !batchBusy ? (
              <span className="call-row-meta">
                {addedBatch.length} added
                {pendingBatch.length ? `, ${pendingBatch.length} need review` : ""}
              </span>
            ) : null}
          </div>

          {pendingBatch.length > 0 ? (
            <ul className="call-list-rows batch-review-list">
              {pendingBatch.map((r) => (
                <li key={r.line}>
                  <div className="call-row-name">
                    “{r.line}” — <span style={{ fontWeight: 400, color: "var(--muted)" }}>{r.reason}</span>
                  </div>
                  {r.candidates?.length ? (
                    <div className="call-row-meta" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      {r.candidates.map((c) => (
                        <button
                          key={c.place_id}
                          type="button"
                          className="btn ghost sm"
                          onClick={() => pickBatchCandidate(r.line, c)}
                        >
                          {c.name}
                          {c.address ? ` — ${c.address}` : ""}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <button type="button" className="btn ghost sm" style={{ marginTop: 6 }} onClick={() => dismissBatchLine(r.line)}>
                    Skip
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="call-list-filters">
        <div className="filter-days">
          {DAYS.map((d) => (
            <button
              key={d}
              type="button"
              className={dayFilter.has(d) ? "day-on" : "day-off"}
              onClick={() => toggleDayFilter(d)}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="filter-time">
          <label>
            From
            <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
          </label>
        </div>
        {filtersActive ? (
          <button type="button" className="btn ghost sm" onClick={clearFilters}>
            Clear filters
          </button>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="empty">
          {q
            ? `No businesses match "${search}".`
            : filtersActive
              ? "Nothing matches this filter."
              : "Nothing to call right now."}
        </p>
      ) : null}

      {groups.map((group) => (
        <div key={group.label}>
          <div className="call-list-group-header">{group.label}</div>
          <ul className="call-list-rows">
            {group.rows.map(({ business, isVisited, contact, followUpAt, followUpDue }) => {
              const tel = contact?.phone ? telHref(contact.phone) : null;
              const window = contact ? formatWindow(contact) : null;
              return (
                <li key={business.id} className={isVisited ? "visited" : ""}>
                  <div className="call-row-main">
                    <div>
                      <div className="call-row-name">
                        {business.name}
                        {tel ? (
                          <a className="call-row-phone" href={tel} onClick={(e) => e.stopPropagation()}>
                            Call {contact.phone}
                          </a>
                        ) : null}
                      </div>
                      {window ? <div className="call-row-window">{window}</div> : null}
                      <div className="call-row-meta">
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
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
