import { db } from "@/lib/db";
import { Prisma, Setting } from "@prisma/client";

export class SettingsRepository {
  async findByUserId(userId: string): Promise<Setting | null> {
    return db.setting.findUnique({
      where: { userId },
    });
  }

  async upsert(
    userId: string,
    data: Omit<Prisma.SettingUncheckedCreateInput, "userId">
  ): Promise<Setting> {
    return db.setting.upsert({
      where: { userId },
      create: {
        ...data,
        userId,
      },
      update: data,
    });
  }
}
