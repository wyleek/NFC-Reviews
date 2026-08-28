// Placeholder — built out on feature/hub-crm-tab (see
// docs/BRANCH_BRIEF-hub-crm-tab.md). Ports board/'s existing 9
// components (KanbanBoard, BusinessDrawer, CallList, NewLeadsList, ...)
// in, re-pointed at the shared ../lib/config.js and re-themed from
// board/src/index.css's dark palette to theme.css's light one.
export function CrmTab() {
  return (
    <div className="wrap">
      <div className="card">
        <div className="step">CRM</div>
        <h2>Coming soon</h2>
        <p className="sub">
          Built on <code>feature/hub-crm-tab</code> — see
          docs/BRANCH_BRIEF-hub-crm-tab.md.
        </p>
      </div>
    </div>
  );
}
