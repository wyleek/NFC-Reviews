// Runtime config, entered once and stored in localStorage — one shared
// object for every tab (Admin, CRM, Clients). Uses the SAME keys as
// admin.html/linkmaker.html (t2r_fn / t2r_token / t2r_dash), not board/'s
// t2r_admin_fn / t2r_admin_token — those two disagreed, which meant
// configuring Admin didn't configure the CRM board and vice versa. This
// is the single config every ported tab should import instead of
// carrying its own copy forward.
const KEY_FN = 't2r_fn';
const KEY_TOKEN = 't2r_token';
const KEY_DASH = 't2r_dash';

// Default points at the live client-dashboard deploy (Vercel) — same
// default as admin.html's Settings screen. Override in Settings if it
// ever moves to a custom domain.
export const DEFAULT_DASHBOARD_URL = 'https://dashboard-app-omega-beige.vercel.app';

export const config = {
  get fnUrl() {
    return localStorage.getItem(KEY_FN) || import.meta.env.VITE_ADMIN_API_URL || '';
  },
  get token() {
    return localStorage.getItem(KEY_TOKEN) || '';
  },
  get dashUrl() {
    return localStorage.getItem(KEY_DASH) || DEFAULT_DASHBOARD_URL;
  },
  set(fnUrl, token, dashUrl) {
    localStorage.setItem(KEY_FN, fnUrl);
    localStorage.setItem(KEY_TOKEN, token);
    localStorage.setItem(KEY_DASH, dashUrl || DEFAULT_DASHBOARD_URL);
  },
  get isSet() {
    return Boolean(this.fnUrl && this.token);
  },
};

// The client's dashboard link — no UUID typing, ever. Same helper as
// admin.html's dashboardUrl(), moved here so every tab shares it.
export function dashboardUrl(businessId) {
  return `${config.dashUrl.replace(/\/$/, '')}/?business=${businessId}`;
}
