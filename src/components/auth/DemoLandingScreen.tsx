import { ArrowRight, Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export function DemoLandingScreen() {
  const { status, config, error, enterDemo } = useAuth();
  const isInitializing = status === 'initializing';
  const isSigningIn = status === 'signing_in';
  const demoLoginEnabled = Boolean(config?.demo_login_enabled);

  return (
    <div className="flex min-h-screen flex-col justify-between bg-[#F3F1EB] px-4 py-10 text-[#202824] sm:px-6">
      <div className="mx-auto flex w-full max-w-[540px] flex-1 flex-col justify-center">
        <div className="rounded-lg border border-[#D9D7D0] bg-white p-8 sm:p-10">
          <div className="flex items-center gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#315F52] text-[15px] font-semibold tracking-tight text-white"
              aria-hidden="true"
            >
              S
            </span>
            <span className="text-[12px] font-medium tracking-[0.02em] text-[#788C83]">
              Operations &amp; Intelligence
            </span>
          </div>

          <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-[#202824] sm:text-[32px]">
            Sponsorship Growth Platform
          </h1>

          <p className="mt-3 text-[15px] leading-relaxed text-[#525E58]">
            Demo environment: simulated 2026 season plus read-only 2025 history
          </p>

          {error ? (
            <div
              role="alert"
              className="mt-6 rounded-md border border-[#DC2626]/30 bg-[#DC2626]/5 px-4 py-3 text-[13px] text-[#991B1B]"
            >
              {error}
            </div>
          ) : null}

          <div className="mt-8 border-t border-[#E8E6E0] pt-6">
            {isInitializing ? (
              <div className="flex items-center gap-3 text-[13px] text-[#525E58]">
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#D9D7D0] border-t-[#315F52]" />
                <span>Checking server session configuration...</span>
              </div>
            ) : demoLoginEnabled ? (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => void enterDemo()}
                  disabled={isSigningIn}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#315F52] px-5 text-[14px] font-medium text-white transition-colors duration-150 hover:bg-[#264B40] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  <span>{isSigningIn ? 'Signing in...' : 'Enter demo'}</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <p className="text-[12px] text-[#788C83]">
                  Signs in on the server with the configured demo account. All
                  changes are recorded in the audit log.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-md border border-[#E8E6E0] bg-[#FAF9F6] px-4 py-3.5 text-[13px] text-[#525E58]">
                <Lock
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#788C83]"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-[#202824]">
                    Demo sign-in is not enabled
                  </p>
                  <p className="mt-0.5 text-[12px] text-[#788C83]">
                    The server has not enabled one-click demo access for this
                    environment.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
