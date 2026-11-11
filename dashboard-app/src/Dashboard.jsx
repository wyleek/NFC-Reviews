import React, { useState, useMemo, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart,
} from "recharts";
import {
  ChevronRight, Check, Calendar, Lightbulb, X, Pencil,
} from "lucide-react";

/* ==================================================================
   SUPABASE — publishable key only, safe for the client. RLS grants
   read-only SELECT on these tables/views; all writes go through the
   service-role Edge Functions (admin-api, redirect, sync-reviews).
   The one exception is the `rename_card` RPC — a narrowly-scoped
   security-definer function that can only edit a card's label, so the
   business owner can rename their own cards from this dashboard without
   the admin token. See supabase/migrations/*_dashboard_read_policies.sql
   and *_rename_card_rpc.sql.
================================================================== */

const SUPABASE_URL = "https://ehzwsqkrmxsfdfslxmpo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-O3QJN5_4bl9IdKHiVbjHA_02lN6s6o";
const REDIRECT_BASE = "https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/redirect";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const DAY_MS = 86400000;
// Calendar day in the viewer's local timezone — must stay local, not UTC,
// since it's used to bucket both local-midnight Date objects (below) and
// parsed tap timestamps (via `new Date(t.created_at)`) onto the same axis.
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// review_snapshots.captured_on is a plain "YYYY-MM-DD" date string, no
// time/zone — parse it as a local calendar date, same as every other date here.
const parseLocalDate = (dateStr) => { const [y, m, d] = dateStr.split("-").map(Number); return new Date(y, m - 1, d); };

// Most recent snapshot with captured_on <= dateStr (snapshots sorted ascending).
function snapshotAsOf(snapshots, dateStr) {
  let found = null;
  for (const s of snapshots) {
    if (s.captured_on > dateStr) break;
    found = s;
  }
  return found;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ==================================================================
   THEME — matched to the WM Marketing website (wmmarketing.agency):
   Inter Tight, black ink, navy accent, black editorial rules.
================================================================== */
const FONT = "'Inter Tight', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const INK = "#111111";      // --ink
const ACCENT = "#22357a";   // --accent (navy blue, charts + highlights)
const NAVY = "#1e2a4a";     // --navy (filled buttons)
const MUTED = "#5c626e";    // --muted
const LINE = "#dcdcdc";     // --hair — light hairlines inside panels / chart grid
const SOFT = "#c6cde3";     // light navy tint for secondary bars
const PILL = "#111111";     // black outline around every pill/panel (--rule)

/* ================================ bits ================================ */

// Panel = the "pill". Black 1px outline so each one stands out against the page.
const Panel = ({ children, className = "", style = {} }) => (
  <div className={`rounded-xl bg-white ${className}`} style={{ border: `1px solid ${PILL}`, ...style }}>{children}</div>
);

const Title = ({ children, sub }) => (
  <div className="mb-5">
    <div className="text-[15px] font-semibold" style={{ color: INK }}>{children}</div>
    {sub && <div className="text-[12px] mt-1" style={{ color: MUTED }}>{sub}</div>}
  </div>
);

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-lg px-3 py-2 shadow-md text-[12px]" style={{ border: `1px solid ${PILL}` }}>
      <div className="font-semibold mb-1" style={{ color: INK }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-5" style={{ color: MUTED }}>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums font-semibold" style={{ color: INK }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/* --------------------------- calendar picker --------------------------- */

function RangePicker({ today, minDate, onApply, onClose }) {
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [start, setStart] = useState(null);
  const [end, setEnd] = useState(null);

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const cells = Array(first.getDay()).fill(null);
    for (let i = 1; i <= last.getDate(); i++) cells.push(new Date(month.getFullYear(), month.getMonth(), i));
    return cells;
  }, [month]);

  const pick = (d) => {
    if (!start || (start && end)) { setStart(d); setEnd(null); }
    else if (d < start) { setEnd(start); setStart(d); }
    else setEnd(d);
  };
  const inRange = (d) => start && end && d > start && d < end;

  return (
    <div className="absolute right-0 top-11 z-30 bg-white rounded-xl shadow-lg p-4 w-[300px]" style={{ border: `1px solid ${PILL}` }}>
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                className="px-2 py-1 rounded hover:bg-[#f5f6f8] text-[15px]" style={{ color: MUTED }}>‹</button>
        <div className="text-[13px] font-semibold" style={{ color: INK }}>
          {month.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </div>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                className="px-2 py-1 rounded hover:bg-[#f5f6f8] text-[15px]" style={{ color: MUTED }}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-medium py-1" style={{ color: MUTED }}>{d}</div>
        ))}
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const sel = (start && d.getTime() === start.getTime()) || (end && d.getTime() === end.getTime());
          const mid = inRange(d);
          const future = d > today;
          const tooEarly = minDate && d < minDate;
          return (
            <button key={i} disabled={future || tooEarly} onClick={() => pick(d)}
              className="h-8 text-[12px] rounded-md transition disabled:opacity-25"
              style={{
                background: sel ? ACCENT : mid ? "#eef1f8" : "transparent",
                color: sel ? "#fff" : INK, fontWeight: sel ? 600 : 400,
              }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between pt-3 mt-2 border-t" style={{ borderColor: LINE }}>
        <div className="text-[11px]" style={{ color: MUTED }}>
          {start ? start.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Start"}
          {" – "}
          {end ? end.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "End"}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-2.5 py-1.5 text-[12px] rounded-md" style={{ color: MUTED }}>Cancel</button>
          <button disabled={!start || !end} onClick={() => onApply(start, end)}
                  className="px-3 py-1.5 text-[12px] rounded-md text-white font-medium disabled:opacity-35"
                  style={{ background: NAVY }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ data loading ============================ */

// Resolves which business(es) to show:
//   ?owner=<uuid>    → EVERY business that owner owns, for the switcher
//   ?business=<uuid> → that one business
//   (neither)        → most recently created business (single-tenant fallback)
// Returns a flat [{ id, name }] list; the switcher appears whenever it has >1.
function useResolvedBusinesses() {
  const [state, setState] = useState({ resolving: true, businesses: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const ownerId = params.get("owner");
      const bizId = params.get("business");
      let businesses = [];
      if (ownerId) {
        const { data } = await supabase
          .from("businesses").select("id, name").eq("owner_id", ownerId).order("name");
        businesses = data ?? [];
      } else if (bizId) {
        const { data } = await supabase
          .from("businesses").select("id, name").eq("id", bizId).maybeSingle();
        businesses = data ? [data] : [];
      } else {
        const { data } = await supabase
          .from("businesses").select("id, name").order("created_at", { ascending: false }).limit(1);
        businesses = data ?? [];
      }
      if (!cancelled) setState({ resolving: false, businesses });
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}

// Business, cards, full review-snapshot history — refetched only when the
// business changes, not on every range change.
function useBusinessData(businessId) {
  const [state, setState] = useState({ loading: true, business: null, cards: [], snapshots: [] });

  useEffect(() => {
    if (!businessId) { setState((s) => ({ ...s, loading: false })); return; }
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const [{ data: business }, { data: cards }, { data: snapshots }] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
        supabase.from("cards").select("*").eq("business_id", businessId).eq("active", true).order("created_at"),
        supabase.from("review_snapshots").select("captured_on, review_count, rating")
          .eq("business_id", businessId).order("captured_on"),
      ]);
      if (cancelled) return;
      setState({
        loading: false,
        business: business ?? null,
        cards: cards ?? [],
        snapshots: snapshots ?? [],
      });
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  return state;
}

// Lifetime (all-time) tap count per card — independent of the selected range,
// so each card can always show its true total. One light head-count per card.
function useLifetimeCardTaps(businessId, cards) {
  const [counts, setCounts] = useState({});
  const cardIdsKey = cards.map((c) => c.id).join(",");

  useEffect(() => {
    if (!businessId || !cards.length) { setCounts({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(cards.map(async (c) => {
        const { count } = await supabase
          .from("taps")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId).eq("card_id", c.id).eq("is_repeat", false);
        return [c.id, count ?? 0];
      }));
      if (!cancelled) setCounts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [businessId, cardIdsKey]);

  return counts;
}

// Raw taps for [priorStart, rangeEnd] — priorStart back-fills enough history
// for accurate snapshot forward-filling; current-period rows drive the
// per-card breakdown.
function useTaps(businessId, priorStart, rangeEnd) {
  const [state, setState] = useState({ loading: true, taps: [] });

  useEffect(() => {
    if (!businessId) { setState({ loading: false, taps: [] }); return; }
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const { data } = await supabase
        .from("taps")
        .select("card_id, device_type, created_at")
        .eq("business_id", businessId)
        .eq("is_repeat", false)
        .gte("created_at", priorStart.toISOString())
        .lt("created_at", addDays(rangeEnd, 1).toISOString());
      if (!cancelled) setState({ loading: false, taps: data ?? [] });
    })();
    return () => { cancelled = true; };
  }, [businessId, priorStart.getTime(), rangeEnd.getTime()]);

  return state;
}

/* ============================== dashboard ============================== */

export default function Dashboard() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [range, setRange] = useState(30);
  const [allTime, setAllTime] = useState(false);
  const [custom, setCustom] = useState(null);
  const [showCal, setShowCal] = useState(false);
  const [openCard, setOpenCard] = useState(null);
  const [cardSort, setCardSort] = useState("order"); // "order" | "taps"
  const [editingCard, setEditingCard] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [labelOverrides, setLabelOverrides] = useState({});
  const [cardErr, setCardErr] = useState(null);
  const wrapRef = useRef(null);

  const { resolving, businesses } = useResolvedBusinesses();
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => {
    if (businesses.length && !businesses.some((b) => b.id === selectedId)) {
      setSelectedId(businesses[0].id);
    }
  }, [businesses, selectedId]);
  const businessId = selectedId ?? businesses[0]?.id ?? null;

  const { loading: bizLoading, business, cards, snapshots } = useBusinessData(businessId);
  const lifetimeTaps = useLifetimeCardTaps(businessId, cards);

  // Reset per-business UI when switching dashboards.
  useEffect(() => {
    setOpenCard(null); setEditingCard(null); setLabelOverrides({}); setCardErr(null);
  }, [businessId]);

  const earliestTrackedDate = useMemo(
    () => (snapshots.length ? parseLocalDate(snapshots[0].captured_on) : null),
    [snapshots],
  );

  // "All time" reaches back to whichever is earliest: when the business was
  // onboarded, or the first review snapshot.
  const allTimeStart = useMemo(() => {
    const c = business?.created_at ? startOfDay(new Date(business.created_at)) : null;
    const e = earliestTrackedDate;
    if (c && e) return c < e ? c : e;
    return c || e || addDays(today, -364);
  }, [business, earliestTrackedDate, today]);

  const rawRangeStart = custom
    ? startOfDay(custom[0])
    : allTime
      ? allTimeStart
      : addDays(today, -(range - 1));
  const rangeEnd = custom ? startOfDay(custom[1]) : today;
  // Clamp the review line to when tracking actually began — but NOT in
  // all-time mode, where we want every tap included even before snapshots.
  const rangeStart = (!allTime && earliestTrackedDate && rawRangeStart < earliestTrackedDate)
    ? earliestTrackedDate
    : rawRangeStart;
  const wasClamped = rangeStart.getTime() !== rawRangeStart.getTime();
  const spanDays = Math.max(1, Math.round((rangeEnd - rangeStart) / DAY_MS) + 1);
  const priorStart = addDays(rangeStart, -spanDays);

  const { taps } = useTaps(businessId, priorStart, rangeEnd);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowCal(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const allDays = useMemo(() => {
    const out = [];
    const n = Math.round((rangeEnd - priorStart) / DAY_MS) + 1;
    for (let i = 0; i < n; i++) {
      const d = addDays(priorStart, i);
      const key = dateKey(d);
      const asOf = snapshotAsOf(snapshots, key);
      const row = {
        key, d,
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        taps: 0,
        reviews: asOf ? asOf.review_count : (snapshots[0]?.review_count ?? business?.current_review_count ?? null),
      };
      for (const c of cards) row[c.id] = 0;
      out.push(row);
    }
    return out;
  }, [priorStart.getTime(), rangeEnd.getTime(), snapshots, cards, business]);

  const dayIndex = useMemo(() => {
    const m = new Map();
    allDays.forEach((row, i) => m.set(row.key, i));
    return m;
  }, [allDays]);

  const bucketed = useMemo(() => {
    const rows = allDays.map((r) => ({ ...r }));
    for (const t of taps) {
      const i = dayIndex.get(dateKey(new Date(t.created_at)));
      if (i == null) continue;
      rows[i].taps += 1;
      if (t.card_id && rows[i][t.card_id] != null) rows[i][t.card_id] += 1;
    }
    return rows;
  }, [allDays, dayIndex, taps]);

  const data = useMemo(() => bucketed.filter((r) => r.d >= rangeStart), [bucketed, rangeStart]);

  const days = data.length || 1;
  const tapsInRange = data.reduce((s, d) => s + d.taps, 0);
  const revStart = data[0]?.reviews ?? null;
  const revEnd = data[data.length - 1]?.reviews ?? revStart;
  const revGained = revStart != null && revEnd != null ? revEnd - revStart : 0;

  const label = custom
    ? `${rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${rangeEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : allTime ? "All time"
    : range === 1 ? "Today"
    : `Last ${range} days`;

  const cardTapsInRange = (id) => data.reduce((s, d) => s + (d[id] ?? 0), 0);

  // Card order: as placed, or ranked by taps in the current period.
  const orderedCards = useMemo(() => {
    if (cardSort === "taps") return [...cards].sort((a, b) => cardTapsInRange(b.id) - cardTapsInRange(a.id));
    return cards;
  }, [cards, cardSort, data]);

  const cardLabel = (c) => labelOverrides[c.id] ?? c.label ?? "";

  async function saveCardName(cardId) {
    const next = editValue.trim();
    if (!next) { setEditingCard(null); return; }
    setCardErr(null);
    const { error } = await supabase.rpc("rename_card", { p_card_id: cardId, p_label: next });
    if (error) {
      setCardErr("Couldn't rename the card — please try again in a moment.");
      return;
    }
    setLabelOverrides((prev) => ({ ...prev, [cardId]: next }));
    setEditingCard(null);
  }

  const RECS = [
    {
      tag: "Staff habit",
      title: "Ask every customer, not just the happy-looking ones",
      body: "Google prohibits filtering who gets asked based on expected rating, so asking everyone honestly keeps your profile safe. Try saying: “If you enjoyed your experience today, we’d really appreciate a Google review — super simple, just tap right here.” Then demonstrate the tap for them; it takes them straight to the review page.",
    },
  ];

  if (resolving || (businessId && bizLoading)) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontFamily: FONT }}>Loading…</div>;
  }
  if (!businessId || !business) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontFamily: FONT, textAlign: "center", padding: 24 }}>
        No business found for this link. Check the dashboard URL, or onboard a business in admin.html.
      </div>
    );
  }

  return (
    <div style={{ background: "#fbfbfc", minHeight: "100vh", fontFamily: FONT }}>
      <div className="border-b bg-white sticky top-0 z-20" style={{ borderColor: PILL }}>
        <div className="max-w-[1080px] mx-auto px-6 h-14 flex items-center">
          <img src="/logo.png" alt="WM Marketing" style={{ height: 24, width: "auto" }} />
        </div>
      </div>

      <div className="max-w-[1080px] mx-auto px-6 py-10">
        {/* Dashboard switcher — one button per business the owner owns. */}
        {businesses.length > 1 && (
          <div className="flex flex-wrap gap-2 mb-7">
            {businesses.map((b) => {
              const on = b.id === businessId;
              return (
                <button key={b.id} onClick={() => setSelectedId(b.id)}
                  className="px-3.5 py-2 text-[13px] rounded-lg transition"
                  style={{
                    background: on ? NAVY : "#fff",
                    color: on ? "#fff" : INK,
                    border: `1px solid ${on ? NAVY : PILL}`,
                    fontWeight: on ? 600 : 500,
                  }}>
                  {b.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: MUTED }}>Review activity</div>
            <h1 className="text-[34px] font-bold tracking-tight" style={{ color: INK }}>{business.name}</h1>
            <div className="text-[13px] mt-1" style={{ color: MUTED }}>
              Live since {(earliestTrackedDate ?? new Date(business.created_at)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>

          <div className="relative ml-auto" ref={wrapRef}>
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#eef0f3", border: `1px solid ${PILL}` }}>
              {[1, 7, 30, 60].map((r) => {
                const on = !custom && !allTime && range === r;
                return (
                  <button key={r} onClick={() => { setRange(r); setCustom(null); setAllTime(false); setShowCal(false); }}
                    className="px-3 py-1.5 text-[13px] rounded-md transition"
                    style={{ background: on ? "#fff" : "transparent", color: on ? INK : MUTED,
                             fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none" }}>
                    {r === 1 ? "1d" : `${r}d`}
                  </button>
                );
              })}
              <button onClick={() => { setAllTime(true); setCustom(null); setShowCal(false); }}
                className="px-3 py-1.5 text-[13px] rounded-md transition"
                style={{ background: allTime ? "#fff" : "transparent", color: allTime ? INK : MUTED,
                         fontWeight: allTime ? 600 : 400, boxShadow: allTime ? "0 1px 2px rgba(0,0,0,.08)" : "none" }}>
                All
              </button>
              <button onClick={() => setShowCal(!showCal)}
                className="px-3 py-1.5 text-[13px] rounded-md transition flex items-center gap-1.5"
                style={{ background: custom || showCal ? "#fff" : "transparent", color: custom || showCal ? INK : MUTED,
                         fontWeight: custom || showCal ? 600 : 400, boxShadow: custom || showCal ? "0 1px 2px rgba(0,0,0,.08)" : "none" }}>
                <Calendar size={13} /> {custom ? label : "Custom"}
                {custom && <X size={12} onClick={(e) => { e.stopPropagation(); setCustom(null); }} />}
              </button>
            </div>
            {showCal && <RangePicker today={today} minDate={earliestTrackedDate} onClose={() => setShowCal(false)}
              onApply={(s, e) => { setCustom([s, e]); setAllTime(false); setShowCal(false); }} />}
            {wasClamped && !showCal && (
              <div className="text-[11px] text-right mt-1.5 whitespace-nowrap" style={{ color: MUTED }}>
                Showing from {rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — earliest tracked data
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-3">
          <Metric label="Taps" value={tapsInRange.toLocaleString()} sub={`${label.toLowerCase()} · ${(tapsInRange / days).toFixed(1)}/day`} />
          <Metric label="Google reviews" value={revEnd ?? "—"} sub={revStart != null ? `${revStart} at start of period` : "no snapshots yet"} />
          <Metric label="Reviews gained" value={revGained} sub={label.toLowerCase()} />
          <Metric label="Star rating" value={business.current_rating ?? "—"} sub="Google average" />
        </div>

        <Panel className="p-6 mb-3">
          <div className="flex items-start justify-between mb-5 flex-wrap gap-3">
            <Title sub="All cards combined">Taps and review growth</Title>
            <div className="flex items-center gap-4 text-[12px]" style={{ color: MUTED }}>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: SOFT }} /> Daily taps</span>
              <span className="flex items-center gap-1.5"><span className="w-4 h-[2px] rounded" style={{ background: ACCENT }} /> Total reviews</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={LINE} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(days / 6))} />
              <YAxis yAxisId="l" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: "#f2f3f6" }} />
              <Bar yAxisId="l" dataKey="taps" name="Taps" fill={SOFT} radius={[3, 3, 0, 0]} maxBarSize={18} />
              <Line yAxisId="r" dataKey="reviews" name="Total reviews" stroke={ACCENT} strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-5 pt-4 border-t text-[12px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
            Taps are counted exactly. Review totals come from your Google listing each day. Google doesn't reveal which
            review came from which tap, so these are shown side by side as trends — not one causing the other.
          </div>
        </Panel>

        <Panel className="mb-3 overflow-hidden">
          <div className="px-6 pt-6 flex items-start justify-between gap-3 flex-wrap">
            <Title sub={cards.length ? `${cards.length} cards placed · open a row for its own chart` : "No cards placed yet"}>By card</Title>
            {cards.length > 1 && (
              <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#eef0f3", border: `1px solid ${PILL}` }}>
                {[["order", "As placed"], ["taps", "Most taps"]].map(([v, l]) => {
                  const on = cardSort === v;
                  return (
                    <button key={v} onClick={() => setCardSort(v)}
                      className="px-3 py-1.5 text-[12px] rounded-md transition"
                      style={{ background: on ? "#fff" : "transparent", color: on ? INK : MUTED,
                               fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.08)" : "none" }}>
                      {l}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {cardErr && <div className="px-6 text-[12px]" style={{ color: "#c0392b" }}>{cardErr}</div>}
          {orderedCards.map((c) => {
            const cardTaps = cardTapsInRange(c.id);
            const share = Math.round((cardTaps / Math.max(1, tapsInRange)) * 100);
            const open = openCard === c.id;
            const lifetime = lifetimeTaps[c.id];
            const byWeekday = WEEKDAYS.map((name, i) => ({
              name, taps: data.filter((d) => d.d.getDay() === i).reduce((s, d) => s + (d[c.id] ?? 0), 0),
            }));
            const busiestDay = byWeekday.some((w) => w.taps > 0)
              ? [...byWeekday].sort((a, b) => b.taps - a.taps)[0].name
              : null;
            return (
              <div key={c.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <div className="w-full px-6 py-4 flex items-center gap-4 hover:bg-[#fafbfc] transition">
                  <button onClick={() => setOpenCard(open ? null : c.id)} className="shrink-0" aria-label="Toggle card detail">
                    <ChevronRight size={15} style={{ color: MUTED, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                  </button>
                  <div className="flex-1 min-w-0">
                    {editingCard === c.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={editValue}
                          autoFocus
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") saveCardName(c.id); if (e.key === "Escape") setEditingCard(null); }}
                          className="text-[14px] font-semibold px-2 py-1 rounded-md outline-none"
                          style={{ color: INK, border: `1px solid ${PILL}`, maxWidth: 220 }}
                        />
                        <button onClick={() => saveCardName(c.id)} className="text-[12px] font-semibold px-2 py-1 rounded-md text-white" style={{ background: NAVY }}>Save</button>
                        <button onClick={() => setEditingCard(null)} className="text-[12px] px-2 py-1 rounded-md" style={{ color: MUTED }}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group">
                        <span className="text-[14px] font-semibold" style={{ color: INK }}>{cardLabel(c) || "Untitled card"}</span>
                        <button
                          onClick={() => { setEditingCard(c.id); setEditValue(cardLabel(c)); setCardErr(null); }}
                          className="opacity-50 hover:opacity-100 transition" aria-label="Rename card" title="Rename card">
                          <Pencil size={12} style={{ color: MUTED }} />
                        </button>
                      </div>
                    )}
                    <div className="text-[12px] capitalize" style={{ color: MUTED }}>{c.card_type}</div>
                  </div>
                  <div className="hidden sm:block w-28">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#eceef2" }}>
                      <div className="h-full rounded-full" style={{ width: `${share}%`, background: ACCENT }} />
                    </div>
                  </div>
                  <div className="text-right w-28">
                    <div className="text-[20px] font-bold tabular-nums" style={{ color: INK }}>{cardTaps}</div>
                    <div className="text-[11px]" style={{ color: MUTED }}>{share}% · {lifetime != null ? `${lifetime} all-time` : "…"}</div>
                  </div>
                </div>
                {open && (
                  <div className="px-6 pb-6 pt-1" style={{ background: "#fcfcfd" }}>
                    <ResponsiveContainer width="100%" height={130}>
                      <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={LINE} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(days / 5))} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
                        <Tooltip content={<Tip />} cursor={{ fill: "#eef0f4" }} />
                        <Bar dataKey={c.id} name="Taps" fill={ACCENT} radius={[2, 2, 0, 0]} maxBarSize={14} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-4 flex flex-wrap gap-6 text-[12px]" style={{ color: MUTED }}>
                      <span>Link: <code className="px-1.5 py-0.5 rounded" style={{ background: "#f2f3f6", color: INK }}>{REDIRECT_BASE.replace("https://", "")}/{c.slug}</code></span>
                      <span>Lifetime taps: <span style={{ color: INK, fontWeight: 600 }}>{lifetime != null ? lifetime : "…"}</span></span>
                      <span>Status: <span style={{ color: c.active ? "#1a7f4b" : "#c0392b" }}>{c.active ? "● Active" : "○ Inactive"}</span></span>
                      {busiestDay && <span>Busiest day: {busiestDay}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>

        <Panel className="p-6">
          <div className="flex items-center gap-2 mb-5">
            <Lightbulb size={14} style={{ color: MUTED }} />
            <div className="text-[15px] font-semibold" style={{ color: INK }}>What to do next</div>
          </div>
          <div className="space-y-2">
            {RECS.map((r, i) => (
              <div key={i} className="flex gap-4 p-4 rounded-lg" style={{ background: "#fafbfc", border: `1px solid ${LINE}` }}>
                <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5" style={{ background: "#e9edf6" }}>
                  <Check size={13} style={{ color: ACCENT }} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.1em] mb-1" style={{ color: ACCENT }}>{r.tag}</div>
                  <div className="text-[14px] font-semibold mb-1" style={{ color: INK }}>{r.title}</div>
                  <div className="text-[13px] leading-relaxed" style={{ color: MUTED }}>{r.body}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

/* Metric pill — its own black-outlined panel. */
function Metric({ label, value, sub }) {
  return (
    <div className="flex-1 min-w-[160px] px-6 py-6 rounded-xl bg-white" style={{ border: `1px solid ${PILL}` }}>
      <div className="text-[11px] uppercase tracking-[0.1em] mb-3" style={{ color: MUTED }}>{label}</div>
      <div className="text-[46px] leading-[0.9] font-bold tabular-nums tracking-tight" style={{ color: INK }}>{value}</div>
      {sub && <div className="text-[12px] mt-2.5" style={{ color: MUTED }}>{sub}</div>}
    </div>
  );
}
