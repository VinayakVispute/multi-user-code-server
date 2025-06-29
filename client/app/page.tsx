import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default async function HomePage() {
  const { userId } = await auth()

  if (userId) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome</CardTitle>
          <CardDescription>Get started by signing in to your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button asChild className="w-full">
            <Link href="/auth/sign-in">Sign In</Link>
          </Button>
          <Button asChild variant="outline" className="w-full bg-white text-black">
            <Link href="/auth/sign-up">Sign Up</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
