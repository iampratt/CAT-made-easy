import Link from 'next/link';

export default function SectionPracticePage() {
  return (
    <section className="grid grid-3">
      {['quant', 'dilr', 'varc'].map((section) => (
        <article key={section} className="card">
          <h3 style={{ textTransform: 'uppercase', marginTop: 0 }}>{section}</h3>
          <p className="muted">Generate focused section tests with adaptive difficulty.</p>
          <Link href="/mock" className="btn">Start</Link>
        </article>
      ))}
    </section>
  );
}
