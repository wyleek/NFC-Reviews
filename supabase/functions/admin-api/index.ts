// ============================================================================
// admin-api — everything the field admin app needs, behind one shared token.
// Keeps the Google API key and service role key OFF the phone.
//
// Actions:
//   search_place    { query }            → candidate businesses + place_id + review stats
//   create_business { ...business, cards } → creates business + cards, returns tag URLs
//   add_competitor  { business_id, place_id, name }
//   list_businesses {}
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

    if (p.contact?.email || p.contact?.phone || p.contact?.name) {
      await admin.from("contacts").insert({
        business_id: biz.id,
        name: p.contact.name, title: p.contact.title,
        email: p.contact.email, phone: p.contact.phone,
        role: "owner", is_primary: true,
      });
    }

    const base = slugify(p.name);
    const rows = (p.cards ?? []).map((c: any) => ({
      business_id: biz.id,
      slug: `${base}-${slugify(c.label) || "card"}-${rand()}`,
      label: c.label,
      card_type: c.type ?? "stand",
      destination: "google",
    }));
    const { data: cards, error: cErr } = await admin.from("cards").insert(rows).select();
    if (cErr) return json({ error: cErr.message }, 400);

    return json({
      business: biz,
      cards: cards.map((c: any) => ({ ...c, url: tapUrl(c.slug) })),
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

    const slug = `${slugify(p.name)}-${slugify(p.label || "card")}-${rand()}`;
    const { data: card, error: cErr } = await admin.from("cards").insert({
      business_id: biz.id, slug, label: p.label || "Card",
      card_type: p.type || "stand", destination: "google",
    }).select().single();
    if (cErr) return json({ error: cErr.message }, 400);

    return json({ business: biz, slug, url: tapUrl(slug) });
  }

  return json({ error: "unknown action" }, 400);
});
