import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Terminal, Cloud, Zap, Shield, Code, Users } from "lucide-react"

export default async function HomePage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-slate-100">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <Terminal className="h-8 w-8 text-blue-600" />
              <span className="text-xl font-bold text-slate-900">CloudCode</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/auth/sign-in">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/auth/sign-up">
                <Button>Get Started</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center py-20">
          <div className="mb-8">
            <Terminal className="h-16 w-16 text-blue-600 mx-auto mb-6" />
            <h1 className="text-4xl md:text-6xl font-bold text-slate-900 mb-6">
              Code in the Cloud
              <span className="block text-blue-600">VS Code Anywhere</span>
            </h1>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto mb-8">
              Access your development environment from anywhere. Auto-scaling, secure, and always ready when you are.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-4 mb-16">
            <Button asChild size="lg" className="text-lg px-8 py-3">
              <Link href="/auth/sign-up">
                <Code className="h-5 w-5 mr-2" />
                Start Coding Now
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="text-lg px-8 py-3">
              <Link href="/auth/sign-in">
                Sign In to Dashboard
              </Link>
            </Button>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            <Card className="border-0 shadow-lg">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 p-3 bg-blue-100 rounded-full w-fit">
                  <Zap className="h-8 w-8 text-blue-600" />
                </div>
                <CardTitle>Auto-Scaling</CardTitle>
                <CardDescription>
                  Instances scale up and down based on demand. Pay only for what you use.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 p-3 bg-green-100 rounded-full w-fit">
                  <Cloud className="h-8 w-8 text-green-600" />
                </div>
                <CardTitle>Cloud Native</CardTitle>
                <CardDescription>
                  Built on AWS with Redis state management and intelligent warm-spare pooling.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-0 shadow-lg">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 p-3 bg-purple-100 rounded-full w-fit">
                  <Shield className="h-8 w-8 text-purple-600" />
                </div>
                <CardTitle>Secure Access</CardTitle>
                <CardDescription>
                  Authenticated access with automatic session management and idle cleanup.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>

          {/* Stats */}
          <div className="bg-white/60 backdrop-blur-sm rounded-2xl p-8 mb-16">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-blue-600 mb-2">5 min</div>
                <div className="text-slate-600">Auto-cleanup timeout</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-green-600 mb-2">30s</div>
                <div className="text-slate-600">Average startup time</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-purple-600 mb-2">24/7</div>
                <div className="text-slate-600">Available worldwide</div>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <Card className="border-0 shadow-xl bg-gradient-to-r from-blue-600 to-purple-600 text-white">
            <CardHeader className="text-center py-12">
              <CardTitle className="text-3xl mb-4">Ready to Start Coding?</CardTitle>
              <CardDescription className="text-blue-100 text-lg mb-8">
                Join developers who've made the switch to cloud-based development
              </CardDescription>
              <div className="flex flex-col sm:flex-row justify-center gap-4">
                <Button asChild size="lg" variant="secondary" className="text-lg px-8 py-3">
                  <Link href="/auth/sign-up">
                    <Users className="h-5 w-5 mr-2" />
                    Create Account
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="text-lg px-8 py-3 border-white text-white hover:bg-white hover:text-blue-600">
                  <Link href="/auth/sign-in">
                    Access Dashboard
                  </Link>
                </Button>
              </div>
            </CardHeader>
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-3 mb-4">
              <Terminal className="h-6 w-6" />
              <span className="text-lg font-semibold">CloudCode</span>
            </div>
            <p className="text-slate-400">
              Cloud-native VS Code workspaces with auto-scaling infrastructure
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
