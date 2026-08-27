import React, { useState, useMemo, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Cell,
} from "recharts";
import {
  ChevronRight, Smartphone, Zap, Check, Calendar, ArrowUpRight,
  Trophy, Lightbulb, X,
} from "lucide-react";

/* ==================================================================
   SUPABASE — publishable key only, safe for the client. RLS grants
   read-only SELECT on these tables/views; all writes go through the
   service-role Edge Functions (admin-api, redirect, sync-reviews).
   See supabase/migrations/*_dashboard_read_policies.sql.
================================================================== */

const SUPABASE_URL = "https://ehzwsqkrmxsfdfslxmpo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-O3QJN5_4bl9IdKHiVbjHA_02lN6s6o";
const REDIRECT_BASE = "https://ehzwsqkrmxsfdfslxmpo.functions.supabase.co/redirect";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const DAY_MS = 86400000;
// Calendar day in the viewer's local timezone — must stay local, not UTC,
// since it's used to bucket both local-midnight Date objects (below) and
// parsed tap timestamps (via `new Date(t.created_at)`) onto the same axis
// as the already-local "busiest hours" breakdown.
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getTime() + n * DAY_MS);
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

// Most recent snapshot with captured_on <= dateStr (snapshots must be sorted ascending).
function snapshotAsOf(snapshots, dateStr) {
  let found = null;
  for (const s of snapshots) {
    if (s.captured_on > dateStr) break;
    found = s;
  }
  return found;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOUR_BUCKETS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]; // 6a – 7p
const hourLabel = (h) => (h === 12 ? "12p" : h > 12 ? `${h - 12}p` : `${h}a`);

const INK = "#12141a", ACCENT = "#2f5eff", MUTED = "#8a8f9a", LINE = "#e8e9ed", SOFT = "#c9d4ff";

/* ================================ bits ================================ */

const Panel = ({ children, className = "", style = {} }) => (
  <div className={`border rounded-xl bg-white ${className}`} style={{ borderColor: LINE, ...style }}>{children}</div>
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
    <div className="bg-white border rounded-lg px-3 py-2 shadow-md text-[12px]" style={{ borderColor: LINE }}>
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

function RangePicker({ today, onApply, onClose }) {
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
    <div className="absolute right-0 top-11 z-30 bg-white border rounded-xl shadow-lg p-4 w-[300px]" style={{ borderColor: LINE }}>
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
          return (
            <button key={i} disabled={future} onClick={() => pick(d)}
              className="h-8 text-[12px] rounded-md transition disabled:opacity-25"
              style={{
                background: sel ? ACCENT : mid ? "#eef2ff" : "transparent",
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
                  style={{ background: ACCENT }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

/* ============================ data loading ============================ */

// Resolves which business to show: ?business=<uuid> in the URL, or (until
// there's per-business login) the most recently created one.
function useBusinessId() {
  const [businessId, setBusinessId] = useState(null);
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromUrl = new URLSearchParams(window.location.search).get("business");
      if (fromUrl) { setBusinessId(fromUrl); setResolving(false); return; }
      const { data } = await supabase
        .from("businesses").select("id").order("created_at", { ascending: false }).limit(1);
      if (!cancelled) { setBusinessId(data?.[0]?.id ?? null); setResolving(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return { businessId, resolving };
}

// Business, cards, full review-snapshot history, competitors — refetched
// only when the business changes, not on every range change.
function useBusinessData(businessId) {
  const [state, setState] = useState({ loading: true, business: null, cards: [], snapshots: [], competitors: [] });

  useEffect(() => {
    if (!businessId) { setState((s) => ({ ...s, loading: false })); return; }
    let cancelled = false;
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const [{ data: business }, { data: cards }, { data: snapshots }, { data: competitors }] = await Promise.all([
        supabase.from("businesses").select("*").eq("id", businessId).maybeSingle(),
        supabase.from("cards").select("*").eq("business_id", businessId).order("created_at"),
        supabase.from("review_snapshots").select("captured_on, review_count, rating")
          .eq("business_id", businessId).order("captured_on"),
        supabase.from("competitors").select("id, name").eq("business_id", businessId),
      ]);
      if (cancelled) return;

      let competitorStats = [];
      if (competitors?.length) {
        const ids = competitors.map((c) => c.id);
        const [{ data: velocity }, { data: compSnaps }] = await Promise.all([
          supabase.from("competitor_velocity").select("*").in("competitor_id", ids),
          supabase.from("competitor_snapshots").select("competitor_id, rating, captured_on")
            .in("competitor_id", ids).order("captured_on"),
        ]);
        const latestRating = {};
        for (const s of compSnaps ?? []) latestRating[s.competitor_id] = s.rating; // last write wins (ascending order)
        competitorStats = (velocity ?? []).map((v) => ({
          name: v.name,
          reviews: v.review_count ?? 0,
          rating: latestRating[v.competitor_id] ?? null,
          gained30: v.reviews_gained ?? 0,
          velocity: v.reviews_per_month ?? 0,
        })).sort((a, b) => b.reviews - a.reviews);
      }

      setState({
        loading: false,
        business: business ?? null,
        cards: cards ?? [],
        snapshots: snapshots ?? [],
        competitors: competitorStats,
      });
    })();
    return () => { cancelled = true; };
  }, [businessId]);

  return state;
}

// Raw taps for [priorStart, rangeEnd] — enough to derive the current period,
// the prior period (for delta arrows), the per-card breakdown, device split,
// and hourly split, all from one query.
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
  const [custom, setCustom] = useState(null);
  const [showCal, setShowCal] = useState(false);
  const [openCard, setOpenCard] = useState(null);
  const wrapRef = useRef(null);

  const { businessId, resolving } = useBusinessId();
  const { loading: bizLoading, business, cards, snapshots, competitors } = useBusinessData(businessId);

  const rangeStart = custom ? startOfDay(custom[0]) : addDays(today, -(range - 1));
  const rangeEnd = custom ? startOfDay(custom[1]) : today;
  const spanDays = Math.max(1, Math.round((rangeEnd - rangeStart) / DAY_MS) + 1);
  const priorStart = addDays(rangeStart, -spanDays);
  const priorEnd = addDays(rangeStart, -1);

  const { loading: tapsLoading, taps } = useTaps(businessId, priorStart, rangeEnd);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowCal(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // One bucket per day in [priorStart, rangeEnd], each with a total, a count
  // per card, and a forward-filled cumulative review count from snapshots.
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
  const priorData = useMemo(() => bucketed.filter((r) => r.d < rangeStart), [bucketed, rangeStart]);

  const days = data.length || 1;
  const tapsInRange = data.reduce((s, d) => s + d.taps, 0);
  const revStart = data[0]?.reviews ?? null;
  const revEnd = data[data.length - 1]?.reviews ?? revStart;
  const revGained = revStart != null && revEnd != null ? revEnd - revStart : 0;

  const priorTaps = priorData.reduce((s, d) => s + d.taps, 0);
  const priorRevStart = priorData[0]?.reviews ?? revStart;
  const priorRevEnd = priorData[priorData.length - 1]?.reviews ?? priorRevStart;
  const priorRevGained = priorRevStart != null && priorRevEnd != null ? priorRevEnd - priorRevStart : 0;

  const pct = (now, before) => (!before ? null : Math.round(((now - before) / before) * 100));
  const tapDelta = pct(tapsInRange, priorTaps);
  const revDelta = pct(revGained, priorRevGained);
  const velocity = (revGained / days) * 30;

  const label = custom
    ? `${rangeStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${rangeEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : `Last ${range} days`;

  // Device + hourly splits, straight from the raw taps in the current range.
  const currentTaps = useMemo(
    () => taps.filter((t) => { const d = new Date(t.created_at); return d >= rangeStart && d < addDays(rangeEnd, 1); }),
    [taps, rangeStart.getTime(), rangeEnd.getTime()],
  );

  const DEVICES = useMemo(() => {
    const counts = { ios: 0, android: 0, other: 0 };
    for (const t of currentTaps) counts[t.device_type === "ios" || t.device_type === "android" ? t.device_type : "other"]++;
    const total = Math.max(1, currentTaps.length);
    return [
      { name: "iPhone", value: Math.round((counts.ios / total) * 100) },
      { name: "Android", value: Math.round((counts.android / total) * 100) },
      { name: "Other", value: Math.round((counts.other / total) * 100) },
    ];
  }, [currentTaps]);

  const HOURS = useMemo(() => {
    const counts = Object.fromEntries(HOUR_BUCKETS.map((h) => [h, 0]));
    for (const t of currentTaps) {
      const h = new Date(t.created_at).getHours();
      if (counts[h] != null) counts[h]++;
    }
    return HOUR_BUCKETS.map((h) => ({ h: hourLabel(h), v: counts[h] }));
  }, [currentTaps]);

  const peakHour = useMemo(() => Math.max(0, ...HOURS.map((h) => h.v)), [HOURS]);

  const busiestHours = useMemo(() => {
    const top = [...HOURS].sort((a, b) => b.v - a.v).filter((h) => h.v > 0).slice(0, 2);
    return top.map((h) => h.h).join(" and ");
  }, [HOURS]);

  const Metric = ({ label: l, value, delta, sub }) => (
    <div className="flex-1 min-w-[160px] px-6 py-6">
      <div className="text-[11px] uppercase tracking-[0.1em] mb-3" style={{ color: MUTED }}>{l}</div>
      <div className="flex items-end gap-2.5">
        <div className="text-[46px] leading-[0.9] font-bold tabular-nums tracking-tight" style={{ color: INK }}>{value}</div>
        {delta != null && (
          <div className="flex items-center gap-0.5 text-[13px] font-semibold mb-1.5"
               style={{ color: delta >= 0 ? "#1a7f4b" : "#c0392b" }}>
            <ArrowUpRight size={14} style={{ transform: delta >= 0 ? "none" : "rotate(90deg)" }} />
            {Math.abs(delta)}%
          </div>
        )}
      </div>
      {sub && <div className="text-[12px] mt-2.5" style={{ color: MUTED }}>{sub}</div>}
    </div>
  );

  const cardTapsInRange = (id) => data.reduce((s, d) => s + (d[id] ?? 0), 0);
  const topCard = cards.length
    ? [...cards].sort((a, b) => cardTapsInRange(b.id) - cardTapsInRange(a.id))[0]
    : null;
  const topCardShare = topCard ? Math.round((cardTapsInRange(topCard.id) / Math.max(1, tapsInRange)) * 100) : 0;

  const topCompetitor = competitors[0] ?? null;
  const ahead = topCompetitor ? competitors.filter((c) => c.reviews > (revEnd ?? 0)).length : 0;
  const gap = topCompetitor ? topCompetitor.reviews - (revEnd ?? 0) : 0;
  const netPace = topCompetitor ? Math.max(0.5, velocity - topCompetitor.velocity) : 0;

  const RECS = [
    topCompetitor && gap > 0 && {
      tag: "Close the gap",
      title: `You're ${gap} reviews behind ${topCompetitor.name}`,
      body: `You're gaining ${velocity.toFixed(1)} reviews a month to their ${topCompetitor.velocity}. Keep that up and you'd pass them in roughly ${Math.ceil(gap / netPace)} months. Adding a card at a second touchpoint is the fastest way to speed that up.`,
    },
    topCard && {
      tag: "Placement",
      title: `${topCard.label} drives ${topCardShare}% of your taps`,
      body: "Your other placements are underperforming by comparison. Move them to where customers are already standing still — waiting on an order, or paying.",
    },
    busiestHours && {
      tag: "Timing",
      title: `${busiestHours} ${busiestHours.includes(" and ") ? "are" : "is"} your busiest tap hour${busiestHours.includes(" and ") ? "s" : ""}`,
      body: "Remind whoever works those shifts to mention the card. A spoken ask alongside the stand consistently outperforms the stand sitting there on its own.",
    },
    {
      tag: "Staff habit",
      title: "Ask every customer, not just the happy-looking ones",
      body: "Google prohibits filtering who gets asked based on expected rating, and asking everyone honestly keeps your profile safe. Try: \"If you enjoyed it, we'd love your honest feedback — just tap here.\"",
    },
  ].filter(Boolean);

  if (resolving || (businessId && bizLoading)) {
    return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontFamily: "-apple-system, sans-serif" }}>Loading…</div>;
  }
  if (!businessId || !business) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: MUTED, fontFamily: "-apple-system, sans-serif", textAlign: "center", padding: 24 }}>
        No business found. Onboard one in admin.html, then open this dashboard with <code>?business=&lt;id&gt;</code>.
      </div>
    );
  }

  return (
    <div style={{ background: "#fbfbfc", minHeight: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div className="border-b bg-white sticky top-0 z-20" style={{ borderColor: LINE }}>
        <div className="max-w-[1080px] mx-auto px-6 h-14 flex items-center gap-2">
          <Zap size={16} style={{ color: ACCENT }} />
          <span className="text-[14px] font-semibold tracking-tight" style={{ color: INK }}>Tap2Review</span>
        </div>
      </div>

      <div className="max-w-[1080px] mx-auto px-6 py-10">
        <div className="flex items-end justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.14em] mb-2" style={{ color: MUTED }}>Review activity</div>
            <h1 className="text-[34px] font-bold tracking-tight" style={{ color: INK }}>{business.name}</h1>
            <div className="text-[13px] mt-1" style={{ color: MUTED }}>
              Live since {new Date(business.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </div>

          <div className="relative" ref={wrapRef}>
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#f5f6f8" }}>
              {[7, 30, 60].map((r) => {
                const on = !custom && range === r;
                return (
                  <button key={r} onClick={() => { setRange(r); setCustom(null); setShowCal(false); }}
                    className="px-3 py-1.5 text-[13px] rounded-md transition"
                    style={{ background: on ? "#fff" : "transparent", color: on ? INK : MUTED,
                             fontWeight: on ? 600 : 400, boxShadow: on ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>
                    {r}d
                  </button>
                );
              })}
              <button onClick={() => setShowCal(!showCal)}
                className="px-3 py-1.5 text-[13px] rounded-md transition flex items-center gap-1.5"
                style={{ background: custom ? "#fff" : "transparent", color: custom ? INK : MUTED,
                         fontWeight: custom ? 600 : 400, boxShadow: custom ? "0 1px 2px rgba(0,0,0,.06)" : "none" }}>
                <Calendar size={13} /> {custom ? label : "Custom"}
                {custom && <X size={12} onClick={(e) => { e.stopPropagation(); setCustom(null); }} />}
              </button>
            </div>
            {showCal && <RangePicker today={today} onClose={() => setShowCal(false)}
              onApply={(s, e) => { setCustom([s, e]); setShowCal(false); }} />}
          </div>
        </div>

        <Panel className="flex flex-wrap divide-x mb-3">
          <Metric label="Taps" value={tapsInRange.toLocaleString()} delta={tapDelta} sub={`${label.toLowerCase()} · ${(tapsInRange / days).toFixed(1)}/day`} />
          <Metric label="Google reviews" value={revEnd ?? "—"} sub={revStart != null ? `${revStart} at start of period` : "no snapshots yet"} />
          <Metric label="Reviews gained" value={`+${revGained}`} delta={revDelta} sub={label.toLowerCase()} />
          <Metric label="Star rating" value={business.current_rating ?? "—"} sub="Google average" />
        </Panel>

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
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
              <Tooltip content={<Tip />} cursor={{ fill: "#f7f8fa" }} />
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
          <div className="px-6 pt-6"><Title sub={cards.length ? `${cards.length} cards placed · open a row for its own chart` : "No cards placed yet"}>By card</Title></div>
          {cards.map((c) => {
            const cardTaps = cardTapsInRange(c.id);
            const share = Math.round((cardTaps / Math.max(1, tapsInRange)) * 100);
            const open = openCard === c.id;
            const byWeekday = WEEKDAYS.map((name, i) => ({
              name, taps: data.filter((d) => d.d.getDay() === i).reduce((s, d) => s + (d[c.id] ?? 0), 0),
            }));
            const busiestDay = byWeekday.some((w) => w.taps > 0)
              ? [...byWeekday].sort((a, b) => b.taps - a.taps)[0].name
              : null;
            return (
              <div key={c.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <button onClick={() => setOpenCard(open ? null : c.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-[#fafbfc] transition text-left">
                  <ChevronRight size={15} style={{ color: MUTED, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: INK }}>{c.label || "Untitled card"}</div>
                    <div className="text-[12px] capitalize" style={{ color: MUTED }}>{c.card_type}</div>
                  </div>
                  <div className="hidden sm:block w-28">
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#f0f1f4" }}>
                      <div className="h-full rounded-full" style={{ width: `${share}%`, background: ACCENT }} />
                    </div>
                  </div>
                  <div className="text-right w-24">
                    <div className="text-[20px] font-bold tabular-nums" style={{ color: INK }}>{cardTaps}</div>
                    <div className="text-[11px]" style={{ color: MUTED }}>{share}% of taps</div>
                  </div>
                </button>
                {open && (
                  <div className="px-6 pb-6 pt-1" style={{ background: "#fcfcfd" }}>
                    <ResponsiveContainer width="100%" height={130}>
                      <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke={LINE} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} interval={Math.max(0, Math.floor(days / 5))} />
                        <YAxis tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
                        <Tooltip content={<Tip />} cursor={{ fill: "#f2f4f8" }} />
                        <Bar dataKey={c.id} name="Taps" fill={ACCENT} radius={[2, 2, 0, 0]} maxBarSize={14} />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-4 flex flex-wrap gap-6 text-[12px]" style={{ color: MUTED }}>
                      <span>Link: <code className="px-1.5 py-0.5 rounded" style={{ background: "#f2f3f6", color: INK }}>{REDIRECT_BASE.replace("https://", "")}/{c.slug}</code></span>
                      <span>Status: <span style={{ color: c.active ? "#1a7f4b" : "#c0392b" }}>{c.active ? "● Active" : "○ Inactive"}</span></span>
                      {busiestDay && <span>Busiest day: {busiestDay}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>

        <div className="grid md:grid-cols-2 gap-3 mb-3">
          <Panel className="p-6">
            <div className="flex items-center gap-2">
              <Smartphone size={14} style={{ color: MUTED }} />
              <Title sub="Device type only — no personal information is collected">Phones used</Title>
            </div>
            {tapsInRange === 0
              ? <div className="text-[13px]" style={{ color: MUTED }}>No taps in this period yet.</div>
              : DEVICES.map((d, i) => (
                <div key={d.name} className="flex items-center gap-3 mb-3">
                  <div className="w-16 text-[13px]" style={{ color: INK }}>{d.name}</div>
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "#f0f1f4" }}>
                    <div className="h-full rounded-full" style={{ width: `${d.value}%`, background: ACCENT, opacity: 1 - i * 0.28 }} />
                  </div>
                  <div className="w-10 text-right text-[13px] tabular-nums font-medium" style={{ color: MUTED }}>{d.value}%</div>
                </div>
              ))}
          </Panel>

          <Panel className="p-6">
            <Title sub="When customers tap — good times to remind staff to ask">Busiest hours</Title>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={HOURS} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={LINE} />
                <XAxis dataKey="h" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} interval={1} />
                <YAxis tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
                <Tooltip content={<Tip />} cursor={{ fill: "#f7f8fa" }} />
                <Bar dataKey="v" name="Taps" radius={[2, 2, 0, 0]}>
                  {HOURS.map((h, i) => <Cell key={i} fill={h.v > 0 && h.v === peakHour ? ACCENT : SOFT} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        <Panel className="p-6 mb-3">
          <div className="flex items-center gap-2">
            <Trophy size={14} style={{ color: MUTED }} />
            <Title sub="Tracked daily from public Google listings">How you stack up nearby</Title>
          </div>
          {competitors.length === 0 ? (
            <div className="text-[13px]" style={{ color: MUTED }}>No competitors tracked yet — add one from admin.html.</div>
          ) : (
            <>
              <div className="space-y-1">
                {[{ name: business.name, reviews: revEnd ?? 0, rating: business.current_rating, gained30: Math.round(velocity), you: true }, ...competitors]
                  .sort((a, b) => b.reviews - a.reviews)
                  .map((c) => {
                    const max = Math.max(revEnd ?? 0, ...competitors.map((x) => x.reviews));
                    return (
                      <div key={c.name} className="flex items-center gap-4 py-2.5 px-3 rounded-lg"
                           style={{ background: c.you ? "#f5f8ff" : "transparent" }}>
                        <div className="w-40 shrink-0 text-[13px] truncate" style={{ color: INK, fontWeight: c.you ? 700 : 400 }}>
                          {c.name}
                          {c.you && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded align-middle" style={{ background: ACCENT, color: "#fff" }}>YOU</span>}
                        </div>
                        <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#f0f1f4" }}>
                          <div className="h-full rounded-full" style={{ width: `${max ? (c.reviews / max) * 100 : 0}%`, background: c.you ? ACCENT : "#d4d7de" }} />
                        </div>
                        <div className="w-12 text-right text-[15px] font-bold tabular-nums" style={{ color: INK }}>{c.reviews}</div>
                        <div className="w-10 text-right text-[12px] tabular-nums" style={{ color: MUTED }}>{c.rating != null ? `★${c.rating}` : "—"}</div>
                        <div className="w-20 text-right text-[12px] tabular-nums" style={{ color: c.you ? "#1a7f4b" : MUTED }}>
                          +{c.gained30}/mo
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-4 pt-4 border-t text-[12px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
                You're gaining <strong style={{ color: INK }}>{velocity.toFixed(1)} reviews a month</strong> versus{" "}
                {topCompetitor.velocity}/mo for {topCompetitor.name}.{" "}
                {ahead === 0 ? "You lead the neighborhood." : `${ahead} nearby ${ahead === 1 ? "business is" : "businesses are"} still ahead on total reviews.`}
              </div>
            </>
          )}
        </Panel>

        <Panel className="p-6">
          <div className="flex items-center gap-2">
            <Lightbulb size={14} style={{ color: MUTED }} />
            <Title sub="Based on your tap patterns this period">What to do next</Title>
          </div>
          <div className="space-y-2">
            {RECS.map((r, i) => (
              <div key={i} className="flex gap-4 p-4 rounded-lg" style={{ background: "#fafbfc" }}>
                <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5" style={{ background: "#eef2ff" }}>
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
