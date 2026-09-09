import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useOrg } from "../lib/OrgProvider";

const CHANNELS = [
  { value: "dashboard", label: "Dashboard only" },
  { value: "text", label: "Text message" },
  { value: "both", label: "Both" },
];

// The one piece of live feature logic in this branch (per spec §5) —
// reads/writes `notification_preferences` for the org's location. Every
// other tab is an empty slot for a later module branch.
export function SettingsTab() {
  const { org, locations } = useOrg();
  const location = locations[0]; // MVP: single-location owners; multi-location gets per-location settings in a later branch
  const [prefs, setPrefs] = useState(null);
  const [channel, setChannel] = useState("dashboard");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState(null); // "saving" | "saved" | error string

  useEffect(() => {
    if (!org) return;
    let query = supabase.from("notification_preferences").select("*").eq("org_id", org.id);
    query = location ? query.eq("location_id", location.id) : query.is("location_id", null);
    query.maybeSingle().then(({ data }) => {
      if (data) {
        setPrefs(data);
        setChannel(data.review_updates_channel);
        setPhone(data.phone_e164 ?? "");
      }
    });
  }, [org, location]);

  async function save(e) {
    e.preventDefault();
    setStatus("saving");
    const row = {
      org_id: org.id,
      location_id: location?.id ?? null,
      review_updates_channel: channel,
      phone_e164: channel === "dashboard" ? null : phone || null,
      updated_at: new Date().toISOString(),
    };
    const { error } = prefs
      ? await supabase.from("notification_preferences").update(row).eq("id", prefs.id)
      : await supabase.from("notification_preferences").insert(row);

    setStatus(error ? error.message : "saved");
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <section className="space-y-1">
        <h2 className="text-sm font-semibold text-neutral-900">Organization</h2>
        <p className="text-sm text-neutral-500">{org?.name}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-900">Review update notifications</h2>
        <form onSubmit={save} className="space-y-3">
          <div className="space-y-2">
            {CHANNELS.map((c) => (
              <label key={c.value} className="flex items-center gap-2 text-sm text-neutral-800">
                <input
                  type="radio"
                  name="channel"
                  value={c.value}
                  checked={channel === c.value}
                  onChange={() => setChannel(c.value)}
                />
                {c.label}
              </label>
            ))}
          </div>

          {channel !== "dashboard" && (
            <input
              type="tel"
              placeholder="+1 555 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
              style={{ fontSize: 16 }}
            />
          )}

          <button
            type="submit"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Save
          </button>

          {status === "saved" && <p className="text-xs text-green-600">Saved.</p>}
          {status && status !== "saving" && status !== "saved" && (
            <p className="text-xs text-red-600">{status}</p>
          )}
        </form>
      </section>
    </div>
  );
}
