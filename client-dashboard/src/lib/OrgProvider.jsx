import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "./supabaseClient";
import { useAuth } from "./AuthProvider";

const OrgContext = createContext(null);

// Resolves the logged-in user's org (via `memberships`, RLS-scoped to
// their own rows) and its `locations`. The 20260908120200 migration
// auto-provisions an org + owner membership on first sign-in, so by the
// time a session exists there should always be exactly one row here for
// a normal client — `role` is read but not yet used for anything (staff
// members are out of scope for this branch; see spec §Out).
export function OrgProvider({ children }) {
  const { session } = useAuth();
  const [org, setOrg] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) {
      setOrg(null);
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: membership } = await supabase
      .from("memberships")
      .select("org_id, role, organizations(id, name)")
      .limit(1)
      .maybeSingle();

    if (!membership) {
      // Auto-provision trigger runs synchronously on signup, but a brand
      // new session can occasionally read before it's committed — one
      // short retry covers that race without a visible error state.
      await new Promise((r) => setTimeout(r, 500));
      const { data: retried } = await supabase
        .from("memberships")
        .select("org_id, role, organizations(id, name)")
        .limit(1)
        .maybeSingle();
      if (!retried) {
        setOrg(null);
        setLocations([]);
        setLoading(false);
        return;
      }
      setOrg({ id: retried.org_id, name: retried.organizations?.name, role: retried.role });
    } else {
      setOrg({ id: membership.org_id, name: membership.organizations?.name, role: membership.role });
    }

    const orgId = membership?.org_id;
    if (orgId) {
      const { data: locs } = await supabase
        .from("locations")
        .select("id, display_name, place_id, sync_status, connected_at")
        .eq("org_id", orgId);
      setLocations(locs ?? []);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <OrgContext.Provider value={{ org, locations, loading, refresh }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within OrgProvider");
  return ctx;
}
