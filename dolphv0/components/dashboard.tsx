"use client"

import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { 
  Building2, 
  GitCompare, 
  Search, 
  Tag,
  LogOut,
  ArrowUpRight
} from "lucide-react"
import Image from "next/image"

const features = [
  {
    icon: Building2,
    title: "Analyze Company",
    description: "Deep dive into SEC filings and financial statements.",
    gradient: "from-cyan-500/20 to-blue-500/20",
    borderGlow: "hover:shadow-cyan-500/20",
    iconColor: "text-cyan-400",
  },
  {
    icon: GitCompare,
    title: "Compare Companies",
    description: "Side-by-side comparison of filings, metrics, and disclosure patterns.",
    gradient: "from-violet-500/20 to-purple-500/20",
    borderGlow: "hover:shadow-violet-500/20",
    iconColor: "text-violet-400",
  },
  {
    icon: Search,
    title: "Search SEC Filings",
    description: "Full-text search across the EDGAR database with advanced filtering.",
    gradient: "from-emerald-500/20 to-teal-500/20",
    borderGlow: "hover:shadow-emerald-500/20",
    iconColor: "text-emerald-400",
  },
  {
    icon: Tag,
    title: "Resolve Ticker",
    description: "Convert ticker symbols to CIK numbers.",
    gradient: "from-amber-500/20 to-orange-500/20",
    borderGlow: "hover:shadow-amber-500/20",
    iconColor: "text-amber-400",
  },
]

export function Dashboard() {
  const { logout } = useAuth()

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      {/* Animated Background Grid */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
        {/* Gradient Orbs */}
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-32 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl animate-pulse [animation-delay:1s]" />
      </div>

      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/30 blur-lg rounded-lg" />
              <div className="relative flex items-center justify-center w-12 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 overflow-hidden">
                <Image 
                  src="/dolph-icon.png" 
                  alt="Dolph" 
                  width={48} 
                  height={36} 
                  className="object-contain"
                />
              </div>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-semibold text-foreground">Dolph</span>
              <span className="text-lg font-semibold text-foreground">Research</span>
            </div>
          </div>
          
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={logout}
            className="text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all duration-300"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-20 relative z-10">
        {/* Hero Section */}
        <section className="text-center mb-20 animate-fade-in [animation-delay:200ms]">
          <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-foreground tracking-tight text-balance leading-[1.1]">
            <span className="bg-gradient-to-r from-white via-white to-muted-foreground bg-clip-text text-transparent">
              Dolph Research
            </span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto text-pretty leading-relaxed">
            Analyze, compare, and search regulatory disclosures with precision.
          </p>
        </section>

        {/* Features Grid */}
        <section className="mb-20">
          <div className="grid md:grid-cols-2 gap-5">
            {features.map((feature, index) => (
              <div
                key={feature.title}
                className="animate-fade-in"
                style={{ animationDelay: `${300 + index * 100}ms` }}
              >
                <div 
                  className={`group relative h-full rounded-2xl bg-gradient-to-br ${feature.gradient} p-[1px] transition-all duration-500 hover:shadow-2xl ${feature.borderGlow}`}
                >
                  <div className="relative h-full rounded-2xl bg-card/90 backdrop-blur-sm p-6 overflow-hidden">
                    {/* Hover Glow Effect */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br from-white/5 to-transparent" />
                    
                    <div className="relative flex items-start justify-between mb-4">
                      <div className={`p-3 rounded-xl bg-background/50 border border-border/50 ${feature.iconColor}`}>
                        <feature.icon className="w-6 h-6" />
                      </div>
                      <ArrowUpRight className="w-5 h-5 text-muted-foreground opacity-0 -translate-y-1 translate-x-1 group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0 transition-all duration-300" />
                    </div>
                    
                    <h3 className="text-xl font-semibold text-foreground mb-2 group-hover:text-white transition-colors">
                      {feature.title}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-auto relative z-10">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Dolph Research
          </p>
          <p className="text-xs text-muted-foreground">
            Built by Shawyan Tabari | 2026
          </p>
        </div>
      </footer>
    </div>
  )
}
