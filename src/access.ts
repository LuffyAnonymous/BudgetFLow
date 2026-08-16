/**
 * src/access.ts
 *
 * Access control rules and input validation hooks for the CMS platform.
 * 
 * Context Information:
 *   - Access control functions have access to `this` context containing the request info.
 *   - `this.user` is the authenticated user.
 *   - `this.user.id` is the user's ID.
 *   - `this.user.role` is an array of strings (e.g., ['admin', 'manager', 'member']).
 */

export interface AccessUser {
  id?: string;
  role?: string[];
  [key: string]: unknown;
}

export interface AccessContext {
  user?: AccessUser | null;
}

export interface CommentInputArgs {
  resolvedData?: {
    content?: string;
    [key: string]: unknown;
  };
}

export interface ReactionInputArgs {
  context: {
    db: {
      Reaction: {
        findMany: (args: { where: Record<string, unknown> }) => Promise<unknown[]>;
      };
    };
  };
  resolvedData: {
    user?: string;
    page?: string;
    comment?: string;
    [key: string]: unknown;
  };
  addValidationError: (error: string) => void;
}

// Helper to determine if a user has a specific role
function hasRole(user: AccessUser | null | undefined, role: string): boolean {
  return !!user && Array.isArray(user.role) && user.role.includes(role);
}

// Helper to check if user is logged in
function isLoggedIn(user: AccessUser | null | undefined): boolean {
  return !!user && !!user.id;
}

// Helper to sanitize HTML content to prevent XSS
export function sanitizeHtml(content: string): string {
  if (!content) return "";
  // Strip HTML tags using regex
  return content.replace(/<\/?[^>]+(>|$)/g, "");
}

// ==========================================
// 1. User Model Access Control
// ==========================================
export const userRules = {
  // Only logged in users can read other users
  read(this: AccessContext) {
    return isLoggedIn(this.user);
  },
  
  // A user can only update their own record, unless they are an admin
  update(this: AccessContext) {
    if (!isLoggedIn(this.user)) return false;
    if (hasRole(this.user, "admin")) return true;
    return { id: this.user?.id }; // Prisma filter
  },
  
  // Only admins can create users
  create(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  
  // Only admins can delete users
  delete(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
};

// ==========================================
// 2. File Model Access Control
// ==========================================
export const fileRules = {
  // Files are publicly readable
  read(this: AccessContext) {
    return true;
  },
  
  // Other operations require being logged in
  create(this: AccessContext) {
    return isLoggedIn(this.user);
  },
  update(this: AccessContext) {
    return isLoggedIn(this.user);
  },
  delete(this: AccessContext) {
    return isLoggedIn(this.user);
  },
};

// ==========================================
// 3. Page Model Access Control
// ==========================================
export const pageRules = {
  // Pages are publicly readable
  read(this: AccessContext) {
    return true;
  },
  
  // Admins and managers can create/update pages
  create(this: AccessContext) {
    return hasRole(this.user, "admin") || hasRole(this.user, "manager");
  },
  update(this: AccessContext) {
    return hasRole(this.user, "admin") || hasRole(this.user, "manager");
  },
  
  // Only admins can delete pages
  delete(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
};

// ==========================================
// 4. UserGroup Model Access Control
// ==========================================
export const userGroupRules = {
  // User groups are admin-only for all operations
  read(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  create(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  update(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  delete(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
};

// ==========================================
// 5. Comment Model Access Control
// ==========================================
export const commentRules = {
  // Comments are publicly readable
  read(this: AccessContext) {
    return true;
  },
  
  // Any logged-in user can create a comment
  create(this: AccessContext) {
    return isLoggedIn(this.user);
  },
  
  // Only the author or an admin can update/delete comments
  update(this: AccessContext) {
    if (!isLoggedIn(this.user)) return false;
    if (hasRole(this.user, "admin")) return true;
    return { author: { id: this.user?.id } }; // Prisma filter
  },
  delete(this: AccessContext) {
    if (!isLoggedIn(this.user)) return false;
    if (hasRole(this.user, "admin")) return true;
    return { author: { id: this.user?.id } }; // Prisma filter
  },
};

// Hook/Hook-like function to clean comment input HTML
export function resolveCommentInput({ resolvedData }: CommentInputArgs) {
  if (resolvedData && typeof resolvedData.content === "string") {
    resolvedData.content = sanitizeHtml(resolvedData.content);
  }
  return resolvedData;
}

// ==========================================
// 6. Reaction Model Access Control
// ==========================================
export const reactionRules = {
  // Reactions are publicly readable
  read(this: AccessContext) {
    return true;
  },
  
  // Any logged-in user can create a reaction
  create(this: AccessContext) {
    return isLoggedIn(this.user);
  },
  
  // Reactions cannot be updated
  update(this: AccessContext) {
    return false;
  },
  
  // Only the owner or an admin can delete a reaction
  delete(this: AccessContext) {
    if (!isLoggedIn(this.user)) return false;
    if (hasRole(this.user, "admin")) return true;
    return { user: { id: this.user?.id } }; // Prisma filter
  },
};

// Validator to ensure duplicate reactions are blocked
export async function validateReactionInput({ context, resolvedData, addValidationError }: ReactionInputArgs) {
  const { user, page, comment } = resolvedData;
  if (!user) return; // Expecting user to be set/injected

  // Find if there is an existing reaction by the same user on same target
  if (page) {
    const existing = await context.db.Reaction.findMany({
      where: {
        user: { id: user },
        page: { id: page },
      },
    });
    if (existing.length > 0) {
      addValidationError("A user can only react to a specific page once.");
    }
  } else if (comment) {
    const existing = await context.db.Reaction.findMany({
      where: {
        user: { id: user },
        comment: { id: comment },
      },
    });
    if (existing.length > 0) {
      addValidationError("A user can only react to a specific comment once.");
    }
  }
}

// ==========================================
// 7. Setting Model Access Control
// ==========================================
export const settingRules = {
  // Only admins can read or write settings
  read(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  create(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  update(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
  delete(this: AccessContext) {
    return hasRole(this.user, "admin");
  },
};
