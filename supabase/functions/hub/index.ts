// ============================================================================
// hub — the compliant neutral landing page.
//   Reached only via the redirect function (destination='hub'), so the tap is
//   already logged. Shows EVERYONE the same two choices, side by side, with no
//   star-rating gate and no sentiment routing:
//     • Leave a Google review
//     • Contact us / share feedback
//
// Deploy public (no JWT):  supabase functions deploy hub --no-verify-jwt
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FALLBACK_URL = Deno.env.get("FALLBACK_URL") ?? "https://www.google.com";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

function writeReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function page(name: string, reviewUrl: string, feedbackUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(name)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0f1115; color: #f4f4f5; padding: 24px;
  }
  .card {
    width: 100%; max-width: 420px; text-align: center;
    background: #181b21; border: 1px solid #262a33; border-radius: 20px; padding: 32px 24px;
  }
  h1 { font-size: 22px; margin: 0 0 6px; }
  p  { font-size: 15px; color: #a1a1aa; margin: 0 0 24px; line-height: 1.5; }
  a.btn {
    display: block; text-decoration: none; font-size: 16px; font-weight: 600;
    padding: 16px; border-radius: 14px; margin-bottom: 12px;
  }
  .primary   { background: #2563eb; color: #fff; }
  .secondary { background: transparent; color: #f4f4f5; border: 1px solid #3a3f4b; }
  .foot { font-size: 12px; color: #6b7280; margin: 18px 0 0; }
</style>
</head>
<body>
  <div class="card">
    <h1>Thanks for visiting ${esc(name)}!</h1>
    <p>We'd love your honest feedback. Choose whichever works for you:</p>
    <a class="btn primary"   href="${esc(reviewUrl)}">Leave a Google review</a>
    <a class="btn secondary" href="${esc(feedbackUrl)}">Share feedback with us</a>
    <p class="foot">Your feedback helps us improve.</p>
  </div>
</body>
</html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const slug = parts[parts.length - 1];

  const { data: card } = await admin
    .from("cards")
    .select("businesses(name, place_id:google_place_id, review_url, feedback_url)")
    .eq("slug", slug)
    .maybeSingle();

  // @ts-ignore nested select
  const biz = card?.businesses;
  if (!biz) {
    return new Response(null, { status: 302, headers: { Location: FALLBACK_URL } });
  }

  const reviewUrl: string =
    biz.review_url ?? (biz.place_id ? writeReviewUrl(biz.place_id) : FALLBACK_URL);
  const feedbackUrl: string = biz.feedback_url ?? "mailto:";

  return new Response(page(biz.name ?? "us", reviewUrl, feedbackUrl), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
});
