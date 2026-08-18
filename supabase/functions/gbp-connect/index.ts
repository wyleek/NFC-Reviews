// ============================================================================
// gbp-connect — Google Business Profile OAuth: connect a business's own
// listing so gbp-sync can pull its durable (ToS-safe) rating/review history.
//
// Routes:
//   GET /gbp-connect/start?business_id=<uuid>    → redirect to Google consent
//   GET /gbp-connect/callback?code=...&state=... → exchange code, store tokens
//
// UNTESTED — there's no GBP API access / OAuth client for this project yet
// (unlike Places, the Business Profile API requires a Google approval
// process; see supabase/README.md). The token exchange and refresh flow
// below is standard OAuth2 and should be right, but the actual GBP account/
// location discovery calls (which API surface, which fields) need a real
// verification pass against current Google docs once access is granted —
// this API has been split and renamed by Google more than once.
//
// Until GBP_CLIENT_ID/GBP_CLIENT_SECRET/GBP_REDIRECT_URI are set, both
// routes return a clear "not configured" response instead of crashing, so
// admin.html's "Connect GBP" link degrades gracefully in the meantime.
//
// Deploy: supabase functions deploy gbp-connect --no-verify-jwt
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const CLIENT_ID = Deno.env.get("GBP_CLIENT_ID");
const CLIENT_SECRET = Deno.env.get("GBP_CLIENT_SECRET");
const REDIRECT_URI = Deno.env.get("GBP_REDIRECT_URI");
const SCOPE = "https://www.googleapis.com/auth/business.manage";

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><body style="font-family:-apple-system,sans-serif;padding:40px;max-width:520px;margin:0 auto">${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function notConfigured() {
  return html(
    `<h2>Google Business Profile isn't set up yet</h2>
     <p>GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REDIRECT_URI aren't set on this project.
     Business Profile API access has to be requested from Google first — see
     <code>supabase/README.md</code> for the checklist — then register an OAuth client
     and set those three secrets.</p>`,
    501,
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const action = parts[parts.length - 1];

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) return notConfigured();

  // ------------------------------------------------------------------ start
  if (action === "start") {
    const businessId = url.searchParams.get("business_id");
    if (!businessId) return html("<p>Missing business_id.</p>", 400);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", SCOPE);
    authUrl.searchParams.set("access_type", "offline"); // needed for a refresh_token
    authUrl.searchParams.set("prompt", "consent");       // force refresh_token on repeat connects
    authUrl.searchParams.set("state", businessId);

    return new Response(null, { status: 302, headers: { Location: authUrl.toString() } });
  }

  // --------------------------------------------------------------- callback
  if (action === "callback") {
    const code = url.searchParams.get("code");
    const businessId = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) return html(`<p>Google declined the connection: ${err}</p>`, 400);
    if (!code || !businessId) return html("<p>Missing code or state.</p>", 400);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) return html(`<p>Token exchange failed: ${await tokenRes.text()}</p>`, 502);
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) {
      // Google only returns a refresh_token on the FIRST consent (or when
      // prompt=consent forces re-issue). If this business was connected
      // before and somehow lost prompt=consent, there's nothing to persist.
      return html("<p>No refresh token returned — try reconnecting from scratch.</p>", 502);
    }

    // Discover the GBP account + location for this listing. NOTE: unverified
    // — confirm these are still the right endpoints/fields once real access
    // exists (see module header).
    const acctRes = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!acctRes.ok) return html(`<p>Couldn't list GBP accounts: ${await acctRes.text()}</p>`, 502);
    const accounts = (await acctRes.json()).accounts ?? [];
    const account = accounts[0];
    if (!account) return html("<p>No Business Profile accounts found for this Google login.</p>", 400);

    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title`,
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!locRes.ok) return html(`<p>Couldn't list locations: ${await locRes.text()}</p>`, 502);
    const locations = (await locRes.json()).locations ?? [];
    const location = locations[0];
    if (!location) return html("<p>No locations found on this Business Profile account.</p>", 400);
    // Simplification: takes the first account/location rather than letting
    // the owner pick among several. Revisit once this can be tested against
    // a real multi-location account.

    const { error } = await admin.from("gbp_connections").upsert({
      business_id: businessId,
      gbp_account_id: account.name,
      gbp_location_id: location.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      connected_at: new Date().toISOString(),
    }, { onConflict: "business_id" });
    if (error) return html(`<p>Saved tokens but DB write failed: ${error.message}</p>`, 500);

    return html(`<h2>Connected ✓</h2><p>${location.title ?? location.name} is now linked. gbp-sync will start pulling its review history on the next scheduled run.</p>`);
  }

  return html("<p>Unknown route.</p>", 404);
});
