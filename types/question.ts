export type Section = 'quant' | 'dilr' | 'varc';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Origin = 'corpus' | 'generated';

export interface QuestionProvenance {
  sourceFile?: string | null;
  sourcePage?: number | null;
  sourceBbox?: Record<string, unknown> | null;
  ingestionRunId?: string | null;
  stage?: 'deterministic' | 'external' | 'generated' | null;
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  section: Section;
  topic: string;
  subtype?: string;
  difficulty: Difficulty;
  source?: string;
  type: 'past_paper' | 'book' | 'generated';
  origin: Origin;
  questionNo?: number | null;
  examYear?: number | null;
  slot?: number | null;
  setId?: string | null;
  setText?: string | null;
  setImageUrl?: string | null;
  passageText?: string | null;
  groupId?: string | null;
  answerConfidence?: number | null;
  extractionConfidence?: number | null;
  isVerified?: boolean;
  sourcePage?: number | null;
  provenance?: QuestionProvenance | null;
  generationValidation?: {
    schemaValid: boolean;
    verifiedByModel: boolean;
    duplicateRisk: number;
  } | null;
}
