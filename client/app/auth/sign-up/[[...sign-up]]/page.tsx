import { SignUp } from "@clerk/nextjs"

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <SignUp
        appearance={{
          elements: {
            formButtonPrimary: "bg-black hover:bg-gray-800 text-white",
            card: "shadow-lg",
          },
        }}
        redirectUrl="/dashboard"
        signInUrl="/auth/sign-in"
      />
    </div>
  )
}
