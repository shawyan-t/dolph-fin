"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Lock, AlertCircle, ArrowRight } from "lucide-react"

export function PasswordGate() {
  const { login } = useAuth()
  const [password, setPassword] = useState("")
  const [error, setError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(false)

    setTimeout(() => {
      const success = login(password)
      if (!success) {
        setError(true)
        setPassword("")
      }
      setIsSubmitting(false)
    }, 400)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-primary/15 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse [animation-delay:1s]" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo and Brand */}
        <div className="text-center mb-10 animate-fade-in">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-primary/40 blur-2xl rounded-full scale-150" />
            <div className="relative flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 backdrop-blur-sm">
              <span className="text-4xl font-bold bg-gradient-to-br from-white to-primary bg-clip-text text-transparent">D</span>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-foreground tracking-tight">
            <span className="bg-gradient-to-r from-white via-white to-muted-foreground bg-clip-text text-transparent">
              Dolph
            </span>
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            SEC EDGAR Research Platform
          </p>
        </div>

        {/* Login Form */}
        <div className="animate-fade-in [animation-delay:200ms]">
          <div className="relative rounded-2xl bg-gradient-to-br from-primary/20 to-cyan-500/10 p-[1px]">
            <div className="rounded-2xl bg-card/95 backdrop-blur-xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                  <Lock className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Protected Access</h2>
                  <p className="text-xs text-muted-foreground">Enter credentials to continue</p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <Input
                    type="password"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setError(false)
                    }}
                    className={`bg-background/50 border-border/50 h-12 text-base placeholder:text-muted-foreground/50 focus:border-primary/50 focus:ring-primary/20 transition-all ${error ? "border-destructive/50 focus:border-destructive" : ""}`}
                    autoFocus
                  />
                  {error && (
                    <div className="flex items-center gap-2 mt-3 text-destructive text-sm animate-fade-in">
                      <AlertCircle className="w-4 h-4" />
                      <span>Invalid password. Please try again.</span>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 font-semibold text-base bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 transition-all duration-300 group"
                  disabled={isSubmitting || !password}
                >
                  {isSubmitting ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Verifying...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      Access Platform
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  )}
                </Button>
              </form>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-8 animate-fade-in [animation-delay:400ms]">
          Institutional-grade SEC filings intelligence
        </p>
      </div>
    </div>
  )
}
