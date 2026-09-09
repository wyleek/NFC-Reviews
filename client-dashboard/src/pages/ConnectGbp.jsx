import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const GBP_OAUTH_START_URL = import.meta.env.VITE_GBP_OAUTH_START_URL;

// Shown when the logged-in org has zero `locations` yet. Fetches the
// Google consent URL from gbp-oauth-start (authenticated via the user's
// access token) and then navigates the whole page there — the Edge
// Function does the rest (Google → gbp-oauth-callback → /connect/picker).
export function ConnectGbp() {
  const [busy, setBusy] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const params = new URLSearchParams(window.location.search);
  const callbackError = params.get("error");

  async function connect() {
    setBusy(true);
    setFetchError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch(GBP_OAUTH_START_URL, {
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      if (!res.ok) throw new Error(`gbp-oauth-start ${res.status}`);
      const { url } = await res.json();
      window.location.href = url;
    } catch (e) {
      setFetchError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4 text-center">
        <h1 className="text-lg font-semibold text-neutral-900">Connect your business</h1>
        <p className="text-sm text-neutral-500">
          Link your Google Business Profile so we can start tracking your reviews.
        </p>
        {callbackError && (
          <p className="text-xs text-red-600">
            Connection failed ({callbackError}). Please try again, or make sure you're an
            owner/manager on the Google Business Profile.
          </p>
        )}
        {fetchError && <p className="text-xs text-red-600">{fetchError}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={connect}
          className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {busy ? "Connecting…" : "Connect Google Business Profile"}
        </button>
      </div>
    </div>
  );
}
