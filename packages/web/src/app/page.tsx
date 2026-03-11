"use client";

import { AuthProvider, useAuth } from "@/components/AuthContext";
import { Dashboard } from "@/components/Dashboard";
import { PasswordGate } from "@/components/PasswordGate";

function AppShell() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Dashboard /> : <PasswordGate />;
}

export default function HomePage() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
