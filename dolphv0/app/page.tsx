"use client"

import { AuthProvider, useAuth } from "@/lib/auth-context"
import { PasswordGate } from "@/components/password-gate"
import { Dashboard } from "@/components/dashboard"

function AppContent() {
  const { isAuthenticated } = useAuth()
  
  if (!isAuthenticated) {
    return <PasswordGate />
  }
  
  return <Dashboard />
}

export default function Home() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
