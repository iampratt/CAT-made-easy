export function ScoreCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <article className="card">
      <p className="muted" style={{ margin: 0 }}>{title}</p>
      <h2 style={{ margin: '8px 0' }}>{value}</h2>
      {subtitle ? <p className="muted" style={{ marginBottom: 0 }}>{subtitle}</p> : null}
    </article>
  );
}
