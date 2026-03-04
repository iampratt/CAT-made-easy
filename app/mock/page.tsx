'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MockConfigPage() {
  const [type, setType] = useState<'full' | 'section' | 'topic'>('full');
  const [section, setSection] = useState<'quant' | 'dilr' | 'varc'>('quant');
  const [topic, setTopic] = useState('time and work');
  const [count, setCount] = useState(22);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const route = type === 'full' ? 'mock' : type;
      const res = await fetch(`/api/generate/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, topic, count }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? await res.json()
        : { error: `Unexpected response from server (${res.status}).` };

      if (!res.ok || !payload.mockId) {
        setError(payload.error ?? 'Failed to generate mock. Please try again.');
        return;
      }

      router.push(`/mock/${payload.mockId}`);
    } catch {
      setError('Network error while generating mock. Please retry.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card form-shell">
      <h1>Mock Configuration</h1>
      <p className="muted">Set format, section focus, and question count. The generator adapts difficulty from your history.</p>
      <form onSubmit={onSubmit}>
        <div className="form-row">
          <div>
            <label htmlFor="type">Type</label>
            <select id="type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="full">Full Mock</option>
              <option value="section">Section Mock</option>
              <option value="topic">Topic Practice</option>
            </select>
          </div>
          <div>
            <label htmlFor="section">Section</label>
            <select id="section" value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
              <option value="quant">Quant</option>
              <option value="dilr">DILR</option>
              <option value="varc">VARC</option>
            </select>
          </div>
          <div>
            <label htmlFor="topic">Topic (optional)</label>
            <input id="topic" className="input" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>
          <div>
            <label htmlFor="count">Questions</label>
            <input id="count" className="input" type="number" min={4} max={66} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
        </div>
        {error ? <p style={{ color: 'var(--danger)' }}>{error}</p> : null}
        <button className="btn" disabled={loading}>{loading ? 'Generating...' : 'Generate'}</button>
      </form>
    </section>
  );
}
