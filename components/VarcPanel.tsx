export function VarcPanel({ passage }: { passage?: string | null }) {
  if (!passage) return null;
  return (
    <article className="card" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
      <h4 style={{ marginTop: 0 }}>Passage</h4>
      <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{passage}</p>
    </article>
  );
}
