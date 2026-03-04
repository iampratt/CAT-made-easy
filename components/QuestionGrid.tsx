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
      <h4>Question Navigator</h4>
      <div className="qnav-grid">
        {Array.from({ length: count }).map((_, i) => {
          const isAnswered = answered.has(i);
          const isMarked = marked.has(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSelect(i)}
              className={`qnav-btn ${i === current ? 'current' : ''} ${isAnswered ? 'answered' : ''} ${isMarked ? 'marked' : ''}`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}
