'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    router.push(params.get('redirect') ?? '/dashboard');
  }

  return (
    <section className="card" style={{ maxWidth: 460 }}>
      <h1 style={{ marginTop: 0 }}>Login</h1>
      <form onSubmit={onSubmit}>
        <div className="form-row">
          <div>
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        </div>
        {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
        <button className="btn">Sign In</button>
      </form>
      <p className="muted">New user? <Link href="/signup">Create an account</Link></p>
    </section>
  );
}
