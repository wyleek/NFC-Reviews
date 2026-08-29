import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../lib/supabaseClient";
import { adminApi } from "../../lib/adminApi";
import { STAGES } from "../../lib/stages";
import { StageColumn } from "./StageColumn";

const BUSINESS_FIELDS =
  "id, name, stage, stage_updated_at, current_review_count, current_rating, " +
  "rank_score, traffic_score, category_group, tier, corridor, best_callback_window, " +
  "sms_consent, do_not_contact";

export function KanbanBoard({ onOpen, refreshToken, search = "" }) {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  // Empty stages are hidden to keep the board from cluttering up — a card
  // can still be moved into any stage via its per-card <select> (see
  // BusinessCard.jsx), which lists every stage regardless of whether that
  // stage's column is currently rendered here.
  const columns = STAGES.map((stage) => ({
    stage,
    businesses: visible.filter((b) => b.stage === stage),
  })).filter((c) => c.businesses.length > 0);

  if (columns.length === 0) {
    return (
      <div className="board-status">
        {q ? `No businesses match "${search}".` : "No businesses on the board yet."}
      </div>
    );
  }

  return (
    <div className="board">
      {columns.map(({ stage, businesses: stageBusinesses }) => (
        <StageColumn
          key={stage}
          stage={stage}
          businesses={stageBusinesses}
          onOpen={onOpen}
          onDropBusiness={handleDrop}
        />
      ))}
    </div>
  );
}
