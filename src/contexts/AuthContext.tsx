import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  clearAuthSession,
  fetchCurrentMember,
  fetchPublicConfig,
  getAuthSession,
  hasSignedOutInTab,
  markSignedOutInTab,
  shouldAutoEnterDemo,
  signInWithDemoAccount,
  signOutSession,
  subscribeAuthSession,
  type AuthenticatedMember,
  type PublicAppConfig,
} from '../services/authSession';

export type AuthStatus =
  | 'initializing'
  | 'unauthenticated'
  | 'signing_in'
  | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  config: PublicAppConfig | null;
  member: AuthenticatedMember | null;
  error: string | null;
  enterDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshIdentity: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [config, setConfig] = useState<PublicAppConfig | null>(null);
  const [member, setMember] = useState<AuthenticatedMember | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMemberIdentity = useCallback(async () => {
    try {
      const resolvedMember = await fetchCurrentMember();
      setMember(resolvedMember);
      setError(null);
      setStatus('authenticated');
    } catch (err) {
      const errStatus =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : 0;
      const message =
        err instanceof Error
          ? err.message
          : 'Unable to verify your session with the server.';

      if (errStatus === 401 || errStatus === 403) {
        clearAuthSession();
      }
      setMember(null);
      setError(errStatus === 401 ? null : message);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      let publicConfig: PublicAppConfig | null = null;
      try {
        publicConfig = await fetchPublicConfig();
        if (!active) return;
        setConfig(publicConfig);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to reach server configuration (/api/config).'
        );
      }

      const attemptAutoEnterDemo = async () => {
        try {
          await signInWithDemoAccount();
          const resolvedMember = await fetchCurrentMember();
          if (!active) return;
          setMember(resolvedMember);
          setError(null);
          setStatus('authenticated');
        } catch (err) {
          if (!active) return;
          clearAuthSession();
          setMember(null);
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to enter demo workspace.'
          );
          setStatus('unauthenticated');
        }
      };

      const existingSession = getAuthSession();
      if (!existingSession) {
        if (
          shouldAutoEnterDemo({
            config: publicConfig,
            hasExistingSession: false,
            signedOutInTab: hasSignedOutInTab(),
          })
        ) {
          await attemptAutoEnterDemo();
          return;
        }
        if (!active) return;
        setMember(null);
        setStatus('unauthenticated');
        return;
      }

      try {
        const resolvedMember = await fetchCurrentMember();
        if (!active) return;
        setMember(resolvedMember);
        setError(null);
        setStatus('authenticated');
      } catch (err) {
        if (!active) return;
        const errStatus =
          err && typeof err === 'object' && 'status' in err
            ? Number((err as { status?: unknown }).status)
            : 0;
        clearAuthSession();
        if (
          errStatus === 401 &&
          shouldAutoEnterDemo({
            config: publicConfig,
            hasExistingSession: false,
            signedOutInTab: hasSignedOutInTab(),
          })
        ) {
          await attemptAutoEnterDemo();
          return;
        }
        setMember(null);
        setError(
          errStatus === 401
            ? null
            : err instanceof Error
              ? err.message
              : 'Unable to verify your session.'
        );
        setStatus('unauthenticated');
      }
    }

    void bootstrap();

    const unsubscribe = subscribeAuthSession((nextSession) => {
      if (!active) return;
      if (!nextSession) {
        setMember(null);
        setStatus((prev) =>
          prev === 'signing_in' || prev === 'initializing'
            ? prev
            : 'unauthenticated'
        );
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const enterDemo = useCallback(async () => {
    setError(null);
    setStatus('signing_in');
    markSignedOutInTab(false);
    try {
      await signInWithDemoAccount();
      const resolvedMember = await fetchCurrentMember();
      setMember(resolvedMember);
      setStatus('authenticated');
    } catch (err) {
      clearAuthSession();
      setMember(null);
      setError(
        err instanceof Error ? err.message : 'Unable to enter demo workspace.'
      );
      setStatus('unauthenticated');
    }
  }, []);

  const signOut = useCallback(async () => {
    markSignedOutInTab(true);
    setError(null);
    setMember(null);
    setStatus('unauthenticated');
    await signOutSession();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status,
        config,
        member,
        error,
        enterDemo,
        signOut,
        refreshIdentity: loadMemberIdentity,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return ctx;
}
