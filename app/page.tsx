import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="grid" style={{ gap: 20 }}>
      <div className="card">
        <h1 style={{ marginTop: 0 }}>CAT Mock Paper Generator</h1>
        <p className="muted">
          Personalized full mocks, section tests, topic practice, and PYQ full-text search backed by Supabase and Groq.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/mock" className="btn">Start Mock</Link>
          <Link href="/pyq" className="btn secondary">Search PYQs</Link>
        </div>
      </div>
      <div className="grid grid-3">
        <article className="card">
          <h3>Adaptive Difficulty</h3>
          <p className="muted">Dynamic easy/medium/hard distribution from your last three mocks.</p>
        </article>
        <article className="card">
          <h3>Weak Topic Targeting</h3>
          <p className="muted">Topic weights based on accuracy, speed, and consistency.</p>
        </article>
        <article className="card">
          <h3>Deploy Ready</h3>
          <p className="muted">Next.js 16 + Supabase + Groq setup with SQL migrations and script scaffolds.</p>
        </article>
      </div>
    </section>
  );
}
