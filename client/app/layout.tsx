import type React from "react"
import { ClerkProvider } from "@clerk/nextjs"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata = {
  title: "CloudCode - VS Code in the Cloud",
  description: "Access your development environment from anywhere. Auto-scaling, secure VS Code workspaces with intelligent resource management.",
  keywords: "VS Code, cloud development, code editor, remote development, auto-scaling",
  authors: [{ name: "CloudCode Team" }],
  openGraph: {
    title: "CloudCode - VS Code in the Cloud",
    description: "Access your development environment from anywhere. Auto-scaling, secure VS Code workspaces.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={inter.className}>{children}</body>
      </html>
    </ClerkProvider>
  )
}
