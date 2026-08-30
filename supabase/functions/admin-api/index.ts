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
//
// CRM pipeline board actions (feature/crm-pipeline-board) — reads go
// straight from the client via the anon key + RLS (see
// 20260821180000_crm_read_policies.sql); only writes route through here,
// same policy as everything else in this file:
//   update_stage    { business_id, stage }
//   log_activity    { business_id, type, body?, metadata? }
//   upsert_deal     { id?, business_id, product_sku?, amount?, is_trial?, trial_start?, trial_end?, status? }
//   set_sms_consent { business_id, consent }        → only path allowed to set sms_consent=true (crm-spec.md 2c)
//   schedule_message{ business_id, body, send_at }  → 400 unless businesses.sms_consent is true
//   log_pre_call    { business_id, contact_name?, dm_days?, dm_window?, disqualifier? }
//     — the pre-call block (lead-engine-spec.md §5.2): upserts the primary
//     contact's dm_days/dm_window/verified_at, logs a `pre_call` activity,
//     and if a disqualifier is given, sets businesses.do_not_contact=true.
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
    const { data: biz } = p.business_id
      ? await admin.from("businesses").select("id, name, stage, google_place_id")
          .eq("id", p.business_id).maybeSingle()
      : await admin.from("businesses").select("id, name, stage, google_place_id")
          .eq("google_place_id", p.place_id).maybeSingle();
    if (!biz) return json({ business: null, cards: [], contact: null });

    const { data: cards } = await admin
      .from("cards").select("id, label, card_type, slug")
      .eq("business_id", biz.id).order("created_at");
    const { data: contact } = await admin
      .from("contacts").select("id, name, title, email, phone")
      .eq("business_id", biz.id).eq("is_primary", true).maybeSingle();
    return json({
      business: biz,
      cards: (cards ?? []).map((c: any) => ({ ...c, url: tapUrl(c.slug) })),
      contact: contact ?? null,
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

    const summary = [
      p.contact_name ? `Spoke with ${p.contact_name}.` : null,
      p.dm_days?.length ? `In: ${p.dm_days.join(", ")}.` : null,
      p.dm_window ? `Window: ${p.dm_window}.` : null,
      p.disqualifier ? `Disqualified: ${p.disqualifier}.` : null,
    ].filter(Boolean).join(" ");

    const { data: activity, error: aErr } = await admin
      .from("activities")
      .insert({
        business_id: p.business_id,
        type: "pre_call",
        body: summary || null,
        metadata: { dm_days: p.dm_days ?? null, dm_window: p.dm_window ?? null, disqualifier: p.disqualifier ?? null },
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
