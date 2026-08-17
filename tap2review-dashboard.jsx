import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Cell,
} from "recharts";
import {
  ChevronRight, Smartphone, Zap, Check, Calendar, ArrowUpRight,
  Trophy, Lightbulb, X,
} from "lucide-react";

/* ==================================================================
   SAMPLE DATA — swap for Supabase queries when wiring up
================================================================== */

const BUSINESS = {
  name: "Bluebird Coffee",
  address: "1420 Kennedy St NW, Washington, DC",
  reviewsAtStart: 37,
  rating: 4.7,
  live: "Jun 8, 2026",
};

const CARDS = [
  { id: "counter", label: "Front counter", type: "stand",   slug: "bluebird-counter", lastTap: "12 min ago", weight: 0.60 },
  { id: "t4",      label: "Table 4",       type: "placard", slug: "bluebird-t4",      lastTap: "1 hr ago",   weight: 0.26 },
  { id: "badge",   label: "Manager badge", type: "badge",   slug: "bluebird-badge",   lastTap: "3 hr ago",   weight: 0.14 },
];

const TODAY = new Date(2026, 7, 16);

const SERIES = (() => {
  const out = [];
  let reviews = BUSINESS.reviewsAtStart;
  for (let i = 69; i >= 0; i--) {
    const d = new Date(TODAY); d.setDate(d.getDate() - i);
    const dow = d.getDay();
    const weekend = dow === 0 || dow === 6 ? 1.5 : 1;
    const ramp = 0.55 + (69 - i) / 69 * 0.9;
    const taps = Math.max(2, Math.round((6 + Math.sin(i / 3) * 3 + ((i * 37) % 11) * 0.6) * weekend * ramp));
    if ((i * 13) % 10 < 7) reviews += (i * 7) % 3 === 0 ? 2 : 1;
    out.push({
      key: d.toISOString().slice(0, 10),
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      d,
      taps, reviews,
      counter: Math.round(taps * 0.60),
      t4: Math.round(taps * 0.26),
      badge: Math.round(taps * 0.14),
    });
  }
  return out;
})();

const COMPETITORS = [
  { name: "Grind House Cafe",  reviews: 214, rating: 4.4, gained30: 9, velocity: 9.0 },
  { name: "The Daily Pour",    reviews: 96,  rating: 4.6, gained30: 4, velocity: 4.0 },
  { name: "Kennedy St Coffee", reviews: 61,  rating: 4.2, gained30: 2, velocity: 2.0 },
];

const HOURS = [
  { h: "6a", v: 4 }, { h: "7a", v: 18 }, { h: "8a", v: 41 }, { h: "9a", v: 37 },
  { h: "10a", v: 26 }, { h: "11a", v: 22 }, { h: "12p", v: 48 }, { h: "1p", v: 39 },
  { h: "2p", v: 24 }, { h: "3p", v: 19 }, { h: "4p", v: 15 }, { h: "5p", v: 11 },
  { h: "6p", v: 7 }, { h: "7p", v: 3 },
];

const DEVICES = [
  { name: "iPhone", value: 61 }, { name: "Android", value: 36 }, { name: "Other", value: 3 },
];

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

function RangePicker({ onApply, onClose }) {
  const [month, setMonth] = useState(new Date(2026, 7, 1));
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
          const future = d > TODAY;
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

/* ============================== dashboard ============================== */

export default function Dashboard() {
  const [range, setRange] = useState(30);
  const [custom, setCustom] = useState(null);
  const [showCal, setShowCal] = useState(false);
  const [openCard, setOpenCard] = useState(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowCal(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const data = useMemo(() => {
    if (custom) return SERIES.filter((s) => s.d >= custom[0] && s.d <= custom[1]);
    return SERIES.slice(-range);
  }, [range, custom]);

  const days = data.length || 1;
  const tapsInRange = data.reduce((s, d) => s + d.taps, 0);
  const revStart = data[0]?.reviews ?? BUSINESS.reviewsAtStart;
  const revEnd = data[data.length - 1]?.reviews ?? BUSINESS.reviewsAtStart;
  const revGained = revEnd - revStart;

  const prior = useMemo(() => {
    const endIdx = SERIES.findIndex((s) => s.key === data[0]?.key);
    const slice = SERIES.slice(Math.max(0, endIdx - days), Math.max(0, endIdx));
    return {
      taps: slice.reduce((s, d) => s + d.taps, 0),
      rev: slice.length ? slice[slice.length - 1].reviews - slice[0].reviews : 0,
    };
  }, [data, days]);

  const pct = (now, before) => (!before ? null : Math.round(((now - before) / before) * 100));
  const tapDelta = pct(tapsInRange, prior.taps);
  const revDelta = pct(revGained, prior.rev);
  const velocity = (revGained / days) * 30;

  const label = custom
    ? `${custom[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${custom[1].toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : `Last ${range} days`;

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

  const topCard = [...CARDS].sort((a, b) => b.weight - a.weight)[0];
  const ahead = COMPETITORS.filter((c) => c.reviews > revEnd).length;
  const gap = COMPETITORS[0].reviews - revEnd;
  const netPace = Math.max(0.5, velocity - COMPETITORS[0].velocity);

  const RECS = [
    gap > 0 && {
      tag: "Close the gap",
      title: `You're ${gap} reviews behind ${COMPETITORS[0].name}`,
      body: `You're gaining ${velocity.toFixed(1)} reviews a month to their ${COMPETITORS[0].velocity}. Keep that up and you'd pass them in roughly ${Math.ceil(gap / netPace)} months. Adding a card at a second touchpoint is the fastest way to speed that up.`,
    },
    {
      tag: "Placement",
      title: `${topCard.label} drives ${Math.round(topCard.weight * 100)}% of your taps`,
      body: "Your other placements are underperforming by comparison. Move them to where customers are already standing still — waiting on an order, or paying.",
    },
    {
      tag: "Timing",
      title: "8am and noon are your busiest tap hours",
      body: "Remind whoever works those shifts to mention the card. A spoken ask alongside the stand consistently outperforms the stand sitting there on its own.",
    },
    {
      tag: "Staff habit",
      title: "Ask every customer, not just the happy-looking ones",
      body: "Google prohibits filtering who gets asked based on expected rating, and asking everyone honestly keeps your profile safe. Try: \"If you enjoyed it, we'd love your honest feedback — just tap here.\"",
    },
  ].filter(Boolean);

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
            <h1 className="text-[34px] font-bold tracking-tight" style={{ color: INK }}>{BUSINESS.name}</h1>
            <div className="text-[13px] mt-1" style={{ color: MUTED }}>{BUSINESS.address} · Live since {BUSINESS.live}</div>
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
            {showCal && <RangePicker onClose={() => setShowCal(false)}
              onApply={(s, e) => { setCustom([s, e]); setShowCal(false); }} />}
          </div>
        </div>

        <Panel className="flex flex-wrap divide-x mb-3">
          <Metric label="Taps" value={tapsInRange.toLocaleString()} delta={tapDelta} sub={`${label.toLowerCase()} · ${(tapsInRange / days).toFixed(1)}/day`} />
          <Metric label="Google reviews" value={revEnd} sub={`${revStart} at start of period`} />
          <Metric label="Reviews gained" value={`+${revGained}`} delta={revDelta} sub={label.toLowerCase()} />
          <Metric label="Star rating" value={BUSINESS.rating} sub="Google average" />
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
              <Line yAxisId="r" dataKey="reviews" name="Total reviews" stroke={ACCENT} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-5 pt-4 border-t text-[12px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
            Taps are counted exactly. Review totals come from your Google listing each day. Google doesn't reveal which
            review came from which tap, so these are shown side by side as trends — not one causing the other.
          </div>
        </Panel>

        <Panel className="mb-3 overflow-hidden">
          <div className="px-6 pt-6"><Title sub={`${CARDS.length} cards placed · open a row for its own chart`}>By card</Title></div>
          {CARDS.map((c) => {
            const cardTaps = data.reduce((s, d) => s + d[c.id], 0);
            const share = Math.round((cardTaps / Math.max(1, tapsInRange)) * 100);
            const open = openCard === c.id;
            return (
              <div key={c.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <button onClick={() => setOpenCard(open ? null : c.id)}
                  className="w-full px-6 py-4 flex items-center gap-4 hover:bg-[#fafbfc] transition text-left">
                  <ChevronRight size={15} style={{ color: MUTED, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold" style={{ color: INK }}>{c.label}</div>
                    <div className="text-[12px] capitalize" style={{ color: MUTED }}>{c.type} · last tap {c.lastTap}</div>
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
                      <span>Link: <code className="px-1.5 py-0.5 rounded" style={{ background: "#f2f3f6", color: INK }}>tap2review.com/r/{c.slug}</code></span>
                      <span>Status: <span style={{ color: "#1a7f4b" }}>● Active</span></span>
                      <span>Busiest day: Saturday</span>
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
            {DEVICES.map((d, i) => (
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
                  {HOURS.map((h, i) => <Cell key={i} fill={h.v > 35 ? ACCENT : SOFT} />)}
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
          <div className="space-y-1">
            {[{ name: BUSINESS.name, reviews: revEnd, rating: BUSINESS.rating, gained30: Math.round(velocity), you: true }, ...COMPETITORS]
              .sort((a, b) => b.reviews - a.reviews)
              .map((c) => {
                const max = Math.max(revEnd, ...COMPETITORS.map((x) => x.reviews));
                return (
                  <div key={c.name} className="flex items-center gap-4 py-2.5 px-3 rounded-lg"
                       style={{ background: c.you ? "#f5f8ff" : "transparent" }}>
                    <div className="w-40 shrink-0 text-[13px] truncate" style={{ color: INK, fontWeight: c.you ? 700 : 400 }}>
                      {c.name}
                      {c.you && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded align-middle" style={{ background: ACCENT, color: "#fff" }}>YOU</span>}
                    </div>
                    <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "#f0f1f4" }}>
                      <div className="h-full rounded-full" style={{ width: `${(c.reviews / max) * 100}%`, background: c.you ? ACCENT : "#d4d7de" }} />
                    </div>
                    <div className="w-12 text-right text-[15px] font-bold tabular-nums" style={{ color: INK }}>{c.reviews}</div>
                    <div className="w-10 text-right text-[12px] tabular-nums" style={{ color: MUTED }}>★{c.rating}</div>
                    <div className="w-20 text-right text-[12px] tabular-nums" style={{ color: c.you ? "#1a7f4b" : MUTED }}>
                      +{c.gained30}/mo
                    </div>
                  </div>
                );
              })}
          </div>
          <div className="mt-4 pt-4 border-t text-[12px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
            You're gaining <strong style={{ color: INK }}>{velocity.toFixed(1)} reviews a month</strong> versus{" "}
            {COMPETITORS[0].velocity}/mo for {COMPETITORS[0].name}.{" "}
            {ahead === 0 ? "You lead the neighborhood." : `${ahead} nearby ${ahead === 1 ? "business is" : "businesses are"} still ahead on total reviews.`}
          </div>
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
