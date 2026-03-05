export interface UserProfile {
  id: string;
  name: string | null;
  targetPercentile: number;
  createdAt: string;
}

export interface UserTopicPerformance {
  userId: string;
  section: 'quant' | 'dilr' | 'varc';
  topic: string;
  subtype: string;
  attempts: number;
  correct: number;
  accuracy: number;
  avgTimeSeconds: number;
  weakScore: number;
  lastAttemptedAt?: string;
}
