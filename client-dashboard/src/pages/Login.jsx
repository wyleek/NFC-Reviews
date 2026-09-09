import { useState } from "react";
import { useAuth } from "../lib/AuthProvider";

export function Login() {
  const { signInWithGoogle, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleEmailSubmit(e) {
    e.preventDefault();
    setError(null);
    const { error: err } = await signInWithEmail(email);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-lg font-semibold text-neutral-900">WM Marketing</h1>
          <p className="text-sm text-neutral-500">Sign in to your reviews dashboard</p>
        </div>

        <button
          type="button"
          onClick={signInWithGoogle}
          className="w-full rounded-lg border border-neutral-300 py-2.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        >
          Continue with Google
        </button>

        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <div className="h-px flex-1 bg-neutral-200" />
          or
          <div className="h-px flex-1 bg-neutral-200" />
        </div>

        {sent ? (
          <p className="text-sm text-center text-neutral-600">
            Check your email for a sign-in link.
          </p>
        ) : (
          <form onSubmit={handleEmailSubmit} className="space-y-2">
            <input
              type="email"
              required
              placeholder="you@business.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm"
              style={{ fontSize: 16 }} // avoids iOS Safari auto-zoom on focus
            />
            <button
              type="submit"
              className="w-full rounded-lg bg-neutral-900 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Email me a sign-in link
            </button>
          </form>
        )}

        {error && <p className="text-xs text-red-600 text-center">{error}</p>}
      </div>
    </div>
  );
}
