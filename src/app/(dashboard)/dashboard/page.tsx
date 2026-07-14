import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DashboardService } from "@/server/services/dashboard.service";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }

  const dashboardService = new DashboardService();
  
  // Fetch initial dashboard statistics on the server
  const initialData = await dashboardService.getDashboardData(session.user.id);

  return <DashboardClient initialData={initialData} />;
}
