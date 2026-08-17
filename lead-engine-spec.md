# Lead Engine — Data Collection, Scoring & the Pre-Call Block

---

## 0. A correction to what I told you last time

I told you to grid-scrape a city into Supabase and hold it as a permanent prospect database. **The Google Maps Platform terms don't allow that**, and I checked properly this time rather than assuming.

The actual rules, as of the current terms:

| Data | May you store it? |
|---|---|
| `place_id` | <cite index="14-1">Yes — exempt from caching restrictions, storable indefinitely</cite> |
| Latitude / longitude | <cite index="13-1">Up to 30 consecutive days, then delete</cite> |
| Name, rating, review count, phone, hours, photos | <cite index="13-1">No caching exception — meant to be requested live, not warehoused</cite> |

<cite index="13-1">The Terms of Service also prohibit exporting, extracting, or scraping Google Maps Content for use outside the Services.</cite>

This matters to you more than it would to most people, because compliance is one of your actual selling points. You cannot pitch "we don't gate reviews because Google bans it" while running a warehouse of scraped Google data. Someone will eventually notice.

**It also affects the competitor-tracking dashboard feature I recommended last turn.** A permanent historical chart of a competitor's review count is stored Google Content. Fix: pull the *customer's own* metrics through the Google Business Profile API instead — the business owner authorizes access, so it's their data under different terms, and you get far richer numbers (profile views, search queries, direction requests, calls). Competitor counts stay live-fetched and displayed at request time, not charted historically.

### The architecture this forces — and why it's better anyway

Split your data into two layers:

**Durable layer (yours forever):** `place_id`, your visit history, your outcomes, your notes, contact info *you* collected, owner names from public records, your tier decision. None of this is Google Content.

**Ephemeral layer (30-day TTL, auto-purged):** everything from Places — name, address, coordinates, rating, review count, phone, hours.

You rebuild the ephemeral layer only for the corridor you're working in the next 30 days. Not the whole city.

This is operationally better than what I proposed. A city-wide scrape goes stale — ratings move, businesses close, "no" ages out. A rolling 30-day window covering your active territory is always fresh, costs a fraction, and is compliant. You were going to end up here anyway.

> Verify the current terms yourself before you build. Google revises these documents, and you're building a business on top of them.

---

## 1. What you can actually get, per business

### 1.1 Direct from Places API (Nearby Search, Enterprise field mask)

| Field | API name | Use |
|---|---|---|
| Place ID | `id` | Permanent key. The only thing you keep forever |
| Name | `displayName` | Call script, chain detection |
| Address | `shortFormattedAddress` | Routing |
| Coordinates | `location` | Density, corridor grouping |
| Category | `primaryType`, `types` | Tier assignment, call timing |
| **Rating** | `rating` | Hard qualifier |
| **Review count** | `userRatingCount` | Trial-vs-direct-sale routing |
| Phone | `nationalPhoneNumber` | **The pre-call block** |
| Hours | `regularOpeningHours` | When to call, when to walk |
| Website | `websiteUri` | Owner-name enrichment, upsell signal |
| Price level | `priceLevel` | Ticket size proxy |
| Status | `businessStatus` | Kill closed/temp-closed |
| Photo count | `photos` (array length) | GBP-optimization upsell signal |

### 1.2 Derived — computed by you, not fetched

These are where the real edge is. Nobody else prospecting has them.

| Metric | How | Why it matters |
|---|---|---|
| **Review velocity** | Δ`userRatingCount` between two pulls 14–30 days apart, ÷ days | Best free proxy for foot traffic. 60 reviews over 8 years ≠ 60 over 8 months |
| **Competitor gap** | Their `userRatingCount` vs. the median for their category within 1 mile | *This is literally your opening pitch line, precomputed* |
| **Chain flag** | Same `displayName` appearing 3+ times in the pull | Franchise/corporate detection. Best heuristic available |
| **Profile completeness** | Has website + hours + ≥10 photos | GBP optimization upsell trigger |
| **Photo gap** | Their photo count vs. category median nearby | "You have 4, they have 87" |
| **Walk density** | Qualifying prospects within 150m | Corridor prioritization |
| **Rating band** | 4.0–4.3 / 4.3–4.6 / 4.6+ | Risk tier |

**Review velocity is the sleeper.** Two pulls 21 days apart on the same corridor gives you a traffic estimate for every business on it. That solves the "I can't measure foot traffic" problem you'd otherwise have to solve by walking in.

**Competitor gap is the one to build first**, because it's not a filter — it's the sentence you say when the door opens. Precompute it and your pitch is customized before you walk in.

### 1.3 What Google will not give you

| Missing | Get it instead from |
|---|---|
| Owner's name | State corporate registry (see §4) |
| Owner-operated vs. franchise | Chain flag + registry |
| Actual foot traffic | Review velocity proxy |
| Whether they control their own GBP | Ask on the pre-call |
| Best time to find the owner | **Ask on the pre-call — this is the whole point** |
| Direct/back-line phone | Ask on the pre-call |

Notice how many of these the pre-call block solves. That's the argument for it: 30 seconds of phone time fills gaps that no amount of data engineering will.

---

## 2. Which businesses this is actually best for

Scored 1–5. **Priority** is the composite, weighted toward volume and placement quality since those drive whether the trial produces visible data.

| Category | Google `primaryType` | Volume | Counter moment | Owner on-site | Review-sensitive | Independent | **Priority** |
|---|---|---|---|---|---|---|---|
| **Barber shop** | `barber_shop` | 4 | 5 | 5 | 5 | 5 | **S** |
| **Nail salon** | `nail_salon` | 5 | 5 | 5 | 4 | 5 | **S** |
| **Hair salon** | `hair_salon` | 4 | 5 | 4 | 5 | 5 | **S** |
| **Coffee shop / café** | `cafe`, `coffee_shop` | 5 | 5 | 3 | 4 | 4 | **S** |
| **Casual restaurant** | `restaurant` | 5 | 4 | 3 | 5 | 4 | **S** |
| **Auto repair** | `car_repair` | 3 | 4 | 5 | 5 | 5 | **S** |
| **Med spa / aesthetics** | `spa`, `beauty_salon` | 3 | 5 | 4 | 5 | 5 | **S** |
| Bakery | `bakery` | 4 | 5 | 4 | 3 | 5 | A |
| Pet grooming | `pet_store`, groomers | 3 | 5 | 5 | 5 | 5 | A |
| Tattoo / piercing | `tattoo_parlor` | 2 | 5 | 5 | 5 | 5 | A |
| Phone / device repair | `cell_phone_store` | 3 | 5 | 4 | 5 | 4 | A |
| Massage / bodywork | `massage` | 3 | 5 | 4 | 5 | 5 | A |
| Bar / pub | `bar` | 5 | 3 | 2 | 4 | 4 | A |
| Dry cleaner | `laundry`, `dry_cleaning` | 4 | 5 | 4 | 2 | 5 | B |
| Car wash | `car_wash` | 5 | 3 | 2 | 3 | 4 | B |
| Ice cream / dessert | `ice_cream_shop` | 5 | 5 | 2 | 3 | 4 | B |
| Florist | `florist` | 2 | 5 | 5 | 4 | 5 | B |
| Chiropractor | `chiropractor` | 2 | 4 | 5 | 5 | 5 | B |
| Dentist | `dentist` | 2 | 4 | 3 | 5 | 4 | B |
| Veterinarian | `veterinary_care` | 3 | 4 | 3 | 5 | 4 | B |
| Gym / studio | `gym`, `fitness_center` | 4 | 2 | 3 | 4 | 4 | C |
| Boutique retail | `clothing_store` | 2 | 5 | 4 | 2 | 5 | C |
| Jewelry | `jewelry_store` | 1 | 5 | 5 | 4 | 5 | C |
| Fast food | `fast_food_restaurant` | 5 | 3 | 1 | 2 | 1 | **Skip** |
| Gas station | `gas_station` | 5 | 3 | 1 | 1 | 2 | **Skip** |
| Bank / pharmacy chain | various | 4 | 3 | 1 | 2 | 1 | **Skip** |

### 2.1 Why the S-tier is what it is

The pattern isn't just foot traffic. It's **the checkout pause combined with an emotional peak.**

Personal services win because the customer has just spent 30–60 minutes with one person, likes them, is standing at the counter, is about to tip, and already has their phone or card out. That is the single best moment in commerce to ask for a review, and it happens dozens of times a day in a barbershop. The card sits exactly where the pause already exists.

Cafés and restaurants win on raw volume. Auto repair wins on stakes — reviews genuinely drive that business, tickets are large, and the owner is almost always physically there.

Fast food and gas stations have the volume but fail three ways at once: corporate-controlled listings, no purchasing authority on site, and staff who won't ask.

**Start with barbershops and nail salons.** Highest close rate, owner almost always present, they cluster on the same commercial strips, and they take five minutes each. You can walk a strip and hit six of them in an hour.

---

## 3. The scoring model

### 3.1 Hard filters — kill before scoring

| Rule | Threshold | Why |
|---|---|---|
| `businessStatus` | must be `OPERATIONAL` | Obvious |
| Rating | **≥ 4.0** | Below this, volume amplifies bad experience. You will be blamed |
| Rating | **≥ 3.0 to appear at all** | Under 3.0 they need a different business, not a review card |
| Review count | ≥ 5 | Fewer means the profile is unused or brand new — no baseline to prove against |
| Chain flag | `false` (or ≤2 locations) | Corporate listing = no local authority |
| Category | not in Skip list | |
| Distance from corridor | ≤ 100m from route line | Walkability |

An unrated business is worth a separate list, not the main one. Sometimes it's a brand-new shop that badly needs reviews and is the easiest yes you'll ever get — but you can't qualify it on data, so treat it as an opportunistic walk-in, not a call.

### 3.2 Composite score (0–100)

```
score =  25 × volume_signal        (review velocity, normalized)
       + 20 × competitor_gap       (how far behind their local median)
       + 15 × category_priority    (S=1.0, A=0.75, B=0.5, C=0.25)
       + 15 × rating_safety        (4.6+=1.0, 4.3–4.6=0.85, 4.0–4.3=0.6)
       + 10 × review_gap_headroom  (peaks at 20–150 reviews)
       +  8 × walk_density         (qualifying neighbors within 150m)
       +  7 × profile_gap          (weak profile = upsell headroom)
```

**`review_gap_headroom` is deliberately non-monotonic** — it peaks in the 20–150 range and falls off above it. That's not because high-review businesses are bad prospects; it's because the *trial* stops working on them. A business at 900 reviews won't see a visible delta in 30 days, so the trial's proof mechanism fails. They're still a great prospect — they just get routed to a direct sale instead.

### 3.3 Routing tiers

| Tier | Criteria | Offer | Pre-call? |
|---|---|---|---|
| **A — Trial** | ≥4.0★, 20–150 reviews, velocity ≥1.5/mo, S/A category, independent | 30-day free trial | **Yes** |
| **B — Direct sale** | ≥4.2★, 150+ reviews, high velocity | Immediate sale, skip the trial | **Yes** |
| **C — Different offer** | 3.5–4.0★, or velocity <1/mo, or C-category | Link hub, hiring placard, missed-call text-back | No — walk-in only |
| **D — Log, don't work** | <3.5★, chain, closed, no walk-in customers | None now | No |

Tier C is where your "relationship with every business" instinct pays. A 3.7-star restaurant genuinely shouldn't be amplifying its current experience — but it needs a hiring placard, and it will remember that you were the one who *didn't* sell it the thing that would have hurt it.

Re-sweep D quarterly. Ratings recover, franchisees change, closed shops become new shops.

---

## 4. Enrichment beyond Google — where the owner's name comes from

Walking in and saying *"Is Maria in today?"* rather than *"Is the owner in?"* changes the interaction completely. The first sounds like you know her. The second sounds like a salesman. This is worth more than most of your data model.

| Source | Gives you | Cost | Storable |
|---|---|---|---|
| **Maryland SDAT business search** | Legal entity, officers, registered agent, formation date | Free | **Yes — public record** |
| **Business's own website** | Owner name, "About" page, direct email, real phone | Free (fetch) | **Yes — not Google Content** |
| Facebook business page | Owner name, posts, responsiveness | Free | Yes |
| Instagram | Owner name, engagement, whether they post | Free | Yes |
| OpenStreetMap / Overpass | Name, address, category, hours | Free | **Yes — ODbL, fully yours** |
| County/city business licenses | Licensee name, license date | Free–low | Yes |
| Yelp | Cross-reference | Free tier | Restrictive terms |

**Two of these deserve emphasis:**

**The business's own website is a fully-owned data source.** A phone number you fetched from `joespizza.com` is not Google Maps Content. It's often a *better* number than the Places listing — sometimes an office line rather than the one that rings at the host stand. Fetch the site, pull phone/email/owner name/hours, store it permanently. This is the cleanest way to build a durable contact database.

**OpenStreetMap is your compliant fallback for the durable layer.** Coverage for small US businesses is patchier than Google's, and ratings don't exist there — but names, addresses, categories, phones, and hours are all under ODbL and yours to keep. Use OSM for the skeleton database, Google for the ratings/review-count layer you refresh and expire.

Formation date from the state registry is quietly useful: a business registered 14 months ago with 31 reviews is a much hotter prospect than one registered in 2009 with the same count.

---

## 5. The pre-call block

### 5.1 What it is

30–40 minutes, 8:30–9:30am, the morning of (or evening before) the route. You are **not selling.** You are collecting one variable: *when is the decision-maker there?*

Selling on this call actively hurts you — it burns the surprise and gives them a chance to say no before they've seen the demo.

### 5.2 The call

> "Hey, good morning — quick question, is Maria usually in on Tuesdays or is there a better day to catch her?"

That's it. No pitch, no company name unless asked, no explanation. Gatekeepers don't protect the owner's schedule, and the question is so mundane that it gets answered honestly.

If they ask who's calling: *"It's Wylee — I'm local, I work with a few shops on Route 1. I'll swing by, just didn't want to miss her."* True, low-information, not a pitch.

Log four things:
1. Owner/manager name (correct the spelling)
2. Days present
3. Time window
4. Any disqualifier ("we're corporate," "we're closing next month")

### 5.3 Throughput

| | Per call |
|---|---|
| Dial + connect | 25s |
| Question + answer | 20s |
| Log | 15s |
| **Total incl. no-answers** | **~65s** |

40 minutes ≈ 35 dials ≈ 22 connects ≈ 18 usable answers. That's tomorrow's route, qualified.

### 5.4 The effect

| | No pre-call | With pre-call |
|---|---|---|
| Doors | 25 | 25 |
| DM present | 45% → 11 | 72% → 18 |
| Pitches delivered | 7 | 11.5 |
| Customers/day | 1.6 | 2.7 |
| Extra time spent | — | 40 min |

You bought ~1.1 customers/day for 40 minutes. Nothing else in the system has that return.

### 5.5 Legal note — this one's real

Maryland is a **two-party consent state**, and you've already flagged recording as a priority. That applies to phone calls, not just the glasses. **Do not record the pre-call block** unless you're announcing it, which would defeat the entire purpose. Take notes; don't hit record. If you're calling businesses across state lines later, the strictest state's rule governs.

Also add a **do-not-contact flag** to the durable layer and honor it permanently. Anyone who asks not to be called goes in it, and it survives every refresh cycle.

---

## 6. The weekly cadence

| Day | Block | Action |
|---|---|---|
| **Sun eve** | 45 min | Pick next week's corridor. Run the scrape. Score, tier, export call list |
| **Mon–Thu 8:30–9:10** | 40 min | Pre-call block for that day's route |
| **Mon–Thu 9:30–5** | Field | Walk the route in DM-present order, timed by category |
| **Thu eve** | 20 min | Day-7 check-in texts on open trials |
| **Fri am** | 60 min | Day-30 phone closes + report emails |
| **Fri pm** | 30 min | Re-scrape trial corridors for review-count deltas → proof numbers |
| **Rolling** | auto | Purge ephemeral rows past 30 days |

The Friday afternoon re-scrape is what generates your day-30 proof and your velocity metric in the same call. Don't skip it.

---

## 7. Cost

Nearby Search billed per request, not per business returned. Because you need `rating` and `userRatingCount`, <cite index="8-1">requests bill at the Enterprise tier — adding rating moves a call from Pro ($32.00/1,000) to Enterprise ($35.00/1,000)</cite>. <cite index="8-1">Free monthly thresholds are 10,000 calls for Essentials, 5,000 for Pro, and 1,000 for Enterprise.</cite>

| Scope | Requests/mo | Cost |
|---|---|---|
| One corridor (2–3 mi strip) | ~120 | **$0 — under free tier** |
| One neighborhood | ~400 | ~$0 (still under 1,000 free) |
| Half a city, monthly refresh | ~2,000 | ~$35 |
| Full mid-size city, monthly refresh | ~4,000 | ~$105 |

Working corridor-by-corridor keeps you **inside the free tier for months.** This is the strongest practical argument for the rolling-window approach over the city-wide scrape — it's compliant, always fresh, and free.

Two things to set up before your first run: <cite index="8-1">budget alerts notify you but do not stop usage — to enforce a real cap you set per-API usage quotas</cite>. Set a hard quota of 200 requests/day.

---

## 8. What ships this week

| Day | Task |
|---|---|
| **1** | Create the Supabase tables (`schema.sql`). Enable Places API (New), set a 200/day quota |
| **1** | Run `scrape_prospects.py` on one corridor near you. Verify counts look sane |
| **2** | Run the tiering SQL. Export the call list CSV. Eyeball 20 rows for obvious errors |
| **2** | Pre-call block on 20 Tier-A businesses. Log DM availability |
| **3** | Walk the route in DM-present order. Record actual outcomes against predicted tier |
| **4–5** | Repeat on a second corridor |
| **Day 21** | Re-scrape corridor 1 → your first real review-velocity numbers |
| **Day 30** | Compare tier vs. actual conversion. Reweight the score |

The score in §3.2 is a guess. After 100 doors you'll know which term actually predicts a yes, and you should throw out the ones that don't. My bet is that **category and DM-presence do almost all the work**, and half the other terms are noise — but that's a hypothesis to kill with data, which is the whole premise of your business anyway.
