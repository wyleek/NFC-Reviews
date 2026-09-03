import { config } from "./config";

// Thin wrapper around admin-api — every write in the hub goes through
// here (never direct Supabase writes from the client). Same call shape
// admin.html/linkmaker.html and board/'s adminApi.js already use.
//
// Merged from two branches that each built this independently (Admin tab's
// search_place/lookup_business/quick_link/create_business, and the CRM
// tab's update_stage/log_activity/upsert_deal/set_sms_consent/
// log_pre_call/schedule_message — ported from board/src/lib/adminApi.js)
// — same file, disjoint sets of actions, so this keeps both. Reads
// config.fnUrl/config.token from the shared ./config.js (t2r_fn/t2r_token),
// not board/'s own t2r_admin_fn/t2r_admin_token — that's the actual point
// of the CRM-tab port: configuring the Admin tab now also configures this.
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
  // Admin tab
  searchPlace: (query) => call("search_place", { query }),

  // Accepts { place_id } (a fresh Google search result) or { business_id }
  // (a local-DB match, or a CRM "Manage in Admin" deep link, that may not
  // have a place_id on hand client-side) — see lookup_business in
  // supabase/functions/admin-api/index.ts.
  lookupBusiness: ({ place_id, business_id } = {}) => call("lookup_business", { place_id, business_id }),

  quickLink: ({ place_id, name, review_count, rating, label, type }) =>
    call("quick_link", { place_id, name, review_count, rating, label, type }),

  createBusiness: ({ name, place_id, review_count, rating, contact, cards }) =>
    call("create_business", { name, place_id, review_count, rating, contact, cards }),

  // CRM tab
  setFollowUp: (business_id, follow_up_at) => call("set_follow_up", { business_id, follow_up_at }),

  updateStage: (business_id, stage) => call("update_stage", { business_id, stage }),

  logActivity: (business_id, type, body, metadata) =>
    call("log_activity", { business_id, type, body, metadata }),

  upsertDeal: (deal) => call("upsert_deal", deal),

  setSmsConsent: (business_id, consent) => call("set_sms_consent", { business_id, consent }),

  logPreCall: (business_id, { contact_name, dm_days, dm_window, dm_window_start, dm_window_end, disqualifier }) =>
    call("log_pre_call", { business_id, contact_name, dm_days, dm_window, dm_window_start, dm_window_end, disqualifier }),

  scheduleMessage: (business_id, body, send_at) =>
    call("schedule_message", { business_id, body, send_at }),

  // CRM drawer — full inline editor (contacts/deals/activity/cards), added
  // to finish merging Admin's edit capabilities into the CRM drawer itself
  // rather than only deep-linking out to the Admin tab.
  addContact: ({ business_id, name, title, email, phone, role }) =>
    call("add_contact", { business_id, name, title, email, phone, role }),

  updateContact: ({ id, name, title, email, phone }) =>
    call("update_contact", { id, name, title, email, phone }),

  deleteContact: (id) => call("delete_contact", { id }),

  // Deal "update" is just upsert_deal with an id — see admin-api's
  // docstring for why there's no separate update_deal action.
  updateDeal: (deal) => call("upsert_deal", deal),

  deleteDeal: (id) => call("delete_deal", { id }),

  deleteActivity: (id) => call("delete_activity", { id }),

  addCard: ({ business_id, label, card_type }) =>
    call("add_card", { business_id, label, card_type }),

  updateCard: ({ id, label, card_type, active }) =>
    call("update_card", { id, label, card_type, active }),

  deleteCard: (id) => call("delete_card", { id }),

  // Call List quick-add — search_place + this is the whole flow (no wizard).
  // Also used by AdminTab.jsx's pickResult, so finding a business through
  // Admin lands it on the Call List too.
  addLead: (place_id, name) => call("add_lead", { place_id, name }),

  // The business's own general/front-line number — separate from a
  // contact's phone (add_contact/update_contact), which is a specific
  // owner/manager's direct line. add_lead auto-fills this from Google
  // Places; this is the manual correction/entry path.
  setBusinessPhone: (business_id, phone) => call("set_business_phone", { business_id, phone }),

  // Reversible Call List removal (CallList's "Remove" button, the drawer's
  // own toggle) — unlike log_pre_call's disqualifier, which only ever sets
  // do_not_contact, never clears it.
  setDoNotContact: (business_id, value) => call("set_do_not_contact", { business_id, value }),

  // Clears a business's logged call-schedule (days/time window) without
  // logging a new pre-call activity — CallList's "Reset" button.
  resetCallSchedule: (business_id) => call("reset_call_schedule", { business_id }),
};
