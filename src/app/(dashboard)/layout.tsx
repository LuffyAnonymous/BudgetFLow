import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DashboardLayoutClient } from "./layout-client";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  
  if (!session) {
    redirect("/login");
  }

  return (
    <DashboardLayoutClient
      userName={session.user?.name}
      userEmail={session.user?.email}
    >
      {children}
    </DashboardLayoutClient>
  );
}
