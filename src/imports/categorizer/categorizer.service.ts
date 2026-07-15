import { db } from "@/lib/db";
import { Category, CategoryType } from "@prisma/client";
import type { NormalizedSmsTransaction } from "../sms/sms-parser.interface";
import { defaultRulesEngine, MERCHANT_CATEGORIES } from "../rules/rules-engine";

export type CategorizerResult =
  | { resolved: true; categoryId: string; matchedRuleId: string | null }
  | { resolved: false; reason: "NO_SALARY_CATEGORY_CONFIGURED" | "CATEGORY_NOT_FOUND" | "CATEGORY_WRONG_TYPE" | "CATEGORY_NOT_OWNED" | "DEBT_NOT_FOUND" };

export class CategorizerService {
  /**
   * Resolves the category for any normalized SMS transaction using stable keys and defaults.
   */
  async resolveCategory(
    userId: string,
    normalized: NormalizedSmsTransaction
  ): Promise<CategorizerResult> {
    const { categoryKey, matchedRuleId } = defaultRulesEngine.apply(normalized);

    // 1. If SALARY credit, fetch via ImportSetting.salaryCategoryId or fallback to category named "Salary"
    if (categoryKey === "SALARY") {
      const importSetting = await db.importSetting.findUnique({
        where: { userId },
        select: { salaryCategoryId: true },
      });

      if (importSetting?.salaryCategoryId) {
        const category = await db.category.findUnique({
          where: { id: importSetting.salaryCategoryId },
          select: { id: true, userId: true, type: true },
        });
        if (category && category.userId === userId && category.type === CategoryType.INCOME) {
          return { resolved: true, categoryId: category.id, matchedRuleId };
        }
      }

      // Fallback: Find Category named "Salary"
      const salaryCat = await db.category.findFirst({
        where: { userId, name: { equals: "Salary", mode: "insensitive" } },
      });
      if (salaryCat) {
        return { resolved: true, categoryId: salaryCat.id, matchedRuleId };
      }

      return { resolved: false, reason: "NO_SALARY_CATEGORY_CONFIGURED" };
    }

    // 2. If DEBT payment (Tabby / Table Tennis), look up active debt to find categoryId
    if (categoryKey === "DEBT") {
      const isTabby = /tabby/i.test(normalized.merchant || "");
      const debtNamePattern = isTabby ? "Tabby" : "Table Tennis Equipment";

      const debt = await db.debt.findFirst({
        where: {
          userId,
          status: "ACTIVE",
          name: { contains: debtNamePattern, mode: "insensitive" },
        },
        select: { categoryId: true },
      });

      if (debt?.categoryId) {
        return { resolved: true, categoryId: debt.categoryId, matchedRuleId };
      }

      // Fallback if debt not found: Categorize under "Uncategorized"
      const uncategorized = await this.getUncategorized(userId);
      return { resolved: true, categoryId: uncategorized.id, matchedRuleId };
    }

    // 3. For other special rule keys, map to standard category names
    let targetName: string | null = null;
    if (categoryKey === "TRANSFERS") targetName = "Transfers";
    if (categoryKey === "RENT_CASH") targetName = "Rent Cash";
    if (categoryKey === "TRANSPORTATION") targetName = "Transportation";
    if (categoryKey === "REMITTANCE") targetName = "Remittance";

    if (targetName) {
      const cat = await db.category.findFirst({
        where: { userId, name: { equals: targetName, mode: "insensitive" } },
      });
      if (cat) {
        return { resolved: true, categoryId: cat.id, matchedRuleId };
      }
    }

    // 4. Fallback for general spends or unmapped categories: Try to find a category matching the merchant name,
    // otherwise fallback to "Uncategorized".
    if (normalized.merchant) {
      const cleanMerchant = normalized.merchant.trim().toUpperCase();
      const matchedKey = Object.keys(MERCHANT_CATEGORIES).find(
        (key) => cleanMerchant === key || cleanMerchant.includes(key) || key.includes(cleanMerchant)
      );
      const mappedCategoryName = matchedKey ? MERCHANT_CATEGORIES[matchedKey] : null;

      if (mappedCategoryName) {
        const cat = await db.category.findFirst({
          where: { userId, name: { equals: mappedCategoryName, mode: "insensitive" } },
        });
        if (cat) {
          return { resolved: true, categoryId: cat.id, matchedRuleId: "builtin-merchant-map" };
        }
      }

      const cat = await db.category.findFirst({
        where: { userId, name: { equals: normalized.merchant, mode: "insensitive" } },
      });
      if (cat) {
        return { resolved: true, categoryId: cat.id, matchedRuleId: null };
      }
    }

    const uncategorized = await this.getUncategorized(userId);
    return { resolved: true, categoryId: uncategorized.id, matchedRuleId: null };
  }

  private async getUncategorized(userId: string): Promise<Category> {
    const uncategorized = await db.category.findFirst({
      where: { userId, name: { equals: "Uncategorized", mode: "insensitive" } },
    });

    if (uncategorized) return uncategorized;

    // Fallback in case of seed absence (ensure no crash)
    return db.category.create({
      data: {
        userId,
        name: "Uncategorized",
        type: CategoryType.VARIABLE_EXPENSE,
      },
    });
  }
}

export const categorizerService = new CategorizerService();
