'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Question } from '@/types/question';
import { DilrPanel } from '@/components/DilrPanel';
import { VarcPanel } from '@/components/VarcPanel';
import { QuestionCard } from '@/components/QuestionCard';
import { QuestionGrid } from '@/components/QuestionGrid';
import { Timer } from '@/components/Timer';

interface QuestionEvent {
  questionId: string;
  eventType: 'view' | 'answer' | 'mark' | 'unmark' | 'navigate';
  timeSpentSeconds?: number;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

export function ExamUI({ mockId, questions, initialSeconds }: { mockId: string; questions: Question[]; initialSeconds: number }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const router = useRouter();

  const questionTimingsRef = useRef<Record<string, number>>({});
  const questionEnteredAtRef = useRef<number>(0);
  const eventBufferRef = useRef<QuestionEvent[]>([]);
  const submittingRef = useRef(false);

  const question = questions[current];
  const answered = useMemo(
    () => new Set(questions.map((q, idx) => (answers[q.id] ? idx : -1)).filter((v) => v >= 0)),
    [answers, questions],
  );

  function pushEvent(event: QuestionEvent) {
    eventBufferRef.current.push({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }

  function flushCurrentQuestionTiming() {
    const now = Date.now();
    const elapsed = Math.max(0, Math.round((now - questionEnteredAtRef.current) / 1000));
    if (question?.id) {
      questionTimingsRef.current[question.id] = (questionTimingsRef.current[question.id] ?? 0) + elapsed;
      pushEvent({
        questionId: question.id,
        eventType: 'navigate',
        timeSpentSeconds: elapsed,
        payload: { questionIndex: current },
      });
    }
    questionEnteredAtRef.current = now;
  }

  function navigateTo(index: number) {
    flushCurrentQuestionTiming();
    setCurrent(Math.max(0, Math.min(questions.length - 1, index)));
  }

  async function saveProgress() {
    const pendingEvents = [...eventBufferRef.current];
    eventBufferRef.current = [];

    await fetch('/api/mock/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mockId,
        answers,
        questionTimings: questionTimingsRef.current,
        events: pendingEvents,
      }),
    });
  }

  async function submit() {
    if (submittingRef.current) return;
    submittingRef.current = true;

    flushCurrentQuestionTiming();
    const pendingEvents = [...eventBufferRef.current];
    eventBufferRef.current = [];

    await fetch('/api/mock/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mockId,
        answers,
        markedForReview: Array.from(marked).map((i) => questions[i]?.id).filter(Boolean),
        questionTimings: questionTimingsRef.current,
        events: pendingEvents,
      }),
    });

    router.push(`/mock/${mockId}/results`);
  }

  useEffect(() => {
    const id = setInterval(() => {
      void saveProgress();
    }, 60_000);
    return () => clearInterval(id);
  }, [answers, mockId]);

  useEffect(() => {
    questionEnteredAtRef.current = Date.now();
    if (question?.id) {
      pushEvent({
        questionId: question.id,
        eventType: 'view',
        payload: { questionIndex: current },
      });
    }
  }, [question?.id, current]);

  return (
    <section className="grid" style={{ gap: 12 }}>
      <div className="exam-toolbar">
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
              pushEvent({
                questionId: question.id,
                eventType: 'answer',
                payload: { answer },
              });
            }}
          />
          <div className="question-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                setMarked((prev) => {
                  const next = new Set(prev);
                  const isMarked = next.has(current);
                  if (isMarked) {
                    next.delete(current);
                    pushEvent({ questionId: question.id, eventType: 'unmark' });
                  } else {
                    next.add(current);
                    pushEvent({ questionId: question.id, eventType: 'mark' });
                  }
                  return next;
                });
              }}
            >
              {marked.has(current) ? 'Unmark Review' : 'Mark for Review'}
            </button>
            <button type="button" className="btn secondary" onClick={() => navigateTo(current - 1)}>Prev</button>
            <button type="button" className="btn secondary" onClick={() => navigateTo(current + 1)}>Next</button>
          </div>
        </div>
      </div>

      <QuestionGrid count={questions.length} current={current} answered={answered} marked={marked} onSelect={navigateTo} />
    </section>
  );
}
