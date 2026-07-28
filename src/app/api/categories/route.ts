import { resolveRequestAuth } from "@/lib/service-auth";
import { CategoryRepository } from "@/server/repositories/category.repository";
import { apiSuccess, apiError, handleApiError } from "@/lib/api";

const categoryRepo = new CategoryRepository();

export async function GET(request: Request) {
  try {
    const authResult = await resolveRequestAuth(request, "categories:read");
    if (!authResult) {
      return apiError("UNAUTHORIZED", "You must be signed in, or provide a service API key with categories:read scope, to perform this action.", 401);
    }

    const categories = await categoryRepo.findManyByUserId(authResult.userId);
    
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
