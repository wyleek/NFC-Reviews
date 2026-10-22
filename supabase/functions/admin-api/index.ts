// ============================================================================
// admin-api — everything the field admin app needs, behind one shared token.
// Keeps the Google API key and service role key OFF the phone.
//
// Actions:
//   search_place    { query }            → candidate businesses + place_id + review stats
//   lookup_business { place_id } | { business_id } → existing business + its cards + primary
//     contact, if any (find-before-create). Accepts either key so a local
//     `businesses` row picked straight from the DB (no fresh Google search,
//     e.g. hub's Admin-tab local-first search or a CRM "Manage in Admin"
//     deep link) can look itself up by id instead of needing a place_id.
//   create_business { ...business, cards } → creates/updates business + cards, returns tag URLs
//   add_competitor  { business_id, place_id, name }
//   list_businesses {}
//   add_card    { business_id, label, card_type? } → find-or-create by
//     business_id+label, same dedup pattern as create_business's card
//     upsert (reused verbatim, not reinvented) — for adding one more card
//     to a business that already exists, outside the create_business wizard.
//   update_card { id, label?, card_type?, active? }
//   delete_card { id } → soft delete (active=false), NOT a hard delete —
//     cards.id cascades to `taps`, and redirect/index.ts already treats an
//     inactive card as retired (falls back), so this preserves tap history
//     for a card that may still be physically out there.
//
// CRM pipeline board actions (feature/crm-pipeline-board) — reads go
// straight from the client via the anon key + RLS (see
// 20260821180000_crm_read_policies.sql); only writes route through here,
// same policy as everything else in this file:
//   update_stage    { business_id, stage }
//   log_activity    { business_id, type, body?, metadata? }
//   upsert_deal     { id?, business_id, product_sku?, amount?, is_trial?, trial_start?, trial_end?, status? }
//     — also serves as "update_deal": pass `id` for an existing deal, full
//     current fields plus the edited one(s). The CRM drawer's deal editor
//     reuses this action rather than a parallel update_deal (same shape,
//     same insert-vs-update-by-id branch already handles both).
//   delete_deal     { id }
//   add_contact     { business_id, name?, title?, email?, phone?, role? }
//     → is_primary=true only if this is the business's first contact.
//   update_contact  { id, name?, title?, email?, phone? }
//   delete_contact  { id } → if the deleted contact was primary and others
//     remain, promotes the next-oldest to primary so callers that look up
//     "the primary contact" (create_business, log_pre_call) keep working.
//   delete_activity { id } — activities stay append-only otherwise; this is
//     "editing an entry out", not rewriting its text.
//   set_sms_consent { business_id, consent }        → only path allowed to set sms_consent=true (crm-spec.md 2c)
//   schedule_message{ business_id, body, send_at }  → 400 unless businesses.sms_consent is true
//   log_pre_call    { business_id, contact_name?, dm_days?, dm_window?, dm_window_start?, dm_window_end?, disqualifier? }
//     — the pre-call block (lead-engine-spec.md §5.2): upserts the primary
//     contact's dm_days/dm_window(_start/_end)/verified_at, logs a
//     `pre_call` activity, and if a disqualifier is given, sets
//     businesses.do_not_contact=true.
//
// Call List quick-add (feat/call-list-manual-add-scheduling):
//   add_lead { place_id, name? }
//     — find-or-create the business by google_place_id (never downgrades
//     a stage past wherever it already is), pulls the phone number from a
//     dedicated Places Details call into businesses.phone (the general
//     business line — see set_business_phone below, NOT contacts.phone),
//     and ensures a placeholder primary contact exists. Stage is only set
//     to 'qualified' on first creation. hub's Admin tab (AdminTab.jsx)
//     also calls this the moment a Google search result is picked, so
//     simply finding a business there lands it on the Call List even if
//     the field rep never finishes the full onboarding wizard.
//   set_business_phone { business_id, phone } — manual correction for the
//     same businesses.phone field, for when Google has it wrong or missing.
//   set_business_address { business_id, address, city, zip } — manual
//     correction for the same address/city/zip fields add_lead auto-fills.
//   set_do_not_contact { business_id, value } — reversible in both
//     directions (unlike log_pre_call's disqualifier, which only ever sets
//     it): the Call List's "Remove" button and the drawer's own toggle.
//   reset_call_schedule { business_id } — clears the primary contact's
//     logged dm_days/dm_window(_start/_end)/verified_at, dropping the row
//     back into the Call List's Unscheduled bucket. No activity is logged;
//     this undoes a stale/mislogged pre-call, it isn't one itself.
//
// Deploy: supabase functions deploy admin-api --no-verify-jwt
// Guarded by ADMIN_TOKEN, checked below.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY")!;
const ADMIN_TOKEN = Deno.env.get("ADMIN_TOKEN")!;

// Base URL for the printed/encoded tap link. Once a pretty domain is proxied
// in front of the redirect function (see backend README §4), set
// TAP_BASE_URL=https://<your-domain>/r and links become tap2review.com/r/<slug>.
// Until then, default straight to the deployed redirect function itself so
// links actually work with no DNS setup required.
const PROJECT_REF = new URL(Deno.env.get("SUPABASE_URL")!).hostname.split(".")[0];
const TAP_BASE_URL =
  Deno.env.get("TAP_BASE_URL") ?? `https://${PROJECT_REF}.functions.supabase.co/redirect`;
const tapUrl = (slug: string) => `${TAP_BASE_URL}/${slug}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
}
const rand = () => Math.random().toString(36).slice(2, 6);

// Estimate reviews/month from the sample of reviews Google returns.
// NOTE: Google returns up to 5 reviews and does not guarantee they're the
// newest, so treat this as a rough estimate, not a measurement.
function estimateVelocity(reviews: any[]): number | null {
  const times = (reviews ?? [])
    .map((r) => r.publishTime && new Date(r.publishTime).getTime())
    .filter(Boolean)
    .sort((a, b) => b - a);
  if (times.length < 2) return null;
  const spanDays = (times[0] - times[times.length - 1]) / 86400000;
  if (spanDays <= 0) return null;
  return +(((times.length - 1) / spanDays) * 30).toFixed(1);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-admin-token") !== ADMIN_TOKEN) return json({ error: "unauthorized" }, 401);

  const { action, ...p } = await req.json();

  // ---------------------------------------------------------------- search
  if (action === "search_place") {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": PLACES_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.reviews",
      },
      body: JSON.stringify({ textQuery: p.query, maxResultCount: 5 }),
    });
    if (!res.ok) return json({ error: await res.text() }, 502);
    const d = await res.json();
    return json({
      places: (d.places ?? []).map((x: any) => ({
        place_id: x.id,
        name: x.displayName?.text,
        address: x.formattedAddress,
        rating: x.rating ?? null,
        review_count: x.userRatingCount ?? 0,
        velocity_estimate: estimateVelocity(x.reviews),
      })),
    });
  }

  // ---------------------------------------------------------------- create
  if (action === "create_business") {
    // A business row for this place_id may already exist — e.g. a scraped
    // lead (stage='scraped') that's now converting to a paying customer
    // right here in the field. Reuse that row instead of erroring on the
    // google_place_id unique constraint; this is the sale, so land on
    // stage='customer' either way.
    const { data: existing } = await admin
      .from("businesses").select("id")
      .eq("google_place_id", p.place_id).maybeSingle();

    const bizFields = {
      name: p.name,
      google_place_id: p.place_id,
      current_review_count: p.review_count ?? null,
      current_rating: p.rating ?? null,
      reviews_synced_at: new Date().toISOString(),
      stage: "customer",
    };
    const { data: biz, error } = existing
      ? await admin.from("businesses").update(bizFields).eq("id", existing.id).select().single()
      : await admin.from("businesses").insert(bizFields).select().single();
    if (error) return json({ error: error.message }, 400);

    // Baseline snapshot — this is the "reviews when you started" number.
    if (p.review_count != null) {
      await admin.from("review_snapshots").upsert({
        business_id: biz.id,
        captured_on: new Date().toISOString().slice(0, 10),
        review_count: p.review_count,
        rating: p.rating ?? null,
      }, { onConflict: "business_id,captured_on" });
    }

    // Find-or-update the existing primary contact instead of always
    // inserting — mirrors log_pre_call's pattern below. This endpoint used
    // to insert unconditionally, so re-running the onboarding flow on an
    // already-existing customer (e.g. to "adjust contact information")
    // minted a second contacts row instead of editing the real one.
    if (p.contact?.email || p.contact?.phone || p.contact?.name) {
      const { data: existingContact } = await admin
        .from("contacts")
        .select("id")
        .eq("business_id", biz.id)
        .eq("is_primary", true)
        .maybeSingle();

      const contactFields = {
        name: p.contact.name, title: p.contact.title,
        email: p.contact.email, phone: p.contact.phone,
      };

      const { error: contactErr } = existingContact
        ? await admin.from("contacts").update(contactFields).eq("id", existingContact.id)
        : await admin.from("contacts").insert({
            business_id: biz.id,
            ...contactFields,
            role: "owner", is_primary: true,
          });
      if (contactErr) return json({ error: contactErr.message }, 400);
    }

    // Cards carrying an `id` are ones already written and possibly tapped
    // in the field (e.g. a demo tag made via linkmaker's quick_link that
    // closed the sale) — update that row in place so its slug, and
    // therefore the URL already physically on the tag, never changes.
    // Cards with no `id` are meant to be genuinely new, but the client's
    // "pre-fill existing cards from lookup_business" step (admin.html and
    // hub's AdminTab.jsx both do this) is a client-side convenience, not
    // something this endpoint can rely on — a stale/fresh client state
    // (re-running the onboarding flow for a business that already has
    // cards, from either admin.html or the hub, without that prefill
    // landing) sends label-only cards again and this used to insert them
    // unconditionally. Caught live: Yogamour ended up with 7 rows in
    // `cards` for what should've been 4 distinct locations. Guard it
    // server-side too — reuse an existing card for this business+label
    // instead of minting a duplicate; only truly new labels get inserted.
    const base = slugify(p.name);
    const toUpdate = (p.cards ?? []).filter((c: any) => c.id);
    const freshByLabel = (p.cards ?? []).filter((c: any) => !c.id);

    const updated: any[] = [];
    for (const c of toUpdate) {
      const { data, error: uErr } = await admin.from("cards")
        .update({ label: c.label, card_type: c.type ?? "stand" })
        .eq("id", c.id).select().single();
      if (uErr) return json({ error: uErr.message }, 400);
      updated.push(data);
    }

    const reused: any[] = [];
    const toInsert: any[] = [];
    for (const c of freshByLabel) {
      const { data: existingCard } = await admin
        .from("cards").select().eq("business_id", biz.id).eq("label", c.label)
        .order("created_at").limit(1).maybeSingle();
      if (existingCard) {
        reused.push(existingCard);
      } else {
        toInsert.push({
          business_id: biz.id,
          slug: `${base}-${slugify(c.label) || "card"}-${rand()}`,
          label: c.label,
          card_type: c.type ?? "stand",
          destination: "google",
        });
      }
    }
    const { data: inserted, error: cErr } = toInsert.length
      ? await admin.from("cards").insert(toInsert).select()
      : { data: [], error: null };
    if (cErr) return json({ error: cErr.message }, 400);

    return json({
      business: biz,
      cards: [...updated, ...reused, ...(inserted ?? [])].map((c: any) => ({ ...c, url: tapUrl(c.slug) })),
    });
  }

  // --------------------------------------------------------- lookup_business
  // Called the moment admin.html's user picks a search result, before they've
  // created anything — so if this business already has a row (e.g. a scraped
  // lead, or one linkmaker already made a quick demo card for), Step 3 can
  // pre-fill with its real existing card(s) instead of offering fresh blanks
  // that would duplicate whatever's already been physically written.
  //
  // Also accepts `business_id` (instead of `place_id`) — added so a business
  // picked straight from a local-DB match (hub's Admin-tab local-first
  // search, or a "Manage in Admin" deep link from the CRM board) can be
  // looked up even when it has no google_place_id handy client-side yet, or
  // (rarely) no google_place_id at all. And now also returns the existing
  // primary contact, if any, so Step 2 (ContactStep) can pre-fill real
  // contact info instead of offering a blank form that risks re-entering
  // (and, pre-fix, duplicating) data that's already on file.
  if (action === "lookup_business") {
    // A plain (not concatenated) string literal — supabase-js infers the
    // returned row's shape from this string's literal type, which breaks
    // (falls back to a generic error type) once it's built via `+`.
    const lookupFields =
      "id, name, stage, google_place_id, phone, do_not_contact, current_review_count, current_rating, reviews_synced_at, address, city, zip" as const;
    const { data: biz } = p.business_id
      ? await admin.from("businesses").select(lookupFields)
          .eq("id", p.business_id).maybeSingle()
      : await admin.from("businesses").select(lookupFields)
          .eq("google_place_id", p.place_id).maybeSingle();
    if (!biz) return json({ business: null, cards: [], contact: null, contacts: [] });

    const { data: cards } = await admin
      .from("cards").select("id, label, card_type, slug")
      .eq("business_id", biz.id).order("created_at");
    // `contacts` (plural, all of them) is what the hub's shared contact
    // editor (ContactsEditor — same one BusinessDrawer's CRM drawer uses)
    // needs; `contact` (singular, primary-only) stays for backward
    // compatibility with callers that only ever handled one.
    const { data: contacts } = await admin
      .from("contacts").select("id, name, title, email, phone, is_primary")
      .eq("business_id", biz.id).order("is_primary", { ascending: false });
    const contact = (contacts ?? []).find((c: any) => c.is_primary) ?? contacts?.[0] ?? null;
    return json({
      business: biz,
      cards: (cards ?? []).map((c: any) => ({ ...c, url: tapUrl(c.slug) })),
      contact,
      contacts: contacts ?? [],
    });
  }

  // ------------------------------------------------------------ competitor
  if (action === "add_competitor") {
    const { error } = await admin.from("competitors").insert({
      business_id: p.business_id, google_place_id: p.place_id, name: p.name,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // ----------------------------------------------------------------- list
  if (action === "list_businesses") {
    const { data } = await admin
      .from("businesses")
      .select("id, name, current_review_count, current_rating, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    return json({ businesses: data ?? [] });
  }

  // ------------------------------------------------- quick_link (linkmaker)
  // Find-or-create a business by place_id, add ONE card, return the tag URL.
  // This is the fast field path: name search -> tap -> copy link.
  if (action === "quick_link") {
    // find existing business for this place, so we don't duplicate
    let { data: biz } = await admin
      .from("businesses").select("id, name").eq("google_place_id", p.place_id).maybeSingle();

    if (!biz) {
      const { data: made, error } = await admin.from("businesses").insert({
        name: p.name, google_place_id: p.place_id,
        current_review_count: p.review_count ?? null, current_rating: p.rating ?? null,
        reviews_synced_at: new Date().toISOString(),
      }).select("id, name").single();
      if (error) return json({ error: error.message }, 400);
      biz = made;

      if (p.review_count != null) {
        await admin.from("review_snapshots").upsert({
          business_id: biz.id, captured_on: new Date().toISOString().slice(0, 10),
          review_count: p.review_count, rating: p.rating ?? null,
        }, { onConflict: "business_id,captured_on" });
      }
    }

    // "add ONE card" per the docstring above — but this used to insert a
    // fresh card unconditionally on every call, with no find-or-reuse the
    // way the business lookup above has. Every repeat visit to this flow
    // for an already-quick-linked business (both admin.html and hub's
    // AdminTab.jsx call this with the same hardcoded label, "Stand") minted
    // another duplicate row. Caught live: Yogamour had 3 separate "Stand"
    // cards from 3 separate quick_link calls weeks apart. Reuse the
    // existing card for this business+label instead of duplicating it.
    const label = p.label || "Card";
    const { data: existingCard } = await admin
      .from("cards").select("slug")
      .eq("business_id", biz.id).eq("label", label)
      .order("created_at").limit(1).maybeSingle();
    if (existingCard) {
      return json({ business: biz, slug: existingCard.slug, url: tapUrl(existingCard.slug) });
    }

    const slug = `${slugify(p.name)}-${slugify(label)}-${rand()}`;
    const { data: card, error: cErr } = await admin.from("cards").insert({
      business_id: biz.id, slug, label,
      card_type: p.type || "stand", destination: "google",
    }).select().single();
    if (cErr) return json({ error: cErr.message }, 400);

    return json({ business: biz, slug, url: tapUrl(slug) });
  }

  // -------------------------------------------------- card management (CRM)
  // For an already-existing business (CRM drawer's Cards section), outside
  // create_business's full onboarding wizard. add_card reuses the exact
  // upsert-by-label-and-business_id dedup pattern create_business's card
  // loop uses (see above) — a double-tap of "Add card" reuses the row
  // instead of minting a duplicate, same protection, not reinvented.
  if (action === "add_card") {
    const { data: biz, error: bErr } = await admin
      .from("businesses").select("id, name").eq("id", p.business_id).maybeSingle();
    if (bErr) return json({ error: bErr.message }, 400);
    if (!biz) return json({ error: "business not found" }, 404);

    const label = p.label || "Card";
    const { data: existingCard } = await admin
      .from("cards").select("id, label, card_type, slug, active")
      .eq("business_id", biz.id).eq("label", label)
      .order("created_at").limit(1).maybeSingle();
    if (existingCard) {
      return json({ card: { ...existingCard, url: tapUrl(existingCard.slug) } });
    }

    const slug = `${slugify(biz.name)}-${slugify(label) || "card"}-${rand()}`;
    const { data: card, error: cErr } = await admin.from("cards").insert({
      business_id: biz.id, slug, label, card_type: p.card_type || "stand", destination: "google",
    }).select().single();
    if (cErr) return json({ error: cErr.message }, 400);
    return json({ card: { ...card, url: tapUrl(card.slug) } });
  }

  if (action === "update_card") {
    const fields: Record<string, unknown> = {};
    if (p.label !== undefined) fields.label = p.label;
    if (p.card_type !== undefined) fields.card_type = p.card_type;
    if (p.active !== undefined) fields.active = Boolean(p.active);
    const { data: card, error } = await admin
      .from("cards").update(fields).eq("id", p.id).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ card: { ...card, url: tapUrl(card.slug) } });
  }

  // Soft delete only — see docstring at the top of the file for why (taps
  // FK-cascade + redirect/index.ts already retires an inactive card).
  if (action === "delete_card") {
    const { data: card, error } = await admin
      .from("cards").update({ active: false }).eq("id", p.id).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ card });
  }

  // ============================================================ CRM board
  const STAGES = [
    "scraped", "qualified", "pre_called", "visit_planned", "rescheduled",
    "sale_hardware", "trial_active", "won", "lost", "customer", "churned",
  ];
  const ACTIVITY_TYPES = ["pre_call", "visit", "outcome", "text_sent", "review_milestone", "note"];

  // --------------------------------------------------------- set_follow_up
  // Structured "call back on this date/time" — pass follow_up_at: null to
  // clear it once the call happens.
  if (action === "set_follow_up") {
    const { data, error } = await admin
      .from("businesses")
      .update({ follow_up_at: p.follow_up_at ?? null })
      .eq("id", p.business_id)
      .select("id, follow_up_at")
      .single();
    if (error) return json({ error: error.message }, 400);
    return json({ business: data });
  }

  // ------------------------------------------------------------ update_stage
  if (action === "update_stage") {
    if (!STAGES.includes(p.stage)) return json({ error: `invalid stage: ${p.stage}` }, 400);
    const { data, error } = await admin
      .from("businesses")
      .update({ stage: p.stage, stage_updated_at: new Date().toISOString() })
      .eq("id", p.business_id)
      .select("id, stage, stage_updated_at")
      .single();
    if (error) return json({ error: error.message }, 400);
    return json({ business: data });
  }

  // ----------------------------------------------------------- log_activity
  // Covers one-tap outcome logging AND voice/text note capture — both are
  // just an `activities` row; the board tells them apart by `type`.
  if (action === "log_activity") {
    if (!ACTIVITY_TYPES.includes(p.type)) return json({ error: `invalid activity type: ${p.type}` }, 400);
    const { data, error } = await admin
      .from("activities")
      .insert({ business_id: p.business_id, type: p.type, body: p.body ?? null, metadata: p.metadata ?? null })
      .select()
      .single();
    if (error) return json({ error: error.message }, 400);
    return json({ activity: data });
  }

  // ------------------------------------------------------------ delete_activity
  // Activities stay append-only per crm-spec.md — "editing" one out of the
  // timeline means removing the entry, never rewriting its text in place.
  if (action === "delete_activity") {
    const { error } = await admin.from("activities").delete().eq("id", p.id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // -------------------------------------------------------------- upsert_deal
  if (action === "upsert_deal") {
    const fields = {
      business_id: p.business_id,
      product_sku: p.product_sku ?? null,
      amount: p.amount ?? null,
      is_trial: p.is_trial ?? false,
      trial_start: p.trial_start ?? null,
      trial_end: p.trial_end ?? null,
      status: p.status ?? "open",
    };
    const { data, error } = p.id
      ? await admin.from("deals").update(fields).eq("id", p.id).select().single()
      : await admin.from("deals").insert(fields).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ deal: data });
  }

  // update_deal is deliberately NOT a separate action — see the docstring at
  // the top of the file. The drawer's deal editor calls upsert_deal with the
  // deal's `id` plus its (edited) fields.

  if (action === "delete_deal") {
    const { error } = await admin.from("deals").delete().eq("id", p.id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // --------------------------------------------------------- contact CRUD
  // Full contact management for the CRM drawer — add_contact/update_contact/
  // delete_contact. create_business and log_pre_call above still do their
  // own find-or-update-the-primary-contact thing on their own paths; these
  // are the general-purpose actions for "manage every contact on this
  // business" from the drawer, including businesses with several contacts.
  if (action === "add_contact") {
    const { count } = await admin
      .from("contacts").select("id", { count: "exact", head: true }).eq("business_id", p.business_id);
    const { data, error } = await admin.from("contacts").insert({
      business_id: p.business_id,
      name: p.name ?? null,
      title: p.title ?? null,
      email: p.email ?? null,
      phone: p.phone ?? null,
      role: p.role ?? null,
      is_primary: (count ?? 0) === 0,
    }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ contact: data });
  }

  if (action === "update_contact") {
    const fields: Record<string, unknown> = {};
    for (const k of ["name", "title", "email", "phone"]) {
      if (p[k] !== undefined) fields[k] = p[k];
    }
    const { data, error } = await admin
      .from("contacts").update(fields).eq("id", p.id).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ contact: data });
  }

  if (action === "delete_contact") {
    const { data: toDelete } = await admin
      .from("contacts").select("id, business_id, is_primary").eq("id", p.id).maybeSingle();
    const { error } = await admin.from("contacts").delete().eq("id", p.id);
    if (error) return json({ error: error.message }, 400);

    // Keep "the primary contact" meaningful for create_business/log_pre_call
    // — if the one just deleted was primary and others remain, promote the
    // next-oldest instead of leaving the business with no primary contact.
    if (toDelete?.is_primary) {
      const { data: next } = await admin
        .from("contacts").select("id").eq("business_id", toDelete.business_id)
        .order("created_at").limit(1).maybeSingle();
      if (next) await admin.from("contacts").update({ is_primary: true }).eq("id", next.id);
    }
    return json({ ok: true });
  }

  // ---------------------------------------------------------- sms_consent
  // crm-spec.md 2c: creating a trial requires an explicit SMS opt-in
  // checkbox, which must set sms_consent=true + sms_consent_at=now() —
  // this is the only path that's allowed to flip sms_consent to true.
  // Also handles STOP-triggered opt-out (consent=false), per the
  // constraints section: honor STOP by flipping this AND the matching
  // scheduled_messages to 'stopped' (that second half is still a TODO
  // for whoever wires the inbound STOP webhook).
  if (action === "set_sms_consent") {
    const { data, error } = await admin
      .from("businesses")
      .update({
        sms_consent: Boolean(p.consent),
        sms_consent_at: p.consent ? new Date().toISOString() : null,
      })
      .eq("id", p.business_id)
      .select("id, sms_consent, sms_consent_at")
      .single();
    if (error) return json({ error: error.message }, 400);
    return json({ business: data });
  }

  // ----------------------------------------------------------- log_pre_call
  // lead-engine-spec.md §5.2: "Log four things: 1. Owner/manager name,
  // 2. Days present, 3. Time window, 4. Any disqualifier." Not selling on
  // this call — this is the only write it makes.
  if (action === "log_pre_call") {
    const { data: existing } = await admin
      .from("contacts")
      .select("id")
      .eq("business_id", p.business_id)
      .eq("is_primary", true)
      .maybeSingle();

    const contactFields: Record<string, unknown> = {
      dm_days: p.dm_days ?? null,
      dm_window: p.dm_window ?? null,
      dm_window_start: p.dm_window_start ?? null,
      dm_window_end: p.dm_window_end ?? null,
      verified_at: new Date().toISOString(),
    };
    if (p.contact_name) contactFields.name = p.contact_name;

    const { error: cErr } = existing
      ? await admin.from("contacts").update(contactFields).eq("id", existing.id)
      : await admin.from("contacts").insert({
          business_id: p.business_id,
          role: "owner",
          is_primary: true,
          source: "phone_call",
          ...contactFields,
        });
    if (cErr) return json({ error: cErr.message }, 400);

    const windowSummary = p.dm_window_start
      ? `Available ${p.dm_window_start}${p.dm_window_end ? `–${p.dm_window_end}` : "+"}.`
      : null;
    const summary = [
      p.contact_name ? `Spoke with ${p.contact_name}.` : null,
      p.dm_days?.length ? `In: ${p.dm_days.join(", ")}.` : null,
      windowSummary,
      p.dm_window ? `Note: ${p.dm_window}.` : null,
      p.disqualifier ? `Disqualified: ${p.disqualifier}.` : null,
    ].filter(Boolean).join(" ");

    const { data: activity, error: aErr } = await admin
      .from("activities")
      .insert({
        business_id: p.business_id,
        type: "pre_call",
        body: summary || null,
        metadata: {
          dm_days: p.dm_days ?? null,
          dm_window: p.dm_window ?? null,
          dm_window_start: p.dm_window_start ?? null,
          dm_window_end: p.dm_window_end ?? null,
          disqualifier: p.disqualifier ?? null,
        },
      })
      .select()
      .single();
    if (aErr) return json({ error: aErr.message }, 400);

    // lead-engine-spec.md §5.5: "add a do-not-contact flag ... and honor
    // it permanently." Only sets it — never clears it from here.
    if (p.disqualifier) {
      const { error: dErr } = await admin.from("businesses").update({ do_not_contact: true }).eq("id", p.business_id);
      if (dErr) return json({ error: dErr.message }, 400);
    }

    return json({ activity, do_not_contact: Boolean(p.disqualifier) });
  }

  // -------------------------------------------------------------- add_lead
  // Call List quick-add (feat/call-list-manual-add-scheduling): type a name,
  // press Enter, land it straight in the call list — no scraper pipeline,
  // no Kanban drag needed. Mirrors create_business's find-or-create-by-
  // place_id pattern (never downgrade a business that's already further
  // along the pipeline) and log_pre_call's find-or-update-primary-contact
  // pattern.
  if (action === "add_lead") {
    if (!p.place_id) return json({ error: "place_id required" }, 400);

    // Dedicated Place Details request — search_place's field mask (above)
    // doesn't request a phone number and that action belongs to a parallel
    // workstream, so ask for phone (plus rating/review count and address)
    // here instead. Places API (New) requires every field to be listed
    // explicitly in the X-Goog-FieldMask header or it's simply omitted
    // from the response. Pulling rating/userRatingCount/addressComponents
    // in this same request (rather than a second billed call) means every
    // Admin pick or Call List add captures live review stats and a real
    // address immediately — previously add_lead created the business row
    // with no review data at all, so a business showed reviews in the
    // search-hit list (live from search_place) and then showed nothing
    // once picked, not refreshing until the next daily sync-reviews cron
    // run (up to 24h later).
    const detailsRes = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(p.place_id)}`,
      {
        headers: {
          "X-Goog-Api-Key": PLACES_KEY,
          "X-Goog-FieldMask":
            "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber," +
            "rating,userRatingCount,addressComponents",
        },
      },
    );
    if (!detailsRes.ok) return json({ error: await detailsRes.text() }, 502);
    const d = await detailsRes.json();
    const phone: string | null = d.nationalPhoneNumber ?? d.internationalPhoneNumber ?? null;
    const name: string = p.name || d.displayName?.text || "Unknown business";
    const address: string | null = d.formattedAddress ?? null;
    // addressComponents entries look like { longText, shortText, types[] } —
    // pull the two components that actually disambiguate same-named
    // locations of a chain (crm-spec.md gap: nothing persisted an address
    // at all before this, so two saved "Ledo Pizza" rows looked identical
    // everywhere but Admin's live search-hit list).
    let city: string | null = null;
    let zip: string | null = null;
    for (const c of d.addressComponents ?? []) {
      if (c.types?.includes("locality")) city = c.longText ?? null;
      else if (!city && c.types?.includes("postal_town")) city = c.longText ?? null;
      if (c.types?.includes("postal_code")) zip = c.longText ?? null;
    }
    const rating: number | null = d.rating ?? null;
    const reviewCount: number | null = d.userRatingCount ?? null;

    // Find-or-create by google_place_id — same dedup this file already
    // relies on in create_business/quick_link. Unlike create_business
    // (which is closing a sale, so it's fine to force stage='customer'),
    // a quick-add must never regress a business that's already further
    // along (e.g. already a customer) — so the existing row's stage is
    // left completely untouched.
    const { data: existing } = await admin
      .from("businesses").select()
      .eq("google_place_id", p.place_id).maybeSingle();

    let biz = existing;
    if (!biz) {
      const { data: made, error } = await admin.from("businesses").insert({
        name,
        google_place_id: p.place_id,
        stage: "qualified",
        phone, address, city, zip,
        current_review_count: reviewCount,
        current_rating: rating,
        reviews_synced_at: reviewCount != null ? new Date().toISOString() : null,
      }).select().single();
      if (error) {
        // 23505 = unique_violation. Someone else (a double-click before the
        // button disabled, or two lines of a batch-add resolving to the
        // same place) inserted this place_id between our SELECT and this
        // INSERT. Don't fail the request over a race — just fetch what's
        // there now and continue as if we'd found it in the first place.
        if (error.code !== "23505") return json({ error: error.message }, 400);
        const { data: raced } = await admin
          .from("businesses").select()
          .eq("google_place_id", p.place_id).maybeSingle();
        if (!raced) return json({ error: error.message }, 400);
        biz = raced;
      } else {
        biz = made;
      }
    }

    // A brand-new row (the `!existing` branch above) already got all of
    // this on insert — only an already-existing business needs it applied
    // now. Review stats are always trustworthy straight from Google —
    // nobody hand-corrects a review count — so refresh them
    // unconditionally on every add_lead call, same as the daily
    // sync-reviews cron does, just immediately instead of up to 24h later.
    // Phone/address/city/zip are different: a field rep can and does
    // correct these by hand (see set_business_phone/set_business_address),
    // so only fill them in when still empty — never clobber a manual
    // correction with a stale or wrong Google value.
    if (existing) {
      const fillIfMissing: Record<string, unknown> = {};
      if (phone && !biz.phone) fillIfMissing.phone = phone;
      if (address && !biz.address) fillIfMissing.address = address;
      if (city && !biz.city) fillIfMissing.city = city;
      if (zip && !biz.zip) fillIfMissing.zip = zip;
      const refresh: Record<string, unknown> =
        reviewCount != null
          ? { current_review_count: reviewCount, current_rating: rating, reviews_synced_at: new Date().toISOString() }
          : {};
      if (Object.keys(fillIfMissing).length || Object.keys(refresh).length) {
        const { data: updated, error: uErr } = await admin
          .from("businesses").update({ ...fillIfMissing, ...refresh }).eq("id", biz.id).select().single();
        if (uErr) return json({ error: uErr.message }, 400);
        biz = updated;
      }
    }

    // Still worth a placeholder primary-contact row so the pre-call form
    // has somewhere to attach an owner/manager's name and direct number —
    // no phone written here anymore, see above.
    const { data: existingContact } = await admin
      .from("contacts").select("id")
      .eq("business_id", biz.id).eq("is_primary", true).maybeSingle();
    if (!existingContact) {
      const { error: cErr } = await admin.from("contacts").insert({
        business_id: biz.id, role: "owner", is_primary: true, source: "google_places",
      });
      if (cErr) return json({ error: cErr.message }, 400);
    }

    return json({ business: biz, phone });
  }

  // ------------------------------------------------------- set_business_phone
  // Manual correction/entry for businesses.phone (the general business
  // line add_lead auto-fills from Google Places) — for when Google has it
  // wrong, or a business has no Google listing at all. Deliberately not
  // part of contact CRUD: this is the business's own line, not a specific
  // person's — see contacts.phone (add_contact/update_contact) for
  // owner/manager numbers.
  if (action === "set_business_phone") {
    const { data, error } = await admin
      .from("businesses").update({ phone: p.phone || null }).eq("id", p.business_id)
      .select("id, phone").single();
    if (error) return json({ error: error.message }, 400);
    return json({ business: data });
  }

  // ----------------------------------------------------- set_business_address
  // Manual correction/entry for address/city/zip — same fields add_lead
  // auto-fills from Google Places, for when Google has it wrong, or a
  // business has no Google listing at all. city/zip are what actually
  // tell apart same-named locations of a chain elsewhere in the hub.
  if (action === "set_business_address") {
    const { data, error } = await admin
      .from("businesses")
      .update({ address: p.address || null, city: p.city || null, zip: p.zip || null })
      .eq("id", p.business_id)
      .select("id, address, city, zip").single();
    if (error) return json({ error: error.message }, 400);
    return json({ business: data });
  }

  // ------------------------------------------------------- set_do_not_contact
  // Reversible in both directions — the Call List's "Remove" button
  // (value: true) and the drawer's own on/off toggle (either direction).
  // log_pre_call's disqualifier path above only ever sets this flag; this
  // is the way to clear it again once someone's ready to re-engage, or to
  // pull a business off the Call List without logging a call outcome.
  if (action === "set_do_not_contact") {
    const { data, error } = await admin
      .from("businesses").update({ do_not_contact: Boolean(p.value) }).eq("id", p.business_id)
      .select("id, do_not_contact").single();
    if (error) return json({ error: error.message }, 400);
    return json({ business: data });
  }

  // ------------------------------------------------------ reset_call_schedule
  // Call List "Reset" button: clears the primary contact's logged
  // day/time-window fields, dropping the row back into the Unscheduled
  // bucket — without log_pre_call's required-start-time validation and
  // without writing a new pre_call activity (this undoes a stale or
  // mislogged schedule, it isn't itself a call).
  if (action === "reset_call_schedule") {
    const { data: existing } = await admin
      .from("contacts").select("id")
      .eq("business_id", p.business_id).eq("is_primary", true).maybeSingle();
    if (!existing) return json({ ok: true }); // nothing logged yet — nothing to reset
    const { error } = await admin.from("contacts").update({
      dm_days: null, dm_window: null, dm_window_start: null, dm_window_end: null, verified_at: null,
    }).eq("id", existing.id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  // --------------------------------------------------------- schedule_message
  // crm-spec.md 2c/§ SMS consent: no automated text may be scheduled for a
  // business that hasn't opted in. Trial creation is supposed to set
  // sms_consent=true up front (see upsert_deal + the trial-signup flow) —
  // this is the backstop that actually enforces it at write time.
  if (action === "schedule_message") {
    const { data: biz, error: bErr } = await admin
      .from("businesses").select("sms_consent").eq("id", p.business_id).single();
    if (bErr) return json({ error: bErr.message }, 400);
    if (!biz.sms_consent) {
      return json({ error: "cannot schedule: business has not given sms_consent" }, 400);
    }
    const { data, error } = await admin
      .from("scheduled_messages")
      .insert({ business_id: p.business_id, body: p.body, send_at: p.send_at })
      .select()
      .single();
    if (error) return json({ error: error.message }, 400);
    return json({ scheduled_message: data });
  }

  return json({ error: "unknown action" }, 400);
});
