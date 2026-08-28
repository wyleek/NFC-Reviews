import { config } from "./config";

// Thin wrapper around admin-api — all writes for the CRM tab go through
// here (never direct Supabase writes from the client). Matches the call
// shape admin.html/linkmaker.html already use.
//
// Ported from board/src/lib/adminApi.js (feature/hub-crm-tab). Reads
// config.fnUrl/config.token from the shared ./config.js (t2r_fn/t2r_token)
// instead of board/'s own t2r_admin_fn/t2r_admin_token — that's the actual
// point of this branch: configuring the Admin tab now also configures
// this one.
async function call(action, payload) {
  const res = await fetch(config.fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-admin-token": config.token },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${action} failed (${res.status})`);
  return body;
}

export const adminApi = {
  updateStage: (business_id, stage) => call("update_stage", { business_id, stage }),

  logActivity: (business_id, type, body, metadata) =>
    call("log_activity", { business_id, type, body, metadata }),

  upsertDeal: (deal) => call("upsert_deal", deal),

  setSmsConsent: (business_id, consent) => call("set_sms_consent", { business_id, consent }),

  logPreCall: (business_id, { contact_name, dm_days, dm_window, disqualifier }) =>
    call("log_pre_call", { business_id, contact_name, dm_days, dm_window, disqualifier }),

  scheduleMessage: (business_id, body, send_at) =>
    call("schedule_message", { business_id, body, send_at }),
};
