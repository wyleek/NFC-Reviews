import { useEffect } from "react";

// Popover panel for KanbanBoard's "Edit view" control — lets the user pick
// exactly which stage columns render, independent of card count. Closes on
// outside click/Escape like a normal popover; the actual persistence logic
// lives in KanbanBoard (onToggle/onReset).
//
// `containerRef` must point at the ancestor that also wraps the toggle
// button (KanbanBoard's toolbar div), not just this panel — otherwise a
// click on the button itself counts as "outside", firing onClose right
// before the button's own onClick re-opens the menu, which makes the
// button unable to close a menu it just opened.
export function EditViewMenu({ stages, labels, visibleSet, counts, onToggle, onReset, onClose, containerRef }) {
  useEffect(() => {
    function handlePointerDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) onClose();
    }
    function handleKeyDown(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, containerRef]);

  return (
    <div className="edit-view-menu" role="dialog" aria-label="Edit visible stages">
      <div className="edit-view-menu-header">
        <span>Visible stages</span>
        <button type="button" className="edit-view-menu-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <ul className="edit-view-menu-list">
        {stages.map((stage) => (
          <li key={stage}>
            <label>
              <input
                type="checkbox"
                checked={visibleSet.has(stage)}
                onChange={() => onToggle(stage)}
              />
              <span className="edit-view-menu-label">{labels[stage]}</span>
              <span className="edit-view-menu-count">{counts[stage] ?? 0}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="edit-view-menu-footer">
        <button type="button" className="edit-view-menu-reset" onClick={onReset}>
          Reset to default
        </button>
      </div>
    </div>
  );
}
