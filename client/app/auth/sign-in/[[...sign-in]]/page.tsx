import { SignIn } from "@clerk/nextjs"

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <SignIn
        appearance={{
          elements: {
            formButtonPrimary: "bg-black hover:bg-gray-800 text-white",
            card: "shadow-lg",
          },
        }}
        redirectUrl="/dashboard"
        signUpUrl="/auth/sign-up"
      />
    </div>
  )
}
