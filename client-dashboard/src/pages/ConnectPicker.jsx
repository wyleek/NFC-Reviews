import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOrg } from "../lib/OrgProvider";

const CONNECT_URL = import.meta.env.VITE_GBP_LOCATIONS_CONNECT_URL;

async function authedFetch(method, extra) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return fetch(extra?.url ?? CONNECT_URL, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: extra?.body ? JSON.stringify(extra.body) : undefined,
  });
}

// Shown after gbp-oauth-callback redirects here with ?staging_id=... — the
// staged location list (never auto-picked) for the owner to confirm. A
// single staged location still requires the explicit click (guard-first
// MVP, per spec) rather than silently connecting it.
export function ConnectPicker() {
  const { refresh } = useOrg();
  const stagingId = new URLSearchParams(window.location.search).get("staging_id");

  const [locations, setLocations] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    if (!stagingId) {
      setError("Missing staging_id — please reconnect.");
      return;
    }
    authedFetch("GET", { url: `${CONNECT_URL}?staging_id=${encodeURIComponent(stagingId)}` })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `${res.status}`);
        setLocations(body.locations ?? []);
        if (body.locations?.length === 1) {
          setSelected(new Set([body.locations[0].gbp_location_name]));
        }
      })
      .catch((e) => setError(e.message));
  }, [stagingId]);

  function toggle(name) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  async function confirm() {
    setConnecting(true);
    setError(null);
    try {
      const res = await authedFetch("POST", {
        body: { staging_id: stagingId, selected: Array.from(selected) },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      await refresh();
      window.location.href = "/";
    } catch (e) {
      setError(e.message);
      setConnecting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
        <h1 className="text-lg font-semibold text-neutral-900 text-center">Choose your location</h1>

        {error && <p className="text-xs text-red-600 text-center">{error}</p>}

        {!locations && !error && (
          <p className="text-sm text-neutral-500 text-center">Loading your locations…</p>
        )}

        {locations?.length === 0 && (
          <p className="text-sm text-neutral-500 text-center">
            No locations found on that Google account.
          </p>
        )}

        {locations?.map((loc) => (
          <label
            key={loc.gbp_location_name}
            className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3 text-sm cursor-pointer has-[:checked]:border-neutral-900"
          >
            <input
              type="checkbox"
              checked={selected.has(loc.gbp_location_name)}
              onChange={() => toggle(loc.gbp_location_name)}
            />
            <span className="text-neutral-800">{loc.display_name ?? loc.gbp_location_name}</span>
          </label>
        ))}

        {locations?.length > 0 && (
          <button
            type="button"
            disabled={selected.size === 0 || connecting}
            onClick={confirm}
            className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : `Connect ${selected.size || ""} location${selected.size === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
