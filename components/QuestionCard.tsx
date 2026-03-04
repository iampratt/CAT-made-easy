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
  return (
    <article className="card">
      <h4>{question.topic} · {question.difficulty}</h4>
      <p style={{ whiteSpace: 'pre-wrap' }}>{question.text}</p>
      <div className="grid" style={{ marginTop: 10 }}>
        {question.options.map((option) => (
          <OptionButton key={option} option={option} selected={selected === option[0]} onClick={() => onSelect(option[0])} />
        ))}
      </div>
    </article>
  );
}
