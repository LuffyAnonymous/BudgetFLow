import { auth } from "@/auth";
import { ReportRepository } from "@/server/repositories/report.repository";
import { ReportService } from "@/server/services/report.service";
import { apiError } from "@/lib/api";
import { getDubaiCurrentDate } from "@/lib/dates";

const reportRepo = new ReportRepository();
const reportService = new ReportService();

// Helper to escape values and protect against formula injection
function escapeCSVValue(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }
  let str = String(val);

  // Protect against spreadsheet formula injection (CSV Injection)
  const dangerousPrefixes = ["=", "+", "-", "@", "\t", "\r"];
  if (dangerousPrefixes.some((char) => str.startsWith(char))) {
    str = "'" + str; // Neutralize with safe single quote prefix
  }

  // Double quotes inside string must be escaped by doubling them
  // If value contains quotes, commas or newlines, wrap in quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Helper to build CSV text with UTF-8 BOM
function buildCSV(headers: string[], rows: string[][]): string {
  const bom = "\uFEFF";
  const headerLine = headers.map(escapeCSVValue).join(",");
  const rowLines = rows.map((row) => row.map(escapeCSVValue).join(","));
  return bom + [headerLine, ...rowLines].join("\r\n");
}

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to export data.", 401);
    }

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    if (!type) {
      return apiError("BAD_REQUEST", "Parameter 'type' is required.", 400);
    }

    const validTypes = [
      "transactions",
      "budgets",
      "debt_payments",
      "savings_transactions",
      "remittances",
      "monthly_summary",
    ];

    if (!validTypes.includes(type)) {
      return apiError("BAD_REQUEST", `Invalid export type. Must be one of: ${validTypes.join(", ")}`, 400);
    }

    const startDateStr = searchParams.get("startDate");
    const endDateStr = searchParams.get("endDate");

    let startDate: Date | undefined = undefined;
    let endDate: Date | undefined = undefined;

    if (startDateStr) {
      startDate = new Date(startDateStr);
      if (isNaN(startDate.getTime())) {
        return apiError("BAD_REQUEST", "Invalid startDate format.", 400);
      }
    }
    if (endDateStr) {
      endDate = new Date(endDateStr);
      if (isNaN(endDate.getTime())) {
        return apiError("BAD_REQUEST", "Invalid endDate format.", 400);
      }
    }

    // Limit range check: max 5 years
    if (startDate && endDate) {
      const diffMs = endDate.getTime() - startDate.getTime();
      const fiveYearsMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
      if (diffMs > fiveYearsMs) {
        return apiError("BAD_REQUEST", "Range limit exceeded. Maximum export range is 5 years.", 400);
      }
      if (diffMs < 0) {
        return apiError("BAD_REQUEST", "Start date must be prior to or equal to end date.", 400);
      }
    }

    let csvContent = "";
    let filename = `${type}_export.csv`;

    const formatShortDate = (d: Date) => {
      // YYYY-MM-DD
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    if (type === "transactions") {
      const data = await reportRepo.getTransactions(session.user.id, startDate, endDate);
      const headers = ["Date", "Category", "Description", "Amount", "Payment Method", "Notes", "Type", "Cash Flow Direction"];
      const rows = data.map((t) => [
        formatShortDate(t.date),
        t.category.name,
        t.description,
        t.amount.toFixed(2),
        t.paymentMethod,
        t.notes || "",
        t.type,
        t.cashFlowDirection || "",
      ]);
      csvContent = buildCSV(headers, rows);
    } else if (type === "budgets") {
      const data = await reportRepo.getBudgets(session.user.id);
      const headers = ["Month", "Category", "Planned Amount"];
      const rows = data.map((b) => [
        b.month,
        b.category.name,
        b.amount.toFixed(2),
      ]);
      csvContent = buildCSV(headers, rows);
    } else if (type === "debt_payments") {
      const data = await reportRepo.getDebtPayments(session.user.id, startDate, endDate);
      const headers = ["Payment Date", "Debt Name", "Amount Paid", "Balance Before", "Balance After", "Notes"];
      const rows = data.map((p) => [
        formatShortDate(p.paymentDate),
        p.debt.name,
        p.amount.toFixed(2),
        p.balanceBefore.toFixed(2),
        p.balanceAfter.toFixed(2),
        p.notes || "",
      ]);
      csvContent = buildCSV(headers, rows);
    } else if (type === "savings_transactions") {
      const data = await reportRepo.getSavingTransactions(session.user.id, startDate, endDate);
      const headers = ["Transaction Date", "Goal Name", "Amount", "Type", "Balance Before", "Balance After", "Notes"];
      const rows = data.map((t) => [
        formatShortDate(t.transactionDate),
        t.savingGoal.name,
        t.amount.toFixed(2),
        t.type,
        t.balanceBefore.toFixed(2),
        t.balanceAfter.toFixed(2),
        t.notes || "",
      ]);
      csvContent = buildCSV(headers, rows);
    } else if (type === "remittances") {
      const data = await reportRepo.getRemittances(session.user.id, startDate, endDate);
      const headers = ["Transfer Date", "Recipient", "Amount Sent (AED)", "Exchange Rate", "Amount Received (PHP)", "Transfer Fee (AED)", "Transfer Provider", "Reference Number", "Status", "Notes"];
      const rows = data.map((r) => [
        formatShortDate(r.transferDate),
        r.recipient || "Not available",
        r.amountSentAed.toFixed(2),
        r.exchangeRate ? r.exchangeRate.toFixed(6) : "Not available",
        r.amountReceivedPhp ? r.amountReceivedPhp.toFixed(2) : "Not available",
        r.transferFeeAed ? r.transferFeeAed.toFixed(2) : "Not available",
        r.transferProvider,
        r.referenceNumber || "",
        r.status,
        r.notes || "",
      ]);
      csvContent = buildCSV(headers, rows);
    } else if (type === "monthly_summary") {
      // Reconstruct last 12 months trends by default, or use query dates
      let startMonth = "2025-07";
      let endMonth = "2026-07";

      if (startDate && endDate) {
        const startY = startDate.getUTCFullYear();
        const startM = String(startDate.getUTCMonth() + 1).padStart(2, "0");
        const endY = endDate.getUTCFullYear();
        const endM = String(endDate.getUTCMonth() + 1).padStart(2, "0");
        startMonth = `${startY}-${startM}`;
        endMonth = `${endY}-${endM}`;
      } else {
        const nowDubai = getDubaiCurrentDate();
        // last 12 months
        const activeYear = nowDubai.year;
        const activeMonth = nowDubai.month;
        const startVal = activeYear * 12 + (activeMonth - 1) - 11;
        const y = Math.floor(startVal / 12);
        const m = (startVal % 12) + 1;
        startMonth = `${y}-${String(m).padStart(2, "0")}`;
        endMonth = `${activeYear}-${String(activeMonth).padStart(2, "0")}`;
      }

      const trendReport = await reportService.getTrendsReport(session.user.id, startMonth, endMonth);
      const headers = ["Month", "Income", "Expense", "Net Cash Flow", "Debt Balance", "Savings Balance", "Remittance Sent"];
      const rows = trendReport.months.map((m) => [
        m.month,
        m.income,
        m.expense,
        m.netCashFlow,
        m.debtBalance,
        m.savingsBalance,
        m.remittanceSent,
      ]);
      csvContent = buildCSV(headers, rows);
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    filename = `${type}_export_${timestamp}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Export Error:", error);
    return new Response("An unexpected error occurred during export.", { status: 500 });
  }
}
