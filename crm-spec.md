# Tap2Review CRM Layer — Implementation Spec

## Context

This adds a CRM/pipeline layer onto the **existing** Supabase + React stack. The guiding
principle: **one master record per business.** A scraped lead and a paying customer are the
same entity at different stages — do NOT create a parallel "leads" system. The thing that
fires the automated texts is *review count*, which already lives in Supabase, so the whole
journey stays in one place.

**Existing tables (do not duplicate — extend/reconcile):**
`businesses`, `cards`, `taps`, `review_snapshots`, `contacts`, `competitors`,
`competitor_snapshots` (RLS enabled).

`businesses` is already the master record. `contacts` may already cover owner name/phone/email
— reuse it rather than adding owner columns to `businesses` if the split already exists.
Everything below joins on `business_id`.

**Stack:** Supabase (Postgres, RLS, Edge Functions, pg_cron), React dashboard, Google Places
API (New) daily review sync already running.

---

## TASK 1 — SQL schema (do this first)

### 1a. Stage enum

Add a pipeline stage to the master record. Create an enum type and a `stage` column on
`businesses` (default `scraped`):

```
scraped → qualified → pre_called → visit_planned →
  (rescheduled ↺ visit_planned)
  sale_hardware | trial_active | no_lost
trial_active → won | lost
won/sale_hardware → customer → churned
```

Enum values: `scraped`, `qualified`, `pre_called`, `visit_planned`, `rescheduled`,
`sale_hardware`, `trial_active`, `won`, `lost`, `customer`, `churned`.

Also add to `businesses` (if not already present via `contacts`):
`best_callback_window` (text), `sms_consent` (bool, default false),
`sms_consent_at` (timestamptz), `rank_score`/`traffic_score` (numeric, from scraper),
`stage_updated_at` (timestamptz).

### 1b. `activities` — append-only touch log

Every interaction: pre-call, visit, outcome, text sent, review milestone. This renders the
per-business timeline and is where fast field entry writes.

Columns: `id`, `business_id` (FK), `type` (enum: `pre_call`, `visit`, `outcome`,
`text_sent`, `review_milestone`, `note`), `body` (text), `metadata` (jsonb, for
outcome details / voice-note transcript), `created_at`. Index on `(business_id, created_at desc)`.
Append-only — no updates/deletes in normal flow.

### 1c. `deals` — what was sold

Columns: `id`, `business_id` (FK), `product_sku` (text), `amount` (numeric),
`is_trial` (bool), `trial_start` (date), `trial_end` (date), `status`
(enum: `open`, `won`, `lost`), `created_at`. The `trial_start`/`trial_end` dates drive the
day-7 and day-30 automation timers.

### 1d. `scheduled_messages` — the outbound queue

Columns: `id`, `business_id` (FK), `body` (text), `send_at` (timestamptz),
`status` (enum: `pending`, `sent`, `failed`, `stopped`), `provider_sid` (text, nullable),
`created_at`, `sent_at`. Index on `(status, send_at)` for the drain query.

### 1e. RLS + indexes

Match existing RLS pattern on all new tables. Add FK indexes on every `business_id`.

---

## TASK 2 — React pipeline board (the "single view")

The screen answering "where is every business in its journey." Build against the existing
dashboard's data layer / Supabase client.

### 2a. Board view
- Group `businesses` by `stage` (kanban columns in enum order, or a filterable list toggle).
- Card shows: name, category, review count (from latest `review_snapshots`), rank score,
  days-in-stage, next action.
- Clicking a business opens a detail drawer: the `activities` timeline + any open `deals`.

### 2b. Fast field entry (mobile-first — this is critical)
On a business detail view, one-tap outcome buttons: **Sale / Trial / No / Reschedule.**
Each tap, in a single action:
1. writes an `activities` row (`type: outcome`),
2. flips `businesses.stage` (Sale→`sale_hardware`, Trial→`trial_active`+creates a `deal`
   with trial dates, No→`lost`, Reschedule→`rescheduled`),
3. updates `stage_updated_at`.

Add a voice-note field (browser SpeechRecognition API, or Whisper if already wired) that
drops transcript into the activity `body`. Location-sort the list so the nearest
un-visited business floats to the top.

### 2c. Trial signup must capture consent
When creating a trial, require an SMS opt-in checkbox → set `sms_consent = true`,
`sms_consent_at = now()`. Without this the automated texts are non-compliant.

---

## Constraints / do-not-break

- **A2P 10DLC:** automated texts won't deliver until the brand + campaign are registered
  with the SMS provider (Twilio default). Texts are Tap2Review→owner (platform is the
  visible sender), so ONE registration covers everything — do NOT build per-client
  registration. Leave a TODO where the provider send call goes; the queue/schema can be
  built and tested before registration clears.
- **Consent + opt-out:** honor STOP → set matching `scheduled_messages` to `stopped` and
  `businesses.sms_consent = false`.
- Reuse existing RLS patterns; don't loosen them.

---

## Suggested build order
1. Enum + `businesses` columns (migration).
2. `activities`, `deals`, `scheduled_messages` tables + RLS + indexes.
3. React board (read-only) grouped by stage.
4. One-tap outcome buttons writing activity + stage flip.
5. Trial flow with consent capture + `deal` creation.
6. (Next spec) automation: extend the daily review-sync Edge Function to enqueue
   milestone/new-review texts + a drain cron.
