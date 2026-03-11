"use client";

import { useState } from "react";
import { useAuth } from "@/components/AuthContext";

export function PasswordGate() {
  const { login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!login(password)) {
      setError("Invalid password. Try again.");
      setPassword("");
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute left-[-8rem] top-1/4 h-96 w-96 rounded-full bg-primary/12 blur-3xl" />
        <div className="absolute right-[-8rem] bottom-1/4 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-10 animate-fade-in">
          <div className="inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-primary/30 bg-background/60 shadow-[0_0_30px_rgba(56,189,248,0.16)]">
            <img src="/dolph-icon.png" alt="Dolph" className="h-full w-full object-cover" />
          </div>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-foreground">Dolph</h1>
          <p className="mt-2 text-base text-muted-foreground">SEC EDGAR Research Platform</p>
        </div>

        <div className="animate-fade-in [animation-delay:200ms]">
          <div className="rounded-2xl border border-primary/20 bg-card/90 p-8 shadow-2xl backdrop-blur-xl">
            <div className="mb-6">
              <p className="text-sm font-semibold text-foreground">Protected Access</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter the demo password to access the analysis console.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                placeholder="Enter password"
                autoFocus
                className="w-full rounded-xl border border-border/70 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20 placeholder:text-slate-500"
              />
              {error ? <p className="text-sm text-red-400">{error}</p> : null}
              <button
                type="submit"
                disabled={!password || submitting}
                className="w-full rounded-xl bg-gradient-to-r from-primary to-cyan-500 px-4 py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Verifying…" : "Access Platform"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
