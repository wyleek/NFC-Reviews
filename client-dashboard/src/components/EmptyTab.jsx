// Placeholder for the four tabs whose real content ships in later module
// branches (see docs/PLAN-customer-dashboard.md — B/C/D/E/F/G/H). Kept
// thin and slot-based so each feature branch drops its content in here
// without touching App.jsx or the other tabs.
export function EmptyTab({ label }) {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <p className="text-sm text-neutral-400">{label} — coming soon</p>
    </div>
  );
}
