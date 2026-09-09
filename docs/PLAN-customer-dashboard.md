# Customer Dashboard — Master Build Plan (Claude Code Handoff)

> Checked into the repo from the original handoff doc so every module branch
> (A–I) has it as a committed reference, matching the `docs/PLAN.md` /
> `docs/PLAN-hub.md` convention. This is a **separate** plan from
> `docs/PLAN.md` (the internal console/hub) — see that doc's "What's already
> here" section for the CRM/ops side this new app's `foundation` branch
> builds alongside, not on top of. See `docs/BRANCH_BRIEF-foundation.md`
> for the as-built foundation branch, including where it deviates from
> §3 below.

**Product:** WM Marketing recurring GBP reputation service
**Goal:** Build the customer-facing dashboard as a full stack of features, each in its own branch/session, all merged into a *new* customer app hub.
**Workflow:** Foundation first. Then one module = one branch = one Claude Code session (plan mode → build → merge). No session touches another module's files; modules talk only through the shared data model and documented interfaces.

---

## 0. Core principles (apply to every session)

- **This is a NEW customer-facing app — not the internal hub.** The existing hub (CRM/ops) is for you and your partner only. This build is a separate multi-tenant app that *clients* log into. Both frontends share one Supabase backend; RLS separates tenants, and internal staff get elevated access. Phase 0's data model serves both.
- **Two layers, different data sources, different honesty bar.**
  - *Cold layer (no login, lives on the marketing site — NOT in the tabbed app):* free report from **Google Places API** — trust only total review count, rating, category, and rank/gap derived from counts. Freshness/velocity from the ≤5 "visible" reviews is unreliable; do not headline it.
  - *Warm layer (login + GBP connected — the tabbed app):* full dashboard from **GBP API + Performance API** — true velocity, freshness, response rate, keyword search terms, full review history.
- **Multi-tenant from row zero.** Every tenant-scoped table carries `org_id`; RLS enforces isolation. Reseller-ready — but the dashboard relationship always stays with the business owner, not the reseller.
- **One all-inclusive subscription.** No cheaper subset to retreat to; the default order is the whole stack. (Only exception: the customer review-request texting service — see Module I — which has real per-message cost and a heavier compliance profile.)
- **Owners choose their notification channel** — text, dashboard, or both — for review updates.
- **Compliance is a gate, not a cleanup.** No review gating anywhere (all flows straight to Google). AI replies are the owner's own responses (safe to post), approve-first by default. Owner-notification SMS and customer review-request SMS are SEPARATE A2P 10DLC campaigns. Taps→reviews is correlation, never causation. Places scraping uses a rolling ephemeral window; GBP data only for owner-managed locations.
- **Filter every feature by automability + recurring value.**

---

## 1. Beating the competitor (design intent)

Competitor: one recurring offer (~$100/mo software-only, +$25–35 plaque, no plaque required) with a free public report as the "no"-recovery funnel. Their weak point: the report's **"newest visible review" freshness metric is provably inaccurate** — Places returns ≤5 "most relevant" reviews, not the newest, so a busy place looks stale when it isn't.

Our edges, encoded below:
1. **Real velocity + baseline + projections, honestly** — full GBP history gives a true baseline; "since joining us" measured forward; competitive crossover projections from our corridor scrape.
2. **Longitudinal competitive intel** — "you moved #15 → #11 this quarter, here's who you passed."
3. **Keyword/search-gap** as a first-class recurring deliverable.
4. **SMS "reply YES" approval** as an owner-selectable default.
5. **Aggressively low, single-bundle pricing** — land-and-expand on relationships.

---

## 2. App architecture & navigation

Mobile-first tabbed app. Bottom tabs, each mapping to a feature grouping. Target ~5 tabs (compressible to 3).

**5-tab layout (default):**

| Tab | Contains | Modules |
|---|---|---|
| **Home** | Key numbers (times seen, actions, taps, taps→reviews), AI insight of the day, weighted rank + reviews-to-#1, velocity + projection headline | E (summary), G (summary), B/D (summary) |
| **Reviews** | Review feed, AI-drafted replies, approve / "say YES", response rate, per-review notification toggle | B, C |
| **Insights** | Themes (say / fix first), keyword & search gaps, competitive intel, full velocity + projection charts | D, F, E (deep) |
| **Reports** | Monthly branded report archive/download | H |
| **Settings** | Notification channel (text/dashboard/both), brand voice, cards/plaque, account/billing, review-request service status | B0, I, prefs |

**3-tab compression (if it fits cleaner):** Home / Reviews / Insights — fold Reports into Home, move Settings behind a gear icon.

Cold report is **not** a tab; it's a public marketing-site tool.

---

## 3. Phase 0 — Shared Foundation `branch: foundation`

Build and merge before any module branch opens.

**3.1 Data model + RLS (multi-tenant)** — extend existing CRM (`businesses`, `activities`, `deals`, `scheduled_messages`) with:

| Table | Key columns | Purpose |
|---|---|---|
| `organizations` | id, name | Tenant root (reseller-ready) |
| `locations` | id, business_id, org_id, gbp_location_name, place_id, connected_at, sync_status | A managed GBP location |
| `oauth_tokens` | org_id, location_id, access, refresh, scope, expiry | GBP auth (encrypted) |
| `notification_preferences` | org_id, location_id, review_updates_channel (text/dashboard/both), phone | Owner's channel choice |
| `reviews` | id, location_id, org_id, gbp_review_id, author, rating, comment, create_time, reply_text, reply_time, synced_at | Synced reviews (full history) |
| `ai_reply_drafts` | id, review_id, draft_text, status(pending/approved/posted/rejected/edited), approved_by, posted_at | Draft → post pipeline |
| `review_snapshots` | id, place_id, snapshot_at, total_count, avg_rating | Velocity from scraper (cold + competitors) — **shipped as `place_review_snapshots`, see BRANCH_BRIEF-foundation.md** (name collision with the pre-existing CRM `review_snapshots` table) |
| `brand_voice` | location_id, tone_profile(jsonb), sample_replies, website_url | Reply generation |
| `themes` | id, location_id, period, label, sentiment, sample_quote, mention_count, trend | Themes output |
| `cards` | id, location_id, type, redirect_slug, active | NFC redirect targets |
| `tap_events` | id, card_id, location_id, occurred_at, device_type, geo_coarse | Tap analytics |
| `performance_metrics` | id, location_id, date, impressions, searches, actions(jsonb), keywords(jsonb) | Performance API |
| `review_requests` | id, location_id, customer_phone_hash, consent_source, consent_at, sent_at, status | Customer outreach (Module I) |
| `reports` | id, token, place_id, generated_at, payload(jsonb), cta_clicked | Cold reports |

**3.2 GBP auth + location picker** — OAuth (`business.manage`, sensitive, no CASA). Fix the callback: do **not** auto-grab `locations[0]`. Stage locations → standalone picker page for multi-location owners; single-location gets guard-first auto-select. Email for GBP manager access must equal the API-application email.

**3.3 Sync layer** — Edge Function + `pg_cron` polling `reviews.list` every few hours (paginating full history on first sync) → upsert `reviews`. Heartbeat for every warm module. **Shipped as `gbp-review-sync`** (not `sync-reviews` — that name is already a live, unrelated CRM function).

**3.4 App shell** — React tabbed shell: auth, tenant context, bottom-tab nav, empty tab slots. **Shipped as `client-dashboard/`** (a new top-level app directory, not built on the existing `dashboard-app/`).

**Done when:** a test org connects a GBP location, picks it, sees full review history synced behind an isolated tenant boundary, and can set a notification channel.

---

## 4. Module catalog (each = one branch/session)

### A. Cold Report `branch: feature/cold-report`
Public `/report/{token}` lead magnet (marketing site). Places details + competitor set → weighted rank + gap-to-#1 + AI theme summary from visible reviews + website audit → store `reports.payload` → CTA. **Independent of GBP auth** (parallel-safe). Automability: full. Tier: acquisition (not billed). Compliance: headline only Places-supported facts; honest freshness.

### B0. Brand Voice Onboarding `branch: feature/brand-voice`
Capture tone at onboarding; learn from website + past replies. Feeds B and C. Build before B is useful.

### B. Review Feed + AI Replies (approve-first) `branch: feature/review-replies`
Core product. Feed UI; draft generator (brand voice + review + few-shot past replies); approve/edit/reject → post via `updateReply`. **Approve-first only, no full-auto.** Surfaces in Reviews tab. Depends on B0. Compliance: nothing posts without approval.

### C. Notification Delivery + SMS "Reply YES" `branch: feature/notifications`
Honors the owner's channel choice (text / dashboard / both). Dashboard path = in-app queue + badge. Text path = "New 5★ from Jane. Draft: '…' Reply YES to post" → inbound YES handler posts the reply. Reuses `scheduled_messages`. Depends on B, A2P 10DLC (owner campaign) live. Compliance: owner-only recipients.

### D. Themes Engine `branch: feature/themes`
Summarize full review history into positive (double down) / negative (fix first) themes with quotes, counts, trend. Insights tab. Depends on Phase 0. Automability: full.

### E. Velocity + Baseline + Projections + Competitive Intel `branch: feature/velocity-rank`
- **Baseline:** pull full history via `reviews.list`, bucket by month, compute trailing-12-mo average (and since-first-review). This is how far back you can go — *all the way*, for connected clients.
- **Since-joining:** stamp `connected_at`; measure velocity forward vs baseline.
- **Projections:** `current_total + velocity × months` → milestone dates. **Crossover projection:** model competitor velocity (from `review_snapshots`) alongside client's → "you overtake #12 in ~11 months." Rating-milestone projections kept directional (depends on incoming star mix).
- **Rank:** weighted rank vs corridor; "who you passed this quarter."

Home (summary) + Insights (deep). Depends on Phase 0 + corridor scrape. **Reads `place_review_snapshots`, not `review_snapshots`** — see BRANCH_BRIEF-foundation.md.

### F. Keyword / Search Gap `branch: feature/keyword-gaps`
Performance API — search terms that found them vs. what reviews mention → review-prompt + content recs. Insights tab. Depends on Phase 0 + Module D. Automability: full.

### G. Tap Analytics `branch: feature/tap-analytics`
Redirect-layer events (taps, timestamps, device, coarse geo, which card) + taps→reviews correlation. Home summary. Depends on Phase 0 (`tap_events`, `cards`) + redirect infra. Compliance: correlation, not causation.

### H. Monthly Branded Report `branch: feature/monthly-report`
Scheduled branded PDF/email assembling B/D/E/F/G. Reports tab. Retention tool. **Build last** (aggregates others).

### I. Customer Review-Request Texting (add-on) `branch: feature/review-request-outreach`
**Purpose:** automatically text a business's *own* consented customers a review request pointing to the same Google link the NFC card uses.
**Best-fit businesses:** appointment-based (salons, barbers, nail, auto, dental, chiro, med spa, vet, gym, home services) — they already hold a consented number + a clean "visit ended" trigger. Medical = careful tier-two (HIPAA: no condition implied, marketing opt-in required). Quick retail/coffee only if they run rewards or texted receipts.
**Two service modes:**
- *Mode A — configure their existing tool* (Square/Toast/Clover receipts, booking platform, rewards app) to fire a post-visit review request. Lower cost, one-time setup fee.
- *Mode B — host it:* webhook from their POS/booking system (or a "text for receipt / join rewards" capture you set up) → consented customers → delayed automated send.
**Cost:** separate consumer-facing A2P 10DLC campaign (distinct from owner campaign) + ~1¢/text; real cost is labor + registration.
**Pricing:** the ONE exception to the single bundle — setup-fee add-on, or bundled only for appointment businesses as the hook.
**Compliance (hard lines):** customer must have opted in (transaction/relationship-based); every message carries STOP/opt-out + business identity; never purchased or scraped lists; store consent source + timestamp (`review_requests`). Depends on Phase 0; sequence late.

---

## 5. Dependency graph / merge order

```
Phase 0 (foundation)  ─────────────────────────────────────────┐
   ├── A cold-report        (parallel; Places-only)             │
   ├── B0 brand-voice ──► B review-replies ──► C notifications  │
   ├── D themes ─────────────────► F keyword-gaps               │
   ├── E velocity/baseline/projections                          │
   ├── G tap-analytics                                          │
   └── I review-request-outreach (late; heavier compliance)     │
                                                                ▼
                        H monthly-report (aggregates B,D,E,F,G) = LAST
```

**Recommended sequence:** Foundation → A → B0 → B → D → E → G → C → F → I → H.

---

## 6. Pricing (single all-inclusive bundle — climb with proof)

Price on value delivered, not cost. Margin sets the floor; the competitor's $100 and your provable results set the ceiling. Pre-launch you have no documented outcomes yet, so the first cohort's real job is proof (case studies, testimonials, references) — that's what unlocks higher prices, reseller recruiting, and B2C credibility later.

- **Founding: $49/mo, locked for life** — first ~15–25 clients. Rewards them for betting on an unproven vendor; buys reference clients. ($29 underprices the value and signals "cheap"; $49 still tells a clean "half the competitor" story.)
- **Standard: $79/mo** — once 2–3 outcomes are documented (~60–90 days in). Pitch: "same features as [competitor], documented results, better price." Deliberately under their $100 so there's a reason to switch.
- **Headroom: $99/mo** — premium segments (med spa, auto, multi-location) or once results are undeniable. Don't match their exact $100; sit just under it. Avoid $97 charm-pricing in face-to-face SMB sales — a clean $79/$99 reads more confident.
- **Hardware: $30–50 one-time**, separate. **Annual prepay: pay 10, get 12.**
- **All-inclusive** — every module A–H in one bundle, no à-la-carte. **Only exception:** Module I (customer review-request texting) — setup-fee add-on.

At ~$60–70 fully-loaded CAC, even the $49 founding rate breaks even in ~6 weeks; everything after is margin. Retention glue = monthly report + themes + one-tap replies + the "since joining" velocity proof.

---

## 7. Compliance checklist (verify per module)

- [ ] No review gating anywhere — all flows to Google.
- [ ] AI replies never post without approval (v1); full-auto deferred.
- [ ] Owner-notification SMS: owners only; A2P 10DLC owner campaign registered.
- [ ] Customer review-request SMS (Module I): SEPARATE consumer 10DLC campaign; opt-in consent stored; STOP + business identity on every message; no purchased/scraped lists; HIPAA care for medical.
- [ ] Taps→reviews framed as correlation.
- [ ] Places scraping stays on rolling ephemeral window.
- [ ] GBP data only for owner-managed locations; identical email across manager access + API app.
- [ ] Cold report claims only Places-supported facts; freshness framed honestly.

---

## 8. Open items

1. **Final monthly number** — starting points in §6 ($29 founding / $49 standard); your call.
2. **Module I pricing** — setup-fee add-on vs. bundle-for-appointment-businesses.
3. **Single- vs multi-location guard** — confirmed: the picker (`client-dashboard/src/pages/ConnectPicker.jsx`) requires an explicit click even for a single staged location; see `docs/BRANCH_BRIEF-foundation.md`.
4. **Tab count** — start 5, compress to 3 if it fits cleaner once built.
