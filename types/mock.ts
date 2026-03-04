import type { Difficulty, Question, Section } from './question';

export type MockType = 'full' | 'section' | 'topic';

export interface MockConfig {
  type: MockType;
  section?: Section;
  topic?: string;
  count: number;
  difficultyMix?: Record<Difficulty, number>;
}

export interface MockRecord {
  id: string;
  userId: string;
  type: MockType;
  config: MockConfig;
  questions: Question[];
  createdAt: string;
}

export interface MockSubmission {
  mockId: string;
  answers: Record<string, string>;
  markedForReview: string[];
  totalSeconds: number;
}
