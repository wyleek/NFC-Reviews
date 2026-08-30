import { useState } from "react";
import { KanbanBoard } from "./crm/KanbanBoard";
import { BusinessDrawer } from "./crm/BusinessDrawer";
import { CallList } from "./crm/CallList";
import { supabaseConfigured } from "../lib/supabaseClient";

// Port of board/ (branch feature/crm-pipeline-board) into the hub — see
// docs/BRANCH_BRIEF-hub-crm-tab.md. Same 9 components, same behavior;
// what changed is the config it reads (hub/src/lib/config.js's shared
// t2r_fn/t2r_token instead of board/'s own t2r_admin_fn/t2r_admin_token)
// and the theme (hub/src/theme.css + crm.css instead of board/'s dark
// index.css). The Settings gate and app-header/tabbar live one level up
// in App.jsx now — this component owns only the board/calls/leads
// sub-nav and the drawer overlay, same shape board/src/App.jsx had.
const SUBTABS = [
  { id: "board", label: "Board" },
  { id: "calls", label: "Call list" },
];

// "New leads" sub-tab (NewLeadsList.jsx, reading the v_call_list view) was
// removed from view at the user's request — the manual add-business flow
// (AdminTab) replaced the scraper-fed leads pipeline it was built for.
// The component still exists if it's ever needed again.

export function CrmTab({ onManageInAdmin }) {
  const [subtab, setSubtab] = useState("board");
  const [openBusinessId, setOpenBusinessId] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [search, setSearch] = useState("");

  if (!supabaseConfigured) {
    return (
      <div className="wrap">
        <div className="card">
          <div className="step">CRM</div>
          <h2>Supabase isn't configured</h2>
          <p className="sub">
            Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{" "}
            <code>hub/.env.local</code> (see <code>hub/.env.example</code>) and restart the dev
            server or rebuild.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="crm">
      <nav className="crm-nav" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SUBTABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={subtab === t.id ? "active" : ""}
              onClick={() => setSubtab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Search businesses…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240, padding: "8px 12px", fontSize: 14 }}
        />
      </nav>

      {subtab === "board" ? (
        <KanbanBoard onOpen={(b) => setOpenBusinessId(b.id)} refreshToken={refreshToken} search={search} />
      ) : (
        <CallList search={search} />
      )}

      {openBusinessId ? (
        <BusinessDrawer
          businessId={openBusinessId}
          onClose={() => setOpenBusinessId(null)}
          onChanged={() => setRefreshToken((t) => t + 1)}
          onManageInAdmin={onManageInAdmin}
        />
      ) : null}
    </div>
  );
}
