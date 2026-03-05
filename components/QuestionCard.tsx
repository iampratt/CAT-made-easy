import type { Question } from '@/types/question';
import { OptionButton } from '@/components/OptionButton';

export function QuestionCard({
  question,
  selected,
  onSelect,
}: {
  question: Question;
  selected?: string;
  onSelect: (answer: string) => void;
}) {
  const originLabel = question.origin === 'generated' ? 'Generated' : 'Corpus';
  const confidence = typeof question.answerConfidence === 'number'
    ? `${Math.round(question.answerConfidence * 100)}%`
    : '-';

  return (
    <article className="card">
      <h4>
        {question.topic} · {question.subtype ?? 'generic'} · {question.difficulty}
      </h4>
      <p className="muted" style={{ marginTop: 0 }}>
        Source: {originLabel} | Answer confidence: {confidence}
        {typeof question.sourcePage === 'number' ? ` | Page ${question.sourcePage}` : ''}
      </p>
      <p style={{ whiteSpace: 'pre-wrap' }}>{question.text}</p>
      <div className="grid" style={{ marginTop: 10 }}>
        {question.options.map((option) => (
          <OptionButton key={option} option={option} selected={selected === option[0]} onClick={() => onSelect(option[0])} />
        ))}
      </div>
    </article>
  );
}
