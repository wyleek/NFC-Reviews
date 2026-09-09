// ============================================================================
// gbp-locations-connect — the picker page's read + "Connect" actions.
//
// GET  ?staging_id=<id>            → returns the staged location list, so
//   the picker page has something to render (oauth_staging has no client
//   RLS policy — service-role only — so this is the only way to read it).
// POST { staging_id, selected[] }  → writes the real `locations` row(s)
//   for the owner's selection and kicks off the first sync. If exactly one
//   location was staged, the picker page should still call this explicitly
//   (guard-first auto-select, not a silent write) rather than skip the
//   confirm step.
//
// Deploy: supabase functions deploy gbp-locations-connect
// (verify_jwt stays ON — called by the authenticated owner from the picker page)
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GBP_SYNC_CRON_SECRET = Deno.env.get("GBP_SYNC_CRON_SECRET")!;
const FUNCTIONS_BASE_URL = Deno.env.get("SUPABASE_FUNCTIONS_URL")!; // e.g. https://<ref>.functions.supabase.co

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

interface StagedLocation {
  gbp_location_name: string;
  display_name: string | null;
  place_id: string | null;
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("unauthorized", { status: 401 });

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: membership } = await asUser.from("memberships").select("org_id").limit(1).maybeSingle();
  if (!membership) return new Response(JSON.stringify({ error: "no membership" }), { status: 403 });

  const url = new URL(req.url);
  const stagingId = req.method === "GET" ? url.searchParams.get("staging_id") : undefined;

  async function loadStaging(id: string) {
    const { data: staged, error: stagedErr } = await admin
      .from("oauth_staging")
      .select("org_id, payload, expires_at")
      .eq("id", id)
      .maybeSingle();
    if (stagedErr || !staged) return { error: "staging row not found", status: 404 } as const;
    if (staged.org_id !== membership.org_id) return { error: "forbidden", status: 403 } as const;
    if (new Date(staged.expires_at) < new Date()) return { error: "staging expired, reconnect", status: 410 } as const;
    return { staged } as const;
  }

  if (req.method === "GET") {
    if (!stagingId) return new Response(JSON.stringify({ error: "staging_id is required" }), { status: 400 });
    const result = await loadStaging(stagingId);
    if ("error" in result) return new Response(JSON.stringify({ error: result.error }), { status: result.status });
    return new Response(JSON.stringify(result.staged.payload), { headers: { "Content-Type": "application/json" } });
  }

  const { staging_id, selected } = await req.json();
  if (!staging_id || !Array.isArray(selected) || selected.length === 0) {
    return new Response(JSON.stringify({ error: "staging_id and selected[] are required" }), { status: 400 });
  }

  const result = await loadStaging(staging_id);
  if ("error" in result) return new Response(JSON.stringify({ error: result.error }), { status: result.status });
  const { staged } = result;

  const stagedLocations: StagedLocation[] = staged.payload.locations ?? [];
  const chosen = stagedLocations.filter((l) => selected.includes(l.gbp_location_name));
  if (chosen.length === 0) {
    return new Response(JSON.stringify({ error: "none of the selected locations were staged" }), { status: 400 });
  }

  const inserted: string[] = [];
  for (const loc of chosen) {
    // Best-effort link back to the CRM's `businesses` row for the same
    // physical business, matched on Google place id. Left null if no match
    // — staff can link it manually later; this never blocks the connect.
    let businessId: string | null = null;
    if (loc.place_id) {
      const { data: biz } = await admin
        .from("businesses")
        .select("id")
        .eq("google_place_id", loc.place_id)
        .maybeSingle();
      businessId = biz?.id ?? null;
    }

    const { data: row, error: insertErr } = await admin
      .from("locations")
      .insert({
        org_id: membership.org_id,
        business_id: businessId,
        gbp_account_name: staged.payload.accountName,
        gbp_location_name: loc.gbp_location_name,
        place_id: loc.place_id,
        display_name: loc.display_name,
        connected_at: new Date().toISOString(),
        sync_status: "pending",
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("failed to insert location", loc.gbp_location_name, insertErr);
      continue;
    }
    inserted.push(row.id);
  }

  await admin.from("oauth_staging").delete().eq("id", staging_id);

  // Kick off the first sync for the new location(s) — fire-and-forget is
  // fine here; the cron job will pick up anything that doesn't land.
  if (inserted.length > 0) {
    fetch(`${FUNCTIONS_BASE_URL}/gbp-review-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": GBP_SYNC_CRON_SECRET },
      body: JSON.stringify({ location_ids: inserted }),
    }).catch((e) => console.error("failed to kick off first sync", e));
  }

  return new Response(JSON.stringify({ connected: inserted }), {
    headers: { "Content-Type": "application/json" },
  });
});
