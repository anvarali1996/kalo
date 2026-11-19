export function isAdminUser(userId: string): boolean {
  if (!userId) return false;
  const allowedIds = (process.env.KALO_ADMIN_USER_IDS ?? "").split(",");
  return allowedIds.some(id => id.trim().toLowerCase() === userId.toLowerCase());
}
