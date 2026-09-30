import React from "react";
import { createAuthController, type AuthSnapshot } from "./controller";

type AuthContextValue = AuthSnapshot & {
  isAdmin: boolean;
  signIn: (key: string) => Promise<void>;
  signOut: () => void;
  refresh: () => void;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [controller] = React.useState(createAuthController);
  const snapshot = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  React.useEffect(() => controller.start(), [controller]);
  const value = React.useMemo(() => ({
    ...snapshot,
    isAdmin: snapshot.session?.access_level === "admin",
    signIn: controller.signIn,
    signOut: controller.signOut,
    refresh: controller.refresh,
  }), [controller, snapshot]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const auth = React.useContext(AuthContext);
  if (!auth) throw new Error("useAuth requires AuthProvider");
  return auth;
}
