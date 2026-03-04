import type { Question } from '@/types/question';

export function scoreMock(questions: Question[], answers: Record<string, string>) {
  let total = 0;
  let correct = 0;
  let wrong = 0;

  for (const q of questions) {
    const answer = answers[q.id];
    if (!answer) continue;
    if (answer === q.correctAnswer) {
      total += 3;
      correct += 1;
    } else {
      total -= 1;
      wrong += 1;
    }
  }

  return {
    total,
    correct,
    wrong,
    attempted: correct + wrong,
    unattempted: questions.length - (correct + wrong),
    percentile: estimatePercentile(total),
  };
}

function estimatePercentile(score: number) {
  if (score >= 120) return 99.5;
  if (score >= 95) return 98;
  if (score >= 75) return 94;
  if (score >= 60) return 90;
  if (score >= 45) return 80;
  if (score >= 30) return 65;
  return 45;
}
