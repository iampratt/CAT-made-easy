'use client';

import { FormEvent, useState } from 'react';

interface Result {
  id: string;
  text: string;
  topic: string;
  difficulty: string;
  source: string;
}

export function PYQSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = await res.json();
    setResults(body.results ?? []);
    setLoading(false);
  }

  return (
    <section className="grid" style={{ gap: 14 }}>
      <form onSubmit={onSubmit} className="card">
        <label htmlFor="query">Search past-year questions</label>
        <div className="row-actions">
          <input id="query" className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. time and work" />
          <button className="btn" disabled={loading}>{loading ? 'Searching...' : 'Search'}</button>
        </div>
      </form>

      <div className="grid">
        {results.map((r) => (
          <article key={r.id} className="card">
            <p style={{ whiteSpace: 'pre-wrap' }}>{r.text}</p>
            <p className="muted">{r.topic} · {r.difficulty} · {r.source}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
