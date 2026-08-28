import { useState } from "react";

// True only where the Web NFC API exists (Android Chrome) — iPhones can't
// write NFC from a browser, so those devices get copy-only buttons
// instead. Same check as admin.html's NFC_OK.
export const NFC_OK = "NDEFReader" in window;

// "Write to card" / "Copy link" + a status line underneath — the same
// pair admin.html repeats for the quick link, each finished tap card,
// and the dashboard link (copy-only there, via showWrite={false}).
export function TagActions({ url, copiedMessage = "✓ Copied — paste into NFC Tools › Write › URL", showWrite = true }) {
  const [status, setStatus] = useState(null);

  async function write() {
    setStatus({ kind: "progress", text: "Hold the card to the top of your phone…" });
    try {
      await new window.NDEFReader().write({ records: [{ recordType: "url", data: url }] });
      setStatus({ kind: "ok", text: "✓ Written — tap-test it now" });
    } catch (e) {
      setStatus({ kind: "error", text: `Write failed: ${e.message}` });
    }
  }

  function copy() {
    navigator.clipboard.writeText(url);
    setStatus({ kind: "ok", text: copiedMessage });
  }

  return (
    <>
      {showWrite ? (
        <div className="row">
          {NFC_OK && (
            <button type="button" className="btn" onClick={write}>
              Write to card
            </button>
          )}
          <button type="button" className="btn ghost" onClick={copy}>
            Copy link
          </button>
        </div>
      ) : (
        <button type="button" className="btn ghost" onClick={copy}>
          Copy link
        </button>
      )}
      {status && (
        <div className="note">
          {status.kind === "ok" ? (
            <span className="ok">{status.text}</span>
          ) : status.kind === "error" ? (
            <span style={{ color: "var(--red)" }}>{status.text}</span>
          ) : (
            status.text
          )}
        </div>
      )}
    </>
  );
}
