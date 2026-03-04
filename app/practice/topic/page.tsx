import Link from 'next/link';

export default function TopicPracticePage() {
  const topics = ['time and work', 'blood relations', 'rc inference', 'para jumbles'];
  return (
    <section className="grid grid-3">
      {topics.map((topic) => (
        <article key={topic} className="card">
          <h3 style={{ marginTop: 0, textTransform: 'capitalize' }}>{topic}</h3>
          <p className="muted">Target this weak area with topic-wise generated questions.</p>
          <Link href="/mock" className="btn">Practice</Link>
        </article>
      ))}
    </section>
  );
}
