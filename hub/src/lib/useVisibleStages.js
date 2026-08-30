import { useCallback, useState } from "react";
import { STAGES } from "./stages";

// Personal display preference for which Kanban stage columns render,
// independent of card count. Lives in localStorage (per-browser, not
// shared data) — no DB/migration needed. `null` means "no preference set
// yet", which callers should treat as "auto-hide empty columns" (today's
// existing behavior) so nothing regresses for a first-time load. Once the
// user makes an explicit choice, the stored array (possibly empty) takes
// over permanently — including columns with zero cards that stay pinned
// visible, and columns with cards that stay hidden.
const STORAGE_KEY = "crm.kanban.visibleStages";

function readStoredStages() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const known = new Set(STAGES);
    // De-dupe and drop anything that isn't a current stage (defends against
    // a stale value from before STAGES changed).
    return [...new Set(parsed.filter((s) => known.has(s)))];
  } catch {
    // localStorage unavailable (private mode, disabled storage) or the
    // stored value isn't valid JSON — fall back to "no preference".
    return null;
  }
}

function writeStoredStages(stages) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stages));
  } catch {
    // Storage full/unavailable — preference just won't persist this time.
  }
}

function clearStoredStages() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// Returns [visibleStages, api] where visibleStages is either `null` (no
// explicit preference yet) or the array of stage keys the user has chosen
// to show. `api.set(stages)` stores an explicit choice; `api.reset()`
// clears it back to `null` (auto-hide-empty default).
export function useVisibleStages() {
  const [visibleStages, setVisibleStages] = useState(() => readStoredStages());

  const set = useCallback((stages) => {
    writeStoredStages(stages);
    setVisibleStages(stages);
  }, []);

  const reset = useCallback(() => {
    clearStoredStages();
    setVisibleStages(null);
  }, []);

  return [visibleStages, { set, reset }];
}
