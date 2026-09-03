import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import { adminApi } from "../../lib/adminApi";
import { STAGES, STAGE_LABELS } from "../../lib/stages";
import { useVisibleStages } from "../../lib/useVisibleStages";
import { StageColumn } from "./StageColumn";
import { EditViewMenu } from "./EditViewMenu";

const BUSINESS_FIELDS =
  "id, name, stage, stage_updated_at, current_review_count, current_rating, phone, city, zip, " +
  "rank_score, traffic_score, category_group, tier, corridor, best_callback_window, " +
  "sms_consent, do_not_contact";

export function KanbanBoard({ onOpen, refreshToken, search = "" }) {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleStages, { set: setVisibleStages, reset: resetVisibleStages }] = useVisibleStages();
  const toolbarRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("businesses")
      .select(BUSINESS_FIELDS)
      .order("rank_score", { ascending: false, nullsFirst: false });
    if (error) setError(error.message);
    else {
      setError(null);
      setBusinesses(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  async function handleDrop(businessId, stage) {
    const business = businesses.find((b) => b.id === businessId);
    if (!business || business.stage === stage) return;
    // optimistic update, then reconcile with the server write
    setBusinesses((prev) => prev.map((b) => (b.id === businessId ? { ...b, stage } : b)));
    try {
      await adminApi.updateStage(businessId, stage);
    } catch (err) {
      setError(err.message);
    }
    load();
  }

  if (loading && businesses.length === 0) return <div className="board-status">Loading board…</div>;
  if (error) return <div className="board-status error">{error}</div>;

  const q = search.trim().toLowerCase();
  const visible = q ? businesses.filter((b) => b.name?.toLowerCase().includes(q)) : businesses;

  // Every possible stage, in canonical order, with the (search-filtered)
  // cards currently in it. `hasCustomView` is false until the user opens
  // "Edit view" and makes an explicit choice — until then we auto-hide
  // empty columns (today's existing behavior, preserved as the default).
  // Once they've chosen, that choice sticks: a pinned-visible column stays
  // visible even if it empties out, and a hidden column stays hidden even
  // if a card is later dropped into it via the card's own stage <select>.
  const allColumns = STAGES.map((stage) => ({
    stage,
    businesses: visible.filter((b) => b.stage === stage),
  }));

  const hasCustomView = visibleStages !== null;
  const shownColumns = hasCustomView
    ? allColumns.filter((c) => visibleStages.includes(c.stage))
    : allColumns.filter((c) => c.businesses.length > 0);

  const shownStageSet = new Set(shownColumns.map((c) => c.stage));
  const hiddenWithCards = allColumns.filter(
    (c) => !shownStageSet.has(c.stage) && c.businesses.length > 0
  );
  const hiddenCardCount = hiddenWithCards.reduce((n, c) => n + c.businesses.length, 0);

  function toggleStage(stage) {
    // First toggle ever: start from what's on screen right now (the
    // auto-hide-empty default) so flipping one checkbox doesn't also
    // silently hide every other empty column out from under the user.
    const base = hasCustomView
      ? visibleStages
      : allColumns.filter((c) => c.businesses.length > 0).map((c) => c.stage);
    const next = base.includes(stage) ? base.filter((s) => s !== stage) : [...base, stage];
    setVisibleStages(next);
  }

  const toolbar = (
    <div className="board-toolbar" ref={toolbarRef}>
      <div className="board-toolbar-controls">
        <button
          type="button"
          className="edit-view-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
        >
          Edit view
        </button>
        {hiddenCardCount > 0 ? (
          <button
            type="button"
            className="hidden-stages-note"
            onClick={() => setMenuOpen(true)}
            title={hiddenWithCards.map((c) => `${STAGE_LABELS[c.stage]} (${c.businesses.length})`).join(", ")}
          >
            {hiddenCardCount} card{hiddenCardCount === 1 ? "" : "s"} in {hiddenWithCards.length} hidden
            stage{hiddenWithCards.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>
      {menuOpen ? (
        <EditViewMenu
          stages={STAGES}
          labels={STAGE_LABELS}
          visibleSet={shownStageSet}
          counts={Object.fromEntries(allColumns.map((c) => [c.stage, c.businesses.length]))}
          onToggle={toggleStage}
          onReset={() => {
            resetVisibleStages();
            setMenuOpen(false);
          }}
          onClose={() => setMenuOpen(false)}
          containerRef={toolbarRef}
        />
      ) : null}
    </div>
  );

  if (shownColumns.length === 0) {
    return (
      <div className="board-wrap">
        {toolbar}
        <div className="board-status">
          {q
            ? `No businesses match "${search}".`
            : hasCustomView
            ? "No stages are set to show. Use “Edit view” to pick some."
            : "No businesses on the board yet."}
        </div>
      </div>
    );
  }

  return (
    <div className="board-wrap">
      {toolbar}
      <div className="board">
        {shownColumns.map(({ stage, businesses: stageBusinesses }) => (
          <StageColumn
            key={stage}
            stage={stage}
            businesses={stageBusinesses}
            onOpen={onOpen}
            onDropBusiness={handleDrop}
          />
        ))}
      </div>
    </div>
  );
}
