import { useRef, useState } from "react";
import { adminApi } from "../../lib/adminApi";

const SpeechRecognition =
  typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

// crm-spec.md 2b: "Add a voice-note field (browser SpeechRecognition API,
// or Whisper if already wired) that drops transcript into the activity
// body." No Whisper wiring exists yet, so: browser SpeechRecognition,
// with a plain textarea fallback on browsers that don't support it
// (notably Firefox) — dictation is a nice-to-have, typing still works.
export function VoiceNote({ businessId, onSaved }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const recognitionRef = useRef(null);

  function toggleListening() {
    if (!SpeechRecognition) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .map((r) => r[0].transcript)
        .join(" ");
      setText((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await adminApi.logActivity(businessId, "note", text.trim());
      setText("");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="voice-note">
      {error ? <p className="outcome-error">{error}</p> : null}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={SpeechRecognition ? "Tap the mic or type a note…" : "Type a note…"}
        rows={3}
      />
      <div className="voice-note-actions">
        {SpeechRecognition ? (
          <button type="button" className={listening ? "btn sm mic-on" : "btn ghost sm"} onClick={toggleListening}>
            {listening ? "● Listening…" : "🎤 Dictate"}
          </button>
        ) : null}
        <button type="button" className="btn sm" onClick={save} disabled={!text.trim() || saving}>
          {saving ? "Saving…" : "Save note"}
        </button>
      </div>
    </div>
  );
}
