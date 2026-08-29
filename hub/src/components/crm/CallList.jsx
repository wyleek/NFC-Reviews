import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { distanceMeters, formatDistance } from "../../lib/geo";
import { CALL_LIST_STAGES, STAGE_LABELS } from "../../lib/stages";
import { PreCallLogForm } from "./PreCallLogForm";

const BUSINESS_FIELDS =
  "id, name, stage, google_place_id, tier, rank_score, category_group, corridor, " +
  "best_callback_window, do_not_contact, follow_up_at";

// crm-spec.md 2b: "Location-sort the list so the nearest un-visited
// business floats to the top." This is that view — separate from the
// board, since it's a route-planning tool for the pre-call block
// (lead-engine-spec.md §5), not a pipeline overview.
export function CallList({ search = "" }) {
  const [businesses, setBusinesses] = useState([]);
  const [places, setPlaces] = useState({}); // google_place_id -> {lat, lng}
  const [visited, setVisited] = useState(new Set()); // business_id
  const [contacts, setContacts] = useState({}); // business_id -> contact
  const [userLoc, setUserLoc] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [loggingFor, setLoggingFor] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setGeoError(err.message || "Location unavailable — showing unsorted."),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }, []);

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
    const placeIds = list.map((b) => b.google_place_id).filter(Boolean);

    const [placesRes, activitiesRes, contactsRes] = await Promise.all([
      placeIds.length
        ? supabase.from("places_lookup_cache").select("google_place_id, lat, lng").in("google_place_id", placeIds)
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase.from("activities").select("business_id, type").eq("type", "visit").in("business_id", ids)
        : Promise.resolve({ data: [] }),
      ids.length
        ? supabase.from("contacts").select("*").eq("is_primary", true).in("business_id", ids)
        : Promise.resolve({ data: [] }),
    ]);

    const placeMap = {};
    for (const p of placesRes.data ?? []) placeMap[p.google_place_id] = { lat: p.lat, lng: p.lng };
    const contactMap = {};
    for (const c of contactsRes.data ?? []) contactMap[c.business_id] = c;

    setBusinesses(list);
    setPlaces(placeMap);
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

  if (loading) return <div className="board-status">Loading call list…</div>;
  if (error) return <div className="board-status error">{error}</div>;

  const q = search.trim().toLowerCase();
  const filtered = q ? businesses.filter((b) => b.name?.toLowerCase().includes(q)) : businesses;

  const rows = filtered
    .map((b) => {
      const loc = places[b.google_place_id];
      const distance = userLoc && loc?.lat != null && loc?.lng != null
        ? distanceMeters(userLoc.lat, userLoc.lng, loc.lat, loc.lng)
        : null;
      const followUpAt = b.follow_up_at ? new Date(b.follow_up_at) : null;
      return {
        business: b,
        distance,
        isVisited: visited.has(b.id),
        contact: contacts[b.id],
        followUpAt,
        followUpDue: followUpAt != null && followUpAt.getTime() <= Date.now(),
      };
    })
    // A due/overdue follow-up trumps everything else — that's a specific
    // commitment ("call back Thursday 2pm"), not a general prioritization
    // signal. Below that: nearest-unvisited-first — unvisited before
    // visited, then by distance (unknown distance sorts last within its
    // group), then tier, then rank_score — the latter two are usually
    // still null until the scoring job (lead-engine-spec.md §3.2) is built.
    .sort((a, b) => {
      if (a.followUpDue !== b.followUpDue) return a.followUpDue ? -1 : 1;
      if (a.followUpDue && b.followUpDue) return a.followUpAt - b.followUpAt;
      if (a.isVisited !== b.isVisited) return a.isVisited ? 1 : -1;
      if (a.distance != null && b.distance != null) return a.distance - b.distance;
      if (a.distance != null) return -1;
      if (b.distance != null) return 1;
      if (a.business.tier && b.business.tier) return a.business.tier.localeCompare(b.business.tier);
      return (b.business.rank_score ?? 0) - (a.business.rank_score ?? 0);
    });

  return (
    <div className="call-list">
      {geoError ? <p className="board-status error">{geoError}</p> : null}
      {!userLoc && !geoError ? <p className="board-status">Getting your location…</p> : null}
      {rows.length === 0 ? (
        <p className="empty">{q ? `No businesses match "${search}".` : "Nothing to call right now."}</p>
      ) : null}
      <ul className="call-list-rows">
        {rows.map(({ business, distance, isVisited, contact, followUpAt, followUpDue }) => (
          <li key={business.id} className={isVisited ? "visited" : ""}>
            <div className="call-row-main">
              <div>
                <div className="call-row-name">{business.name}</div>
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
                  {distance != null ? <span>{formatDistance(distance)}</span> : <span>distance unknown</span>}
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
  );
}
