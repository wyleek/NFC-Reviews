import { useEffect, useState } from "react";
import { adminApi } from "../lib/adminApi";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";
import { namesLikelyMatch } from "../lib/nameMatch";
import { SearchStep } from "./admin/SearchStep";
import { QuickLinkCard } from "./admin/QuickLinkCard";
import { ContactStep } from "./admin/ContactStep";
import { CardsStep } from "./admin/CardsStep";
import { TagsResult } from "./admin/TagsResult";
import { ContactsEditor } from "./shared/ContactsEditor";

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
//
// `deepLinkBusinessId` / `onDeepLinkHandled` let CRM's BusinessDrawer
// ("Manage in Admin") jump straight into this tab's edit flow for a
// specific business, bypassing search entirely — see App.jsx.
export function AdminTab({ deepLinkBusinessId, onDeepLinkHandled }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [localHits, setLocalHits] = useState([]); // businesses already on file, matched locally
  const [picked, setPicked] = useState(null);
  const [existing, setExisting] = useState(null); // {id, name, stage, google_place_id} from lookup_business
  const [quickLink, setQuickLink] = useState(null); // {business, slug, url} — the walk-in-the-door link
  const [contact, setContact] = useState(EMPTY_CONTACT); // brand-new-business path only, see ContactStep below
  const [contacts, setContacts] = useState([]); // existing-business path — live multi-contact editor
  const [cards, setCards] = useState(DEFAULT_CARDS());
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [quickLinkErr, setQuickLinkErr] = useState("");
  const [contactErr, setContactErr] = useState("");
  const [createErr, setCreateErr] = useState("");

  const subtotal = cards.reduce((sum, c) => sum + (parseFloat(c.price) || 0), 0);

  function resetAll() {
    setQuery("");
    setHits([]);
    setLocalHits([]);
    setPicked(null);
    setExisting(null);
    setQuickLink(null);
    setContact(EMPTY_CONTACT);
    setContacts([]);
    setCards(DEFAULT_CARDS());
    setCreated(null);
    setSearchErr("");
    setQuickLinkErr("");
    setContactErr("");
    setCreateErr("");
  }

  // Shared by every path that finds an existing business (Google-search
  // pick, local-DB pick, CRM deep link): pre-fill cards from lookup_business
  // AND now the contact(s), so "adjust contact information" edits what
  // actually exists instead of offering a blank form that risks duplicating
  // it (see create_business's find-or-update fix). `contacts` (plural)
  // feeds the live multi-contact editor shown for an existing business —
  // see the `existing` branch below, and ContactsEditor.
  function applyLookupResult(d) {
    if (!d?.business) return;
    setExisting(d.business);
    if (d.cards?.length) {
      setCards(d.cards.map((c) => ({ id: c.id, label: c.label, type: c.card_type, price: "" })));
    }
    setContacts(d.contacts ?? (d.contact ? [d.contact] : []));
    if (d.contact) {
      setContact({
        name: d.contact.name || "",
        title: d.contact.title || "",
        email: d.contact.email || "",
        phone: d.contact.phone || "",
      });
    }
  }

  // Re-fetches this business's contacts after ContactsEditor adds/removes a
  // row (an inline field edit doesn't need this — local state already has
  // it, see ContactsEditor's onSaved vs onListChanged split).
  async function reloadExistingContacts() {
    if (!existing?.id) return;
    try {
      const d = await adminApi.lookupBusiness({ business_id: existing.id });
      setContacts(d.contacts ?? []);
    } catch (e) {
      setContactErr(e.message);
    }
  }

  // Step 1 search: local-first. A billed Google Places call is only worth
  // making when the business genuinely isn't in our own `businesses` table
  // yet — most "find the business" searches in the field are actually
  // someone pulling up an existing customer (e.g. to add a card or fix a
  // phone number), not a new lead.
  //
  // Pulls the whole table (small — a field-sales CRM's business list isn't
  // going to be huge) and matches client-side with namesLikelyMatch
  // instead of a single server-side ILIKE %query% substring, which is
  // exactly the kind of match a stray apostrophe or a partial name breaks
  // (typing "Bammys" wouldn't find "Bammy's Modern Caribbean" — an
  // existing customer went unrecognized and a search that cost money ran
  // when it didn't need to). Lenient on purpose: this only decides whether
  // to show a local match before running that billed search, it never
  // auto-adds anything, so a false positive just means an extra row shown.
  // Only falls through to Google when nothing local matches at all.
  async function doSearch() {
    if (!query.trim()) return;
    setBusy(true);
    setSearchErr("");
    setHits([]);
    setLocalHits([]);
    try {
      if (supabaseConfigured) {
        const { data, error } = await supabase
          .from("businesses")
          .select("id, name, stage, google_place_id, current_review_count, current_rating")
          .order("name")
          .limit(500);
        const matches = !error ? (data ?? []).filter((b) => namesLikelyMatch(query, b.name)) : [];
        if (matches.length) {
          setLocalHits(matches.slice(0, 8));
          setBusy(false);
          return;
        }
      }
      await searchGoogle();
      return;
    } catch (e) {
      setSearchErr(e.message);
    }
    setBusy(false);
  }

  // The billed Google Places search — called automatically when there's no
  // local match, and available as an explicit fallback button otherwise (a
  // genuinely new business, or a local match under a different name).
  async function searchGoogle() {
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

  // Picking a Google result checks whether this business already has a real
  // row — e.g. a quick demo card already written via linkmaker.html, or
  // a scraped lead — so Step 2/3 can pre-fill with what actually exists
  // instead of offering blanks that would duplicate already-written data.
  async function pickResult(i) {
    const hit = hits[i];
    setLocalHits([]);
    setPicked(hit);
    setExisting(null);
    setQuickLink(null);
    setCards(DEFAULT_CARDS());
    setContact(EMPTY_CONTACT);
    setContacts([]);
    try {
      const d = await adminApi.lookupBusiness({ place_id: hit.place_id });
      applyLookupResult(d);
    } catch {
      // lookup is best-effort — silently fall back to blank cards/contact
    }
  }

  // Picking a local match ("Already on file") — no Google call at all.
  // Reuses lookup_business exactly like pickResult, keyed by business_id
  // when there's no place_id handy (or the row predates one).
  async function pickLocalResult(biz) {
    setLocalHits([]);
    setHits([]);
    setQuery(biz.name);
    setPicked({
      _localId: biz.id,
      place_id: biz.google_place_id || null,
      name: biz.name,
      address: "",
      review_count: biz.current_review_count ?? 0,
      rating: biz.current_rating ?? null,
    });
    setExisting(null);
    setQuickLink(null);
    setCards(DEFAULT_CARDS());
    setContact(EMPTY_CONTACT);
    setContacts([]);
    try {
      const d = await adminApi.lookupBusiness(
        biz.google_place_id ? { place_id: biz.google_place_id } : { business_id: biz.id },
      );
      applyLookupResult(d);
    } catch {
      // lookup is best-effort — silently fall back to blank cards/contact
    }
  }

  // CRM "Manage in Admin" deep link — same edit flow as a local search pick,
  // just entered from the other tab with only a business_id in hand.
  useEffect(() => {
    if (!deepLinkBusinessId) return;
    let cancelled = false;
    (async () => {
      resetAll();
      setBusy(true);
      try {
        const d = await adminApi.lookupBusiness({ business_id: deepLinkBusinessId });
        if (!cancelled && d.business) {
          setQuery(d.business.name);
          setPicked({
            place_id: d.business.google_place_id || null,
            name: d.business.name,
            address: "",
            review_count: null,
            rating: null,
          });
          applyLookupResult(d);
        }
      } catch (e) {
        if (!cancelled) setSearchErr(e.message);
      }
      if (!cancelled) setBusy(false);
      onDeepLinkHandled?.();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBusinessId]);

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
      const look = await adminApi.lookupBusiness({ place_id: picked.place_id });
      applyLookupResult(look);
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
        // For an existing business, contact edits already went straight
        // through ContactsEditor (live, on blur) — sending the `contact`
        // snapshot here too would overwrite whatever's live on the primary
        // row with however it looked at lookup time. Only the brand-new
        // path (ContactStep) needs create_business to write the contact.
        contact: existing ? null : contact,
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
        localHits={localHits}
        picked={picked}
        busy={busy}
        err={searchErr}
        onSearch={doSearch}
        onSearchGoogle={searchGoogle}
        onPick={pickResult}
        onPickLocal={pickLocalResult}
      />
      {picked && (
        <>
          {existing && existing.stage !== "customer" && (
            <p className="note" style={{ margin: "-4px 0 12px" }}>
              Already in the system as a lead (stage: {existing.stage}) — creating cards below moves it
              to customer.
            </p>
          )}
          {picked.place_id && existing?.stage !== "customer" && (
            // "Get a link now" is the walk-in-the-door CTA for a fresh
            // prospect — it doesn't make sense once someone already has
            // cards. Leads (any other stage) still see it: they're in the
            // system but haven't been sold yet, so a quick link is still
            // useful in the field.
            <QuickLinkCard picked={picked} quickLink={quickLink} busy={busy} err={quickLinkErr} onGetLink={getQuickLink} />
          )}
          {existing ? (
            // Already a real row — edit contacts live, same component and
            // save-on-blur behavior as the CRM drawer (BusinessDrawer.jsx),
            // instead of the single-contact form below that only persists
            // once "Create" is clicked. See ContactsEditor.
            <div className="card">
              <div className="step">Step 2</div>
              <h2>Who to reach</h2>
              <p className="sub">Already on file — edits save immediately, same as the CRM drawer.</p>
              {contactErr && <div className="err">{contactErr}</div>}
              <ContactsEditor
                businessId={existing.id}
                contacts={contacts}
                setContacts={setContacts}
                onListChanged={reloadExistingContacts}
                onError={setContactErr}
              />
            </div>
          ) : (
            <ContactStep contact={contact} setContact={setContact} />
          )}
          <CardsStep cards={cards} setCards={setCards} subtotal={subtotal} busy={busy} err={createErr} onCreate={doCreate} />
        </>
      )}
    </div>
  );
}
