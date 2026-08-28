import { useState } from "react";
import { KanbanBoard } from "./crm/KanbanBoard";
import { BusinessDrawer } from "./crm/BusinessDrawer";
import { CallList } from "./crm/CallList";
import { NewLeadsList } from "./crm/NewLeadsList";

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
  { id: "leads", label: "New leads" },
];

export function CrmTab() {
  const [subtab, setSubtab] = useState("board");
  const [openBusinessId, setOpenBusinessId] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <div className="crm">
      <nav className="crm-nav">
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
      </nav>

      {subtab === "board" ? (
        <KanbanBoard onOpen={(b) => setOpenBusinessId(b.id)} refreshToken={refreshToken} />
      ) : subtab === "calls" ? (
        <CallList />
      ) : (
        <NewLeadsList />
      )}

      {openBusinessId ? (
        <BusinessDrawer
          businessId={openBusinessId}
          onClose={() => setOpenBusinessId(null)}
          onChanged={() => setRefreshToken((t) => t + 1)}
        />
      ) : null}
    </div>
  );
}
