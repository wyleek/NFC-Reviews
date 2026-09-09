// ============================================================================
// gbp-oauth-start — builds the Google consent URL for the logged-in owner
// to connect their Google Business Profile.
//
// Returns { url } as JSON rather than issuing the redirect itself: this is
// called from the client-dashboard app with the user's Supabase session
// (Authorization: Bearer <user JWT>) via fetch(), and a top-level browser
// navigation can't carry that header — so the page fetches the URL here,
// then does `window.location.href = url` itself. Resolves org_id from
// `memberships` (RLS-scoped to the caller), signs it into `state` so
// gbp-oauth-callback can trust it came from here.
//
// Deploy: supabase functions deploy gbp-oauth-start
// (verify_jwt stays ON — this is called by an authenticated browser, not Google)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { signState } from "../_shared/gbp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const OAUTH_REDIRECT_URI = Deno.env.get("GBP_OAUTH_REDIRECT_URI")!; // gbp-oauth-callback's deployed URL
const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET")!;

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("unauthorized", { status: 401 });

  // Scoped client: acts as the calling user, so RLS (own_memberships)
  // limits this to their own membership rows — no service role needed here.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: membership, error } = await asUser
    .from("memberships")
    .select("org_id")
    .limit(1)
    .maybeSingle();

  if (error || !membership) {
    return new Response(JSON.stringify({ error: "no membership for this user" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const state = await signState(
    { orgId: membership.org_id, nonce: crypto.randomUUID(), issuedAt: Date.now() },
    OAUTH_STATE_SECRET,
  );

  const consentUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  consentUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  consentUrl.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  consentUrl.searchParams.set("response_type", "code");
  consentUrl.searchParams.set("scope", "https://www.googleapis.com/auth/business.manage");
  consentUrl.searchParams.set("access_type", "offline");
  consentUrl.searchParams.set("prompt", "consent"); // guarantees a refresh_token every time
  consentUrl.searchParams.set("state", state);

  return new Response(JSON.stringify({ url: consentUrl.toString() }), {
    headers: { "Content-Type": "application/json" },
  });
});
