import { auth } from "@/auth";
import { CategoryRepository } from "@/server/repositories/category.repository";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const categoryRepo = new CategoryRepository();

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError("UNAUTHORIZED", "You must be signed in to perform this action.", 401);
    }

    const categories = await categoryRepo.findManyByUserId(session.user.id);
    
    // Map to safe client format
    const data = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      budgetGroupKey: cat.budgetGroupKey,
    }));

    return apiSuccess(data);
  } catch (error) {
    return handleApiError(error);
  }
}
