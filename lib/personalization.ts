import { clamp } from '@/lib/utils';

export function weakScore(params: {
  accuracy: number;
  avgTimeSeconds: number;
  attempts: number;
  lastThreeDeclining: boolean;
}) {
  const raw =
    (1 - params.accuracy) * 0.6 +
    (params.avgTimeSeconds > 120 ? 0.2 : 0) +
    (params.attempts < 5 ? 0.3 : 0) +
    (params.lastThreeDeclining ? 0.2 : 0);
  return clamp(raw, 0, 1);
}

export function difficultyMixFromAccuracy(accuracy: number) {
  if (accuracy < 0.4) return { easy: 0.5, medium: 0.4, hard: 0.1 };
  if (accuracy < 0.6) return { easy: 0.3, medium: 0.5, hard: 0.2 };
  if (accuracy < 0.75) return { easy: 0.2, medium: 0.5, hard: 0.3 };
  return { easy: 0.1, medium: 0.4, hard: 0.5 };
}
