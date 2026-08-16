import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { settings: true, importSetting: true },
  });

  if (!user || !user.settings || !user.importSetting?.enabled) {
    return NextResponse.json({ data: { isHealthy: true, alerts: [] } });
  }

  const alerts = [];
  const now = new Date();

  // 1. Webhook Health
  if (user.importSetting.lastSuccessfulImportAt) {
    const daysSinceLastImport = (now.getTime() - user.importSetting.lastSuccessfulImportAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastImport > 7) {
      alerts.push({
        type: "WEBHOOK_INACTIVE",
        message: "No successful SMS imports have been processed in the last 7 days. Ensure your iPhone Shortcuts automation is active.",
      });
    }
  }

  // 2. Salary Credit Missing
  const payday = user.settings.payday;
  if (payday) {
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const paydayDate = new Date(Date.UTC(currentYear, currentMonth, payday));
    const twentyFourHoursAfter = new Date(paydayDate.getTime() + 24 * 60 * 60 * 1000);

    if (now > twentyFourHoursAfter) {
      const startOfMonth = new Date(Date.UTC(currentYear, currentMonth, 1));
      let salaryCategoryId = user.importSetting.salaryCategoryId;
      if (!salaryCategoryId) {
        const salaryCategory = await db.category.findFirst({
          where: { userId: user.id, name: { equals: "Salary", mode: "insensitive" } }
        });
        salaryCategoryId = salaryCategory?.id ?? null;
      }

      if (salaryCategoryId) {
        const salaryTx = await db.transaction.findFirst({
          where: {
            userId: user.id,
            categoryId: salaryCategoryId,
            date: { gte: startOfMonth },
          },
        });

        if (!salaryTx) {
          alerts.push({
            type: "SALARY_MISSING",
            message: `It has been 24 hours since your payday (${paydayDate.toISOString().slice(0, 10)}), but no salary was detected. Please check if your SMS webhook is healthy or if you need to manually import your salary.`,
          });
        }
      }
    }
  }

  return NextResponse.json({
    data: {
      isHealthy: alerts.length === 0,
      alerts,
    },
  });
}
