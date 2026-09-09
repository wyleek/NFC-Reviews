// ============================================================================
// Shared helpers for the GBP OAuth + review-sync pipeline
// (gbp-oauth-start, gbp-oauth-callback, gbp-locations-connect,
// gbp-review-sync). First `_shared/` module in this repo — every other
// Edge Function here is self-contained, but four functions need the exact
// same state-signing / token-exchange / GBP-API-call logic, so it's
// factored out rather than copy-pasted four times.
// ============================================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Signed `state` param: encodes { orgId, nonce, issuedAt } and HMAC-signs it
// with OAUTH_STATE_SECRET, so gbp-oauth-callback can trust the org_id it
// carries without needing a server-side session store for the OAuth dance.
// ---------------------------------------------------------------------------

export interface OAuthState {
  orgId: string;
  nonce: string;
  issuedAt: number;
}

function base64url(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const str = atob(s);
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signState(state: OAuthState, secret: string): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(state)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${base64url(sig)}`;
}

export async function verifyState(
  token: string,
  secret: string,
  maxAgeMs = 10 * 60 * 1000, // 10 min — long enough for a consent screen, short enough to limit replay
): Promise<OAuthState | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, base64urlToBytes(sig), encoder.encode(payload));
  if (!valid) return null;
  try {
    const state = JSON.parse(decoder.decode(base64urlToBytes(payload))) as OAuthState;
    if (Date.now() - state.issuedAt > maxAgeMs) return null;
    return state;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Google OAuth token exchange / refresh
// ---------------------------------------------------------------------------

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`Google token endpoint ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
): Promise<GoogleTokens> {
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
}

export function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<GoogleTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
}

// ---------------------------------------------------------------------------
// GBP API calls. Account/location listing use the current (non-deprecated)
// split APIs; review read/reply stays on the legacy "My Business API v4"
// per the spec — that's still where the review surface lives.
// ---------------------------------------------------------------------------

export interface GbpAccount {
  name: string; // "accounts/{accountId}"
  accountName?: string;
  type?: string;
}

export interface GbpLocation {
  name: string; // "accounts/{accountId}/locations/{locationId}"
  title?: string;
  storefrontAddress?: Record<string, unknown>;
  metadata?: { placeId?: string };
}

export async function listGbpAccounts(accessToken: string): Promise<GbpAccount[]> {
  const res = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`accounts.list ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.accounts ?? [];
}

export async function listGbpLocations(accessToken: string, accountName: string): Promise<GbpLocation[]> {
  const locations: GbpLocation[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`);
    url.searchParams.set("readMask", "name,title,storefrontAddress,metadata");
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`locations.list ${res.status}: ${await res.text()}`);
    const data = await res.json();
    locations.push(...(data.locations ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return locations;
}

export interface GbpReview {
  reviewId: string;
  reviewer?: { displayName?: string; profilePhotoUrl?: string };
  starRating?: string; // "ONE".."FIVE"
  comment?: string;
  createTime?: string;
  updateTime?: string;
  reviewReply?: { comment?: string; updateTime?: string };
}

const STAR_RATING: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

export function starRatingToInt(rating: string | undefined): number | null {
  return rating ? STAR_RATING[rating] ?? null : null;
}

export async function fetchReviewsPage(
  accessToken: string,
  gbpLocationName: string,
  pageToken?: string,
): Promise<{ reviews: GbpReview[]; nextPageToken?: string }> {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${gbpLocationName}/reviews`);
  url.searchParams.set("pageSize", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`reviews.list ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { reviews: data.reviews ?? [], nextPageToken: data.nextPageToken };
}
