import { STAGES, STAGE_LABELS, STAGE_NEXT_ACTION } from "../../lib/stages";

function daysInStage(stageUpdatedAt) {
  if (!stageUpdatedAt) return null;
  const ms = Date.now() - new Date(stageUpdatedAt).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// crm-spec.md 2a: "Card shows: name, category, review count (from latest
// review_snapshots), rank score, days-in-stage, next action."
//
// Moving a card between stages has two paths: drag-and-drop (StageColumn's
// onDrop) for desktop mice/trackpads, and this select as the fallback that
// works everywhere drag doesn't (touchscreens, trackpad quirks, browsers
// that don't fire native HTML5 DnD reliably) — crm-spec.md 2a only asks
// for "kanban columns... drag/tap to change stage," so tap-via-select
// satisfies that as well as drag does.
export function BusinessCard({ business, onOpen, onMoveStage }) {
  const days = daysInStage(business.stage_updated_at);
  const nextAction = business.best_callback_window || STAGE_NEXT_ACTION[business.stage] || "—";

  return (
    <div
      className="biz-card"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/plain", business.id)}
      onClick={() => onOpen(business)}
    >
      <div className="biz-card-name">
        {business.name}
        {/* City disambiguates same-named locations of a chain — without
            it two "Ledo Pizza" cards on the board look identical. */}
        {business.city ? <span className="biz-card-city">{business.city}</span> : null}
      </div>
      <div className="biz-card-meta">
        {business.category_group ? <span className="pill">{business.category_group}</span> : null}
        {business.tier ? <span className="pill">Tier {business.tier}</span> : null}
        <span>
          {business.current_rating ?? "—"}★ ({business.current_review_count ?? "?"})
        </span>
      </div>
      <div className="biz-card-footer">
        <span>{business.rank_score != null ? `Rank ${Number(business.rank_score).toFixed(1)}` : ""}</span>
        <span>{days != null ? `${days}d in stage` : ""}</span>
      </div>
      <div className="biz-card-next">{nextAction}</div>
      <select
        className="stage-select"
        value={business.stage}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          onMoveStage(business.id, e.target.value);
        }}
      >
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    </div>
  );
}
