// Shared fuzzy business-name matching — used by AdminTab's local-first
// search (lenient: a missed match just costs a redundant billed Google
// search) and CallList's batch-add auto-pick confidence check (stricter
// elsewhere in that file: a wrong auto-pick actually creates the wrong
// business record). This module only answers "do these two names look
// like the same business" — how strictly that answer gets used is each
// caller's own call.

// Space-preserving: punctuation becomes a word boundary. Good for
// matching a partial or reordered multi-word query ("yard bammys" against
// "Bammy's ... Navy Yard").
function spaced(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Fully concatenated — no separators at all. Needed on top of `spaced`
// because punctuation elision doesn't always add a word boundary: typing
// "Bammys" (no apostrophe) collapses to the same string as "Bammy's"
// only when apostrophes are dropped outright, not turned into a space —
// `spaced` alone turns "Bammy's" into "bammy s", which "bammys" (one
// token) never matches.
function collapsed(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// True if `query` looks like it's naming the same business as `name` —
// either one contains the other once punctuation/case is normalized away
// (checked both space-tokenized and fully collapsed, since which one
// bridges a given typo/punctuation difference varies), or every word in
// `query` shows up somewhere in `name`.
export function namesLikelyMatch(query, name) {
  const nq = spaced(query);
  const nn = spaced(name);
  if (!nq || !nn) return false;
  if (nn.includes(nq) || nq.includes(nn)) return true;

  const qWords = nq.split(" ").filter(Boolean);
  if (qWords.length && qWords.every((w) => nn.includes(w))) return true;

  const cq = collapsed(query);
  const cn = collapsed(name);
  return Boolean(cq) && (cn.includes(cq) || cq.includes(cn));
}

// Exact-ish equality check (both collapsed forms identical) — used to spot
// a near-duplicate runner-up result (e.g. two locations of the same chain)
// rather than to decide whether two names match at all.
export function namesCollapseEqual(a, b) {
  const ca = collapsed(a);
  return Boolean(ca) && ca === collapsed(b);
}
