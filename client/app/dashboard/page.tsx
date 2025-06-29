import { currentUser } from "@clerk/nextjs/server"
import { redirect } from "next/navigation";
import DashboardClient from "@/components/shared/DashboardClient";

export default async function DashboardPage() {
  const user = await currentUser()

  if (!user?.id) {
    redirect("/auth/sign-in")
  }

  return <DashboardClient firstName={user.firstName} />
}
