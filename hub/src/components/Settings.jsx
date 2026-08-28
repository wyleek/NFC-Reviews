import { useState } from "react";
import { config, DEFAULT_DASHBOARD_URL } from "../lib/config";

// First-run gate — nothing works until admin-api's URL + your ADMIN_TOKEN
// are entered once, then it's remembered in this browser via
// localStorage. One gate for all three tabs (Admin/CRM/Clients), unlike
// today where admin.html, linkmaker.html, and the CRM board each asked
// separately.
export function Settings({ onSaved }) {
  const [fnUrl, setFnUrl] = useState(config.fnUrl);
  const [token, setToken] = useState(config.token);
  const [dashUrl, setDashUrl] = useState(config.dashUrl);

  function save(e) {
    e.preventDefault();
    if (!fnUrl || !token) return;
    config.set(fnUrl.trim(), token.trim(), dashUrl.trim());
    onSaved();
  }

  return (
    <div className="settings-gate">
      <form className="settings-form" onSubmit={save}>
        <h1>Tap2Review</h1>
        <p className="sub">Enter these once — stored only in this browser.</p>
        <label>
          Admin function URL
          <input
            value={fnUrl}
            onChange={(e) => setFnUrl(e.target.value)}
            placeholder="https://<project-ref>.functions.supabase.co/admin-api"
          />
        </label>
        <label>
          Admin token
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="your ADMIN_TOKEN"
          />
        </label>
        <label>
          Dashboard URL
          <input
            value={dashUrl}
            onChange={(e) => setDashUrl(e.target.value)}
            placeholder={DEFAULT_DASHBOARD_URL}
          />
        </label>
        <button type="submit" className="btn">Save &amp; continue</button>
      </form>
    </div>
  );
}
