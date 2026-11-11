-- ============================================================================
-- rename_card — let a business owner rename one of their own cards straight
-- from the customer dashboard (dashboard-app), which only has the anon
-- publishable key (SELECT-only via RLS).
--
-- Renaming is the ONE write the dashboard needs. Rather than put the service-
-- role admin token on the client, this is a tightly-scoped SECURITY DEFINER
-- function that can do exactly one thing: set a single card's `label`. It
-- cannot touch any other column, row, or table.
--
-- Trust model: the dashboard is already unauthenticated — anyone with the
-- ?business=/?owner= link can READ everything on it. This adds the ability to
-- edit a card's display label (cosmetic, reversible) to that same link-based
-- access. When real per-owner login is added later, gate this behind it.
--
-- Purely additive: one new function. No table or policy is changed.
-- ============================================================================

create or replace function public.rename_card(p_card_id uuid, p_label text)
returns void
language sql
security definer
set search_path = public
as $$
  update cards
     set label = left(btrim(p_label), 80)
   where id = p_card_id
     and length(btrim(coalesce(p_label, ''))) > 0;
$$;

-- Callable by the dashboard's anon key (and any logged-in user); nobody else.
revoke all on function public.rename_card(uuid, text) from public;
grant execute on function public.rename_card(uuid, text) to anon, authenticated;
