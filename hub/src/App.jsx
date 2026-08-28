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

  if (!configured) {
    return <Settings onSaved={() => setConfigured(true)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">Tap2Review</span>
        <button type="button" className="btn ghost sm" onClick={() => setConfigured(false)}>
          Settings
        </button>
      </header>

      {tab === "admin" ? <AdminTab /> : tab === "crm" ? <CrmTab /> : <ClientsTab />}

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
