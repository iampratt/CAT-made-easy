'use client';

export function QuestionGrid({
  count,
  current,
  answered,
  marked,
  onSelect,
}: {
  count: number;
  current: number;
  answered: Set<number>;
  marked: Set<number>;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="card">
      <h4 style={{ marginTop: 0 }}>Question Navigator</h4>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 8 }}>
        {Array.from({ length: count }).map((_, i) => {
          const isAnswered = answered.has(i);
          const isMarked = marked.has(i);
          const bg = isAnswered ? '#22c55e' : '#fff';
          const border = i === current ? '2px solid #0f172a' : '1px solid var(--border)';
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              style={{
                border,
                borderRadius: 8,
                background: isMarked ? '#fb923c' : bg,
                color: isAnswered ? '#fff' : '#0f172a',
                fontWeight: 600,
                height: 34,
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
