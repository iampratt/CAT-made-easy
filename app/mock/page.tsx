'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MockConfigPage() {
  const [type, setType] = useState<'full' | 'section' | 'topic'>('full');
  const [section, setSection] = useState<'quant' | 'dilr' | 'varc'>('quant');
  const [topic, setTopic] = useState('time and work');
  const [count, setCount] = useState(22);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/generate/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section, topic, count }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.mockId) {
      router.push(`/mock/${data.mockId}`);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 560 }}>
      <h1 style={{ marginTop: 0 }}>Mock Configuration</h1>
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
        <button className="btn" disabled={loading}>{loading ? 'Generating...' : 'Generate'}</button>
      </form>
    </section>
  );
}
