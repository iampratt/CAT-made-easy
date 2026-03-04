export type Section = 'quant' | 'dilr' | 'varc';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  section: Section;
  topic: string;
  difficulty: Difficulty;
  source?: string;
  type: 'past_paper' | 'generated';
  setId?: string | null;
  setText?: string | null;
  setImageUrl?: string | null;
  passageText?: string | null;
}
