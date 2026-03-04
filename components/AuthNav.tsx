'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

export function AuthNav() {
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);
  const [user, setUser] = useState<User | null | undefined>(supabase ? undefined : null);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;

    supabase.auth.getUser().then(({ data }) => {
      if (!mounted) return;
      setUser(data.user ?? null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  async function onLogout() {
    if (!supabase) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    setSigningOut(false);
    router.push('/login');
    router.refresh();
  }

  if (user === undefined) {
    return <nav className="nav-links"><span className="muted">Loading...</span></nav>;
  }

  if (!user) {
    const redirectParam = pathname && pathname !== '/' ? `?redirect=${encodeURIComponent(pathname)}` : '';
    return (
      <nav className="nav-links">
        <Link href="/">Home</Link>
        <Link href={`/login${redirectParam}`}>Login</Link>
        <Link href={`/signup${redirectParam}`}>Sign Up</Link>
      </nav>
    );
  }

  return (
    <nav className="nav-links">
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/mock">Mocks</Link>
      <Link href="/practice/section">Practice</Link>
      <Link href="/pyq">PYQ Search</Link>
      <button type="button" className="nav-logout" onClick={onLogout} disabled={signingOut}>
        {signingOut ? 'Logging out...' : 'Logout'}
      </button>
    </nav>
  );
}
