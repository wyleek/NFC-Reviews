import { useState } from "react";
import { AuthProvider, useAuth } from "./lib/AuthProvider";
import { OrgProvider, useOrg } from "./lib/OrgProvider";
import { supabaseConfigured } from "./lib/supabaseClient";
import { Login } from "./pages/Login";
import { ConnectGbp } from "./pages/ConnectGbp";
import { ConnectPicker } from "./pages/ConnectPicker";
import { EmptyTab } from "./components/EmptyTab";
import { SettingsTab } from "./components/SettingsTab";

const TABS = [
  { id: "home", label: "Home", icon: "🏠" },
  { id: "reviews", label: "Reviews", icon: "⭐" },
  { id: "insights", label: "Insights", icon: "📈" },
  { id: "reports", label: "Reports", icon: "📄" },
  { id: "settings", label: "Settings", icon: "⚙️" },
];

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-neutral-400">
      Loading…
    </div>
  );
}

function TabShell() {
  const [tab, setTab] = useState("home");
  const { signOut } = useAuth();
  const { org } = useOrg();

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <header className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 bg-white">
        <span className="text-sm font-semibold text-neutral-900">{org?.name}</span>
        <button type="button" onClick={signOut} className="text-xs text-neutral-400">
          Sign out
        </button>
      </header>

      {tab === "home" && <EmptyTab label="Home" />}
      {tab === "reviews" && <EmptyTab label="Reviews" />}
      {tab === "insights" && <EmptyTab label="Insights" />}
      {tab === "reports" && <EmptyTab label="Reports" />}
      {tab === "settings" && <SettingsTab />}

      <nav className="flex border-t border-neutral-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs ${
              tab === t.id ? "text-neutral-900 font-medium" : "text-neutral-400"
            }`}
          >
            <span className="text-base leading-none">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Authed() {
  const { org, locations, loading } = useOrg();
  const path = window.location.pathname;

  if (loading) return <Loading />;

  // Connect-flow routes are full-page redirect targets from the
  // gbp-oauth-callback Edge Function, not in-app tab navigation — a plain
  // pathname check is enough, no router needed (same no-router convention
  // as hub/).
  if (path === "/connect/picker") return <ConnectPicker />;
  if (path === "/connect" || !org || locations.length === 0) return <ConnectGbp />;

  return <TabShell />;
}

function Gate() {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Login />;
  return (
    <OrgProvider>
      <Authed />
    </OrgProvider>
  );
}

function App() {
  if (!supabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center text-sm text-neutral-500">
        Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local.
      </div>
    );
  }

  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

export default App;
