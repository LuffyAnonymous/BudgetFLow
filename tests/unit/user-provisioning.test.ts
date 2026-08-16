import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { provisionNewUser, DEFAULT_CATEGORIES } from "../../src/server/services/user-provisioning.service";

describe("provisionNewUser", () => {
  beforeEach(async () => {
    await db.account.deleteMany({ where: { user: { email: "provision_test@budgetflow.ae" } } });
    await db.setting.deleteMany({ where: { user: { email: "provision_test@budgetflow.ae" } } });
    await db.category.deleteMany({ where: { user: { email: "provision_test@budgetflow.ae" } } });
    await db.user.deleteMany({ where: { email: "provision_test@budgetflow.ae" } });
  });

  it("creates a user with the default categories, a settings row, and default accounts", async () => {
    const result = await provisionNewUser({
      email: "provision_test@budgetflow.ae",
      passwordHash: "dummy-hash",
      name: "New Person",
    });

    expect(result.email).toBe("provision_test@budgetflow.ae");

    const user = await db.user.findUnique({ where: { id: result.id } });
    expect(user).not.toBeNull();
    expect(user?.name).toBe("New Person");

    const settings = await db.setting.findUnique({ where: { userId: result.id } });
    expect(settings).not.toBeNull();
    expect(settings?.monthlySalary.toNumber()).toBe(0);

    const categories = await db.category.findMany({ where: { userId: result.id } });
    expect(categories.length).toBe(DEFAULT_CATEGORIES.length);
    const categoryNames = categories.map((c) => c.name).sort();
    expect(categoryNames).toEqual([...DEFAULT_CATEGORIES.map((c) => c.name)].sort());

    const accounts = await db.account.findMany({ where: { userId: result.id } });
    const accountTypes = accounts.map((a) => a.type).sort();
    expect(accountTypes).toEqual(["CASH", "EMIRATES_NBD"]);
  });

  it("rolls back everything if any step fails (e.g. duplicate email)", async () => {
    await provisionNewUser({
      email: "provision_test@budgetflow.ae",
      passwordHash: "dummy-hash",
      name: "First",
    });

    await expect(
      provisionNewUser({
        email: "provision_test@budgetflow.ae",
        passwordHash: "dummy-hash",
        name: "Duplicate",
      })
    ).rejects.toThrow();

    // Only the first user's data should exist — no partial second attempt leaked in.
    const users = await db.user.findMany({ where: { email: "provision_test@budgetflow.ae" } });
    expect(users.length).toBe(1);
    const categories = await db.category.findMany({ where: { userId: users[0].id } });
    expect(categories.length).toBe(DEFAULT_CATEGORIES.length);
  });
});
