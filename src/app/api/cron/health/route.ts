import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NotificationType, NotificationSeverity } from "@prisma/client";
import { NotificationService } from "@/server/services/notification.service";

const notificationService = new NotificationService();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await db.user.findMany({
    include: {
      settings: true,
      importSetting: true,
    },
  });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  let alertedUsers = 0;

  for (const user of users) {
    if (!user.settings || !user.importSetting?.enabled) continue;

    const payday = user.settings.payday;
    if (!payday) continue;

    // Check if we are past payday + 24 hours
    const paydayDate = new Date(Date.UTC(currentYear, currentMonth, payday));
    const twentyFourHoursAfter = new Date(paydayDate.getTime() + 24 * 60 * 60 * 1000);

    if (now > twentyFourHoursAfter) {
      // Check if a salary transaction was imported this month
      const startOfMonth = new Date(Date.UTC(currentYear, currentMonth, 1));
      
      let salaryCategoryId = user.importSetting.salaryCategoryId;
      if (!salaryCategoryId) {
        const salaryCategory = await db.category.findFirst({
          where: { userId: user.id, name: { equals: "Salary", mode: "insensitive" } }
        });
        salaryCategoryId = salaryCategory?.id ?? null;
      }

      if (!salaryCategoryId) continue;

      const salaryTx = await db.transaction.findFirst({
        where: {
          userId: user.id,
          categoryId: salaryCategoryId,
          date: { gte: startOfMonth },
        },
      });

      if (!salaryTx) {
        await notificationService.createNotificationIdempotent(user.id, {
          type: NotificationType.BUDGET_EXCEEDED, 
          // Prisma doesn't have a specific SALARY_DELAYED type, but we can use UPCOMING_PAYMENT or create a message
          title: "Salary Import Missing",
          message: `It has been 24 hours since your payday (${paydayDate.toISOString().slice(0, 10)}), but no salary was detected. Please check if your SMS webhook is healthy or if you need to manually import your salary.`,
          severity: NotificationSeverity.CRITICAL,
          eventKey: `missing-salary-${currentYear}-${currentMonth}`,
        } as any);
        alertedUsers++;
      }
    }

    // Monitor webhook health: If it's been more than 7 days since last successful import
    if (user.importSetting.lastSuccessfulImportAt) {
      const daysSinceLastImport = (now.getTime() - user.importSetting.lastSuccessfulImportAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastImport > 7) {
        await notificationService.createNotificationIdempotent(user.id, {
          title: "Import Webhook Health Alert",
          message: "No successful SMS imports have been processed in the last 7 days. Ensure your iPhone Shortcuts automation is active.",
          severity: NotificationSeverity.WARNING,
          eventKey: `webhook-health-${currentYear}-${Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000))}`, // Weekly alert
        } as any);
      }
    }
  }

  return NextResponse.json({ success: true, alertedUsers });
}
