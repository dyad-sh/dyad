"use client";

// Custom sign-up/sign-in forms per the benchmark's unified auth contract —
// the same authClient calls the AI_RULES/AGENTS note documents.
import { useState } from "react";
import { createAuthClient } from "@neondatabase/auth/next";

const authClient = createAuthClient();

export default function Home() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: session, isPending } = authClient.useSession();

  async function onSignUp(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signUp.email({
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password"),
    });
    if (err) setError(err.message || "sign-up failed");
    setBusy(false);
  }

  async function onSignIn(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const { error: err } = await authClient.signIn.email({
        email: form.get("email"),
        password: form.get("password"),
      });
      if (err) setError(err.message || "sign-in failed");
    } catch (err) {
      setError(err?.message || "sign-in failed");
    }
    setBusy(false);
  }

  if (isPending) return <p data-testid="loading">loading…</p>;

  if (session?.user) {
    return (
      <main>
        <p data-testid="user-menu">{session.user.email}</p>
        <button
          data-testid="sign-out-button"
          onClick={() => authClient.signOut()}
        >
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main>
      <h1>s-auth spike</h1>
      <form onSubmit={onSignUp}>
        <h2>Sign up</h2>
        <input data-testid="signup-name" name="name" placeholder="name" />
        <input data-testid="signup-email" name="email" placeholder="email" />
        <input
          data-testid="signup-password"
          name="password"
          type="password"
          placeholder="password"
        />
        <button data-testid="signup-submit" disabled={busy} type="submit">
          Sign up
        </button>
      </form>
      <form onSubmit={onSignIn}>
        <h2>Sign in</h2>
        <input data-testid="signin-email" name="email" placeholder="email" />
        <input
          data-testid="signin-password"
          name="password"
          type="password"
          placeholder="password"
        />
        <button data-testid="signin-submit" disabled={busy} type="submit">
          Sign in
        </button>
      </form>
      <p data-testid="signin-error">{error}</p>
    </main>
  );
}
