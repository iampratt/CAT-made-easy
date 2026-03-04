import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="grid" style={{ gap: 20 }}>
      <div className="hero card">
        <h1>CAT Mock Paper Generator</h1>
        <p className="muted">
          Personalized mocks, section tests, topic practice, and PYQ search with adaptive difficulty from your performance.
        </p>
        <div className="hero-actions">
          <Link href="/mock" className="btn">Start Mock</Link>
          <Link href="/pyq" className="btn secondary">Search PYQs</Link>
        </div>
      </div>

      <div className="grid grid-3">
        <article className="card">
          <h3>Adaptive Difficulty</h3>
          <p className="muted">Easy/medium/hard distribution updates continuously from your attempts.</p>
        </article>
        <article className="card">
          <h3>Weak Topic Targeting</h3>
          <p className="muted">More weight to low-accuracy and high-time topics for deliberate practice.</p>
        </article>
        <article className="card">
          <h3>Premium Exam UX</h3>
          <p className="muted">Soft-edged split-panel interface with responsive navigation and persistent progress.</p>
        </article>
      </div>
    </section>
  );
}
