import { useState } from "react";
import { config } from "./lib/config";
import { Settings } from "./components/Settings";
import { AdminTab } from "./components/AdminTab";
import { CrmTab } from "./components/CrmTab";
import { ClientsTab } from "./components/ClientsTab";

const TABS = [
  { id: "admin", label: "Admin", icon: "➕" },
  { id: "crm", label: "CRM", icon: "📋" },
  { id: "clients", label: "Clients", icon: "📊" },
];

function App() {
  const [configured, setConfigured] = useState(config.isSet);
  const [tab, setTab] = useState("admin");
  // Carries a business_id from CRM's "Manage in Admin" over to the Admin
  // tab so it can auto-load that business into its lookup flow — no URL
  // routing, just in-memory state lifted up here since both tabs are
  // siblings. AdminTab clears it via onDeepLinkHandled once consumed.
  const [adminDeepLinkId, setAdminDeepLinkId] = useState(null);

  function openInAdmin(businessId) {
    setAdminDeepLinkId(businessId);
    setTab("admin");
  }

  if (!configured) {
    return <Settings onSaved={() => setConfigured(true)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">WM Marketing</span>
        <button type="button" className="btn ghost sm" onClick={() => setConfigured(false)}>
          Settings
        </button>
      </header>

      {tab === "admin" ? (
        <AdminTab deepLinkBusinessId={adminDeepLinkId} onDeepLinkHandled={() => setAdminDeepLinkId(null)} />
      ) : tab === "crm" ? (
        <CrmTab onManageInAdmin={openInAdmin} />
      ) : (
        <ClientsTab />
      )}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            <span className="icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
