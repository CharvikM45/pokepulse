/** A-01 boundary. A-02 supplies verified Supabase Auth implementation. */
export interface SessionUser {
  id: string;
}
export interface AuthService {
  getUser(): Promise<SessionUser | null>;
}
export const anonymousAuth: AuthService = {
  async getUser() {
    return null;
  },
};
export async function requireUser(auth: AuthService): Promise<SessionUser> {
  const user = await auth.getUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
// Never derive staff status from user-editable metadata or a request body.
