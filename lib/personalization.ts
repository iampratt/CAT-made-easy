import { clamp } from '@/lib/utils';

export function weakScore(params: {
  accuracy: number;
  avgTimeSeconds: number;
  attempts: number;
  lastThreeDeclining: boolean;
  daysSinceLastAttempt?: number;
}) {
  const recencyPenalty = typeof params.daysSinceLastAttempt === 'number'
    ? clamp(params.daysSinceLastAttempt / 30, 0, 0.15)
    : 0;

  const raw =
    (1 - params.accuracy) * 0.55 +
    (params.avgTimeSeconds > 120 ? 0.15 : 0) +
    (params.attempts < 5 ? 0.2 : 0) +
    (params.lastThreeDeclining ? 0.15 : 0) +
    recencyPenalty;

  return clamp(raw, 0, 1);
}

export function difficultyMixFromAccuracy(accuracy: number, hasHistory = true) {
  if (!hasHistory) return { easy: 0.3, medium: 0.5, hard: 0.2 };
  if (accuracy < 0.4) return { easy: 0.5, medium: 0.4, hard: 0.1 };
  if (accuracy < 0.6) return { easy: 0.3, medium: 0.5, hard: 0.2 };
  if (accuracy < 0.75) return { easy: 0.2, medium: 0.5, hard: 0.3 };
  return { easy: 0.1, medium: 0.4, hard: 0.5 };
}
