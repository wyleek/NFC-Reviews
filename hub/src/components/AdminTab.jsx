import { useState } from "react";
import { adminApi } from "../lib/adminApi";
import { SearchStep } from "./admin/SearchStep";
import { QuickLinkCard } from "./admin/QuickLinkCard";
import { ContactStep } from "./admin/ContactStep";
import { CardsStep } from "./admin/CardsStep";
import { TagsResult } from "./admin/TagsResult";

const DEFAULT_CARDS = () => [
  { label: "Front counter", type: "stand", price: "" },
  { label: "Table 1", type: "placard", price: "" },
  { label: "Table 2", type: "placard", price: "" },
];

const EMPTY_CONTACT = { name: "", title: "", email: "", phone: "" };

// Port of admin.html's search -> quick-link -> contact -> cards -> create
// flow (PRs #7/#8) into React state, replacing the `S` object + render()
// with useState. Same admin-api actions, same request/response shapes —
// see docs/BRANCH_BRIEF-hub-admin-tab.md.
export function AdminTab() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [picked, setPicked] = useState(null);
  const [existing, setExisting] = useState(null); // {id, name, stage} from lookup_business
  const [quickLink, setQuickLink] = useState(null); // {business, slug, url} — the walk-in-the-door link
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [cards, setCards] = useState(DEFAULT_CARDS());
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [quickLinkErr, setQuickLinkErr] = useState("");
  const [createErr, setCreateErr] = useState("");

  const subtotal = cards.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);

  function resetAll() {
    setQuery("");
    setHits([]);
    setPicked(null);
    setExisting(null);
    setQuickLink(null);
    setContact(EMPTY_CONTACT);
    setCards(DEFAULT_CARDS());
    setCreated(null);
    setSearchErr("");
    setQuickLinkErr("");
    setCreateErr("");
  }

  async function doSearch() {
    if (!query.trim()) return;
    setBusy(true);
    setSearchErr("");
    try {
      const d = await adminApi.searchPlace(query);
      setHits(d.places);
    } catch (e) {
      setSearchErr(e.message);
    }
    setBusy(false);
  }

  // Picking a result checks whether this business already has a real
  // row — e.g. a quick demo card already written via linkmaker.html, or
  // a scraped lead — so Step 3 can pre-fill with what actually exists
  // instead of offering blank cards that would duplicate an
  // already-written tag.
  async function pickResult(i) {
    const hit = hits[i];
    setPicked(hit);
    setExisting(null);
    setQuickLink(null);
    setCards(DEFAULT_CARDS());
    try {
      const d = await adminApi.lookupBusiness(hit.place_id);
      if (d.business) {
        setExisting(d.business);
        if (d.cards.length) {
          setCards(d.cards.map((c) => ({ id: c.id, label: c.label, type: c.card_type, price: "" })));
        }
      }
    } catch {
      // lookup is best-effort — silently fall back to blank cards
    }
  }

  // The walk-in-the-door link: one working card, right now, before
  // contact info or pricing exist. Reuses the same `businesses` row
  // create_business would (find-or-create by place_id, see quick_link in
  // admin-api) so nothing gets duplicated — then re-runs lookup_business
  // so Step 3 picks up this exact card's `id` and updates it in place
  // later instead of minting a second one.
  async function getQuickLink() {
    setBusy(true);
    setQuickLinkErr("");
    try {
      const d = await adminApi.quickLink({
        place_id: picked.place_id,
        name: picked.name,
        review_count: picked.review_count,
        rating: picked.rating,
        label: "Stand",
        type: "stand",
      });
      setQuickLink(d);
      const look = await adminApi.lookupBusiness(picked.place_id);
      if (look.business) {
        setExisting(look.business);
        if (look.cards.length) {
          setCards(look.cards.map((c) => ({ id: c.id, label: c.label, type: c.card_type, price: "" })));
        }
      }
    } catch (e) {
      setQuickLinkErr(e.message);
    }
    setBusy(false);
  }

  async function doCreate() {
    setBusy(true);
    setCreateErr("");
    try {
      const d = await adminApi.createBusiness({
        name: picked.name,
        place_id: picked.place_id,
        review_count: picked.review_count,
        rating: picked.rating,
        contact,
        cards: cards.filter((c) => c.label.trim()),
      });
      setCreated(d);
    } catch (e) {
      setCreateErr(e.message);
    }
    setBusy(false);
  }

  if (created) {
    return (
      <div className="wrap">
        <TagsResult created={created} contact={contact} onReset={resetAll} />
      </div>
    );
  }

  return (
    <div className="wrap">
      <SearchStep
        query={query}
        setQuery={setQuery}
        hits={hits}
        picked={picked}
        busy={busy}
        err={searchErr}
        onSearch={doSearch}
        onPick={pickResult}
      />
      {picked && (
        <>
          {existing && existing.stage !== "customer" && (
            <p className="note" style={{ margin: "-4px 0 12px" }}>
              Already in the system as a lead (stage: {existing.stage}) — creating cards below moves it
              to customer.
            </p>
          )}
          <QuickLinkCard picked={picked} quickLink={quickLink} busy={busy} err={quickLinkErr} onGetLink={getQuickLink} />
          <ContactStep contact={contact} setContact={setContact} />
          <CardsStep cards={cards} setCards={setCards} subtotal={subtotal} busy={busy} err={createErr} onCreate={doCreate} />
        </>
      )}
    </div>
  );
}
