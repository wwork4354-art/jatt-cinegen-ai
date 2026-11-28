import { useEffect, useState, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { verifyDomainAndFrameIntegrity } from '../../shared/securityShield';

interface SecurityGateProps {
  children: ReactNode;
}

export function SecurityGate({ children }: SecurityGateProps) {
  const allowedDomainsEnv = (import.meta.env.VITE_ALLOWED_DOMAINS as string | undefined) ?? '';
  const [integrity, setIntegrity] = useState(() =>
    verifyDomainAndFrameIntegrity(allowedDomainsEnv)
  );

  useEffect(() => {
    const check = () => {
      const next = verifyDomainAndFrameIntegrity(allowedDomainsEnv);
      if (!next.allowed) {
        setIntegrity(next);
      }
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => window.clearInterval(timer);
  }, [allowedDomainsEnv]);

  if (!integrity.allowed) {
    return (
      <div className="min-h-screen bg-[#07090E] text-slate-100 flex items-center justify-center p-6">
        <div
          role="alert"
          className="max-w-md w-full rounded-2xl border border-rose-500/40 bg-[#0D1118] p-6 space-y-4 shadow-2xl"
        >
          <div className="flex items-center gap-3 text-rose-400">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-400/40 bg-rose-500/15">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-white">
                Security Shield · Access Blocked
              </h1>
              <p className="text-xs text-rose-300/90">
                Anti-Tamper &amp; Domain Protection Active
              </p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-slate-300">
            {integrity.reason ||
              'This copy of Jatt CineGen AI was blocked to protect your API keys and account safety.'}
          </p>

          <div className="rounded-xl border border-white/10 bg-[#07090E] p-3 text-xs text-slate-400 space-y-1">
            <div>
              Detected Host:{' '}
              <span className="font-mono text-slate-200">{integrity.hostname || 'unknown'}</span>
            </div>
            <div>Open the official Jatt CineGen AI deployment directly in your browser.</div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
