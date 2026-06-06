/** Platform super-admin — must match AuthContext SUPER_ADMIN_EMAIL and DB migration. */
export const SUPER_ADMIN_EMAIL = "devyntgrillo@gmail.com";

export function isSuperAdminUser(
  user: { email?: string | null } | null | undefined,
  accessLevel?: string | null,
): boolean {
  const email = (user?.email || "").toLowerCase();
  return email === SUPER_ADMIN_EMAIL || accessLevel === "super_admin";
}
