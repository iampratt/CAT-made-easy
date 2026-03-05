import type { Difficulty, Question, Section } from './question';

export type MockType = 'full' | 'section' | 'topic';

export interface BlueprintSection {
  section: Section;
  count: number;
  enforceSets?: boolean;
}

export interface MockBlueprint {
  id: string;
  label: string;
  type: MockType;
  sections: BlueprintSection[];
  totalQuestions: number;
  durationSeconds: number;
}

export interface AllocationTask {
  section: Section;
  topic: string;
  subtype: string;
  difficulty: Difficulty;
  count: number;
}

export interface MockConfig {
  type: MockType;
  section?: Section;
  topic?: string;
  count: number;
  blueprintId?: string;
  difficultyMix?: Record<Difficulty, number>;
  blueprint?: MockBlueprint;
  allocationPlan?: AllocationTask[];
  generatedFillCount?: number;
  durationSeconds?: number;
  strictRealFirst?: boolean;
  allowGeneratedFill?: boolean;
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
  questionTimings?: Record<string, number>;
}
