// ============================================================================
// redirect — the single entry point every card/QR points at.
//   URL shape:  https://<your-domain>/r/<slug>
//   or direct:  https://<ref>.functions.supabase.co/redirect/<slug>
//
// It: (1) looks up the card by slug, (2) logs ONE tap, (3) 302-redirects the
// customer to the Google review page (destination='google') or to the neutral
// hub page (destination='hub'). No rating gate — everyone for a given card
// goes to the same place.
//
// The tap insert is awaited (not fire-and-forget): on this deployment,
// EdgeRuntime.waitUntil()-backgrounded inserts were observed to silently
// drop — the redirect returned instantly but the row never landed. Since
// "taps are measured exactly" is the whole point of the product, correctness
// wins over shaving the ~200-500ms one extra awaited insert costs. A failed
// insert is logged and swallowed so a DB hiccup never breaks the redirect.
//
// Deploy public (no JWT):  supabase functions deploy redirect --no-verify-jwt
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Where to send a tap on a missing/inactive card so a customer never hits a dead end.
const FALLBACK_URL = Deno.env.get("FALLBACK_URL") ?? "https://www.google.com";
// Optional. Only needed if you set a card's destination to 'hub'.
// Leave unset while you're running the straight-to-Google flow.
const HUB_BASE_URL = Deno.env.get("HUB_BASE_URL");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const BOT_RE =
  /bot|crawl|spider|preview|facebookexternalhit|slurp|bingpreview|whatsapp|telegram|discord/i;

function parseDevice(ua: string): { device_type: string; os: string } {
  if (/iphone|ipad|ipod/i.test(ua)) return { device_type: "ios", os: "iOS" };
  if (/android/i.test(ua)) return { device_type: "android", os: "Android" };
  if (/windows/i.test(ua)) return { device_type: "other", os: "Windows" };
  if (/mac os x/i.test(ua)) return { device_type: "other", os: "macOS" };
  if (/linux/i.test(ua)) return { device_type: "other", os: "Linux" };
  return { device_type: "other", os: "unknown" };
}

// Standard Google "write a review" deep link, built from a place_id.
function writeReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

function redirect(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // slug is the last non-empty path segment: /redirect/<slug>  or  /r/<slug>
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = parts[parts.length - 1];

  if (!slug || slug === "redirect" || slug === "r") {
    return redirect(FALLBACK_URL);
  }

  // Look up the card + its business (fast, indexed on slug).
  const { data: card, error } = await admin
    .from("cards")
    .select("id, business_id, destination, active, businesses(place_id:google_place_id, review_url)")
    .eq("slug", slug)
    .maybeSingle();

  if (error) console.error("card lookup error", error);
  if (!card || !card.active) return redirect(FALLBACK_URL);

  // Resolve the final Google destination.
  // @ts-ignore nested select
  const biz = card.businesses ?? {};
  const googleUrl: string =
    biz.review_url ?? (biz.place_id ? writeReviewUrl(biz.place_id) : FALLBACK_URL);

  // Log the tap (skip obvious bots/link-preview fetches so counts stay honest).
  // Awaited so it's not lost — see module comment above.
  const ua = req.headers.get("user-agent") ?? "";
  if (!BOT_RE.test(ua)) {
    const { device_type, os } = parseDevice(ua);
    // Coarse, best-effort country only. Raw IP is never stored.
    const country =
      req.headers.get("cf-ipcountry") ??
      req.headers.get("x-country") ??
      null;

    const { error: tapError } = await admin.from("taps").insert({
      card_id: card.id,
      business_id: card.business_id,
      device_type,
      os,
      country,
      referer: req.headers.get("referer"),
    });
    if (tapError) console.error("tap insert failed", tapError);
  }

  // Send them onward — same destination for everyone on this card.
  if (card.destination === "hub" && HUB_BASE_URL) {
    return redirect(`${HUB_BASE_URL}/${slug}`);
  }
  return redirect(googleUrl);
});
