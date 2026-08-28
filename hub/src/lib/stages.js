// Mirrors business_stage (20260817120000_crm_data_model.sql) and the
// one-tap outcome spec (crm-spec.md 2b). Keep in sync with admin-api's
// STAGES/ACTIVITY_TYPES lists if either changes.

export const STAGES = [
  "scraped", "qualified", "pre_called", "visit_planned", "rescheduled",
  "sale_hardware", "trial_active", "won", "lost", "customer", "churned",
];

export const STAGE_LABELS = {
  scraped: "Scraped",
  qualified: "Qualified",
  pre_called: "Pre-called",
  visit_planned: "Visit planned",
  rescheduled: "Rescheduled",
  sale_hardware: "Sale (hardware)",
  trial_active: "Trial active",
  won: "Won",
  lost: "Lost",
  customer: "Customer",
  churned: "Churned",
};

// crm-spec.md 2a: "next action" per stage — a first-pass heuristic shown
// on the card when the business has no best_callback_window set yet.
export const STAGE_NEXT_ACTION = {
  scraped: "Qualify",
  qualified: "Pre-call",
  pre_called: "Book visit",
  visit_planned: "Visit",
  rescheduled: "Re-visit",
  sale_hardware: "Install",
  trial_active: "Check in",
  won: "Onboard",
  lost: "—",
  customer: "Maintain",
  churned: "Win back",
};

// Stages the call list (lead-engine-spec.md §5) draws from — businesses
// that are qualified but not yet through an outcome. Excludes 'scraped'
// (needs qualifying first) and every post-outcome stage (won/lost/
// sale_hardware/trial_active/customer/churned) — those are done with the
// pre-call/visit cycle.
export const CALL_LIST_STAGES = ["qualified", "pre_called", "visit_planned", "rescheduled"];

// crm-spec.md 2b: one-tap outcome buttons and exactly what each one does.
export const OUTCOMES = [
  { key: "sale", label: "Sale", stage: "sale_hardware" },
  { key: "trial", label: "Trial", stage: "trial_active", createsDeal: true },
  { key: "no", label: "No", stage: "lost" },
  { key: "reschedule", label: "Reschedule", stage: "rescheduled" },
];

export const ACTIVITY_TYPE_LABELS = {
  pre_call: "Pre-call",
  visit: "Visit",
  outcome: "Outcome",
  text_sent: "Text sent",
  review_milestone: "Review milestone",
  note: "Note",
};
