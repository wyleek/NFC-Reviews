# Draft: Google Business Profile API access application

For the [GBP API contact form](https://support.google.com/business/contact/api_default)
— select **"Application for Basic API Access"** from the dropdown. The form's
exact fields weren't fetchable (login-gated, likely dynamic), so this is
written as clearly-labeled blocks to paste into whatever fields it presents,
not a verbatim transcript of the form. Fill in every `[bracket]`.

---

**Company / product name**

Tap2Review

**Company website**

`[your marketing site URL — must be on the same domain as the email you apply from]`

**Contact email**

`[owner/manager email on the qualifying Business Profile listing]`

**Google Cloud project number**

`[from the Cloud Console dashboard of the project you'll enable the APIs in]`

**Qualifying Business Profile**

`[name + address of the verified, 60+-day-old listing you're using to qualify — yours or a client's]`

---

**Describe how you'll use the Business Profile API**

Tap2Review is a review-generation product for local businesses: each business
places NFC tags / QR codes at physical touchpoints (counter, tables) that
send customers directly to the business's Google review page — no star-
rating gate, no sentiment filtering, every customer sees the same option,
consistent with Google's and the FTC's rules on review solicitation.

Each business owner independently connects their own Google Business Profile
via OAuth (`business.manage` scope) through our standard consent flow — they
authorize the connection on Google's own consent screen; we never see their
password. Once connected, we call the Business Profile API roughly once per
day, per connected business, to read that business's current review count
and rating. This is the only Business Profile API usage — no changes are
made to any listing.

That daily read is charted alongside the count of NFC/QR taps the business
received that day, so the owner can see tap volume and review-count growth
side by side over a rolling 7/30/60-day window. We're explicit with owners
that this is a correlation, not a causation — Google doesn't expose which
review came from which tap, so we never claim to attribute a specific review
to a specific tap.

**Expected scale**

`[your honest current/near-term estimate — e.g. "currently N connected businesses, expect low tens within 6 months" — one call/business/day, so volume stays modest even as it grows]`

**Which Business Profile APIs will you use**

Primarily reading review/rating data for a connected location (Business
Information API surface) under OAuth granted by that location's owner. We
don't currently use the Notifications, Q&A, Place Actions, or Lodging APIs.

**Confirm you'll follow Google's API Terms of Service and Business Profile
API Policies**

Yes. All access is owner-authorized via OAuth, scoped to the specific
business that granted it, used only to display that business's own data back
to that business's own owner.

---

## Notes for whoever fills this in

- Keep the "expected scale" number honest and current — inflating it invites
  more scrutiny, understating it and then blowing past it is also a bad look
  if Google ever checks back in.
- If the actual form has different/fewer fields than this draft assumes,
  the "Describe how you'll use the API" paragraph is the one to prioritize
  pasting in full — it's the part reviewers actually read.
- Once submitted, check approval via API quota in Cloud Console (0 QPM = not
  yet, 300 QPM = approved) rather than waiting on the confirmation email,
  which can lag.
