// ============================================================================
// gbp-oauth-callback — Google redirects here after consent. Exchanges the
// code for tokens, stores them, fetches the account's locations, and
// STAGES them (oauth_staging) for the picker page to show — never writes
// locations[0] silently (that was the known bug this spec calls out).
//
// This is a server-to-server redirect target hit directly by Google, so
// there's no user session on this request — trust is established entirely
// via the signed `state` param minted by gbp-oauth-start.
//
// Deploy: supabase functions deploy gbp-oauth-callback --no-verify-jwt
// (no user JWT is ever present on this request; `state` is what's checked)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";
import { exchangeCodeForTokens, listGbpAccounts, listGbpLocations, verifyState } from "../_shared/gbp.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const OAUTH_REDIRECT_URI = Deno.env.get("GBP_OAUTH_REDIRECT_URI")!;
const OAUTH_STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET")!;
const CLIENT_APP_URL = Deno.env.get("CLIENT_APP_URL")!; // e.g. https://app.wmmarketing.example

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function toErrorPage(reason: string): Response {
  const url = new URL(`${CLIENT_APP_URL}/connect`);
  url.searchParams.set("error", reason);
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error"); // e.g. "access_denied" if the owner declined

  if (googleError) return toErrorPage(googleError);
  if (!code || !state) return toErrorPage("missing_code_or_state");

  const parsedState = await verifyState(state, OAUTH_STATE_SECRET);
  if (!parsedState) return toErrorPage("invalid_state");
  const { orgId } = parsedState;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code, OAUTH_REDIRECT_URI, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  } catch (e) {
    console.error("token exchange failed", e);
    return toErrorPage("token_exchange_failed");
  }

  let accounts, locations;
  try {
    accounts = await listGbpAccounts(tokens.access_token);
    if (accounts.length === 0) return toErrorPage("no_gbp_accounts");
    // MVP: use the first account. An owner with multiple GBP accounts would
    // need to repeat the connect flow per account — not needed for v1.
    const account = accounts[0];
    locations = await listGbpLocations(tokens.access_token, account.name);

    // google_sub: the GBP account id doubles as the stable per-account
    // identifier (no OIDC scope was requested, so there's no true `sub` —
    // see docs/BRANCH_BRIEF-foundation.md).
    const googleSub = account.name;
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Preserve the existing refresh_token if Google didn't send a new one
    // (only guaranteed on first consent; prompt=consent should always
    // return one, but don't clobber a good token with a missing one).
    const { data: existing } = await admin
      .from("oauth_tokens")
      .select("refresh_token")
      .eq("org_id", orgId)
      .eq("google_sub", googleSub)
      .maybeSingle();

    const { error: upsertErr } = await admin.from("oauth_tokens").upsert(
      {
        org_id: orgId,
        google_sub: googleSub,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? existing?.refresh_token,
        scope: tokens.scope,
        expiry,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,google_sub" },
    );
    if (upsertErr) throw upsertErr;

    const { data: staged, error: stagingErr } = await admin
      .from("oauth_staging")
      .insert({
        org_id: orgId,
        payload: {
          accountName: account.name,
          locations: locations.map((l) => ({
            gbp_location_name: l.name,
            display_name: l.title ?? null,
            place_id: l.metadata?.placeId ?? null,
          })),
        },
      })
      .select("id")
      .single();
    if (stagingErr) throw stagingErr;

    const pickerUrl = new URL(`${CLIENT_APP_URL}/connect/picker`);
    pickerUrl.searchParams.set("staging_id", staged.id);
    return Response.redirect(pickerUrl.toString(), 302);
  } catch (e) {
    console.error("gbp-oauth-callback failed", e);
    return toErrorPage("gbp_fetch_failed");
  }
});
