import { config } from "./config";

// Thin wrapper around admin-api for the Admin tab's flow — same call
// shape admin.html/linkmaker.html and board/'s adminApi.js already use.
// No backend changes on this branch: search_place / lookup_business /
// quick_link / create_business already exist in
// supabase/functions/admin-api/index.ts.
async function call(action, payload) {
  if (!config.fnUrl) throw new Error("No function URL set. Add it in Settings.");
  let res;
  try {
    res = await fetch(config.fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": config.token },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new Error("Could not reach the function. Check the URL and your connection.");
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      `Got a web page instead of data (HTTP ${res.status}). Your function URL is wrong or the function isn't deployed — it should end in /admin-api.`,
    );
  }
  if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status})`);
  return body;
}

export const adminApi = {
  searchPlace: (query) => call("search_place", { query }),

  lookupBusiness: (place_id) => call("lookup_business", { place_id }),

  quickLink: ({ place_id, name, review_count, rating, label, type }) =>
    call("quick_link", { place_id, name, review_count, rating, label, type }),

  createBusiness: ({ name, place_id, review_count, rating, contact, cards }) =>
    call("create_business", { name, place_id, review_count, rating, contact, cards }),
};
