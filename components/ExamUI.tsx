'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Question } from '@/types/question';
import { DilrPanel } from '@/components/DilrPanel';
import { VarcPanel } from '@/components/VarcPanel';
import { QuestionCard } from '@/components/QuestionCard';
import { QuestionGrid } from '@/components/QuestionGrid';
import { Timer } from '@/components/Timer';

export function ExamUI({ mockId, questions, initialSeconds }: { mockId: string; questions: Question[]; initialSeconds: number }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const router = useRouter();

  const question = questions[current];
  const answered = useMemo(
    () => new Set(questions.map((q, idx) => (answers[q.id] ? idx : -1)).filter((v) => v >= 0)),
    [answers, questions],
  );

  async function saveProgress() {
    await fetch('/api/mock/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mockId, answers }),
    });
  }

  async function submit() {
    await fetch('/api/mock/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mockId, answers, markedForReview: Array.from(marked).map((i) => questions[i]?.id).filter(Boolean) }),
    });
    router.push(`/mock/${mockId}/results`);
  }

  return (
    <section className="grid" style={{ gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Timer initialSeconds={initialSeconds} onExpire={submit} />
        <button className="btn secondary" onClick={saveProgress}>Save Progress</button>
        <button className="btn" onClick={submit}>Submit Mock</button>
      </div>

      <div className="exam-layout">
        <div>
          {question.section === 'dilr' ? (
            <DilrPanel setImageUrl={question.setImageUrl} setText={question.setText} />
          ) : (
            <VarcPanel passage={question.passageText} />
          )}
        </div>

        <div className="grid" style={{ gap: 10 }}>
          <QuestionCard
            question={question}
            selected={answers[question.id]}
            onSelect={(answer) => {
              setAnswers((prev) => ({ ...prev, [question.id]: answer }));
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setMarked((prev) => {
                  const next = new Set(prev);
                  if (next.has(current)) next.delete(current);
                  else next.add(current);
                  return next;
                });
              }}
            >
              {marked.has(current) ? 'Unmark Review' : 'Mark for Review'}
            </button>
            <button type="button" className="btn secondary" onClick={() => setCurrent((c) => Math.max(0, c - 1))}>Prev</button>
            <button type="button" className="btn secondary" onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}>Next</button>
          </div>
        </div>
      </div>

      <QuestionGrid count={questions.length} current={current} answered={answered} marked={marked} onSelect={setCurrent} />
    </section>
  );
}
