"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useSession } from "../../auth/use-session";
const UserContext = createContext<string | null>(null);
export const useCardUser = () => useContext(UserContext);
export function CardUserProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  return (
    <UserContext.Provider value={session.user?.id ?? null}>
      {children}
    </UserContext.Provider>
  );
}
