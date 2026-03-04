export function splitQuantVarcQuestions(pageText: string) {
  const chunks = pageText
    .split(/\n(?=\d+\.|Q\.?\d+)/g)
    .map((text) => text.trim())
    .filter(Boolean);

  return chunks.map((text) => ({
    text,
    options: ['A) Option A', 'B) Option B', 'C) Option C', 'D) Option D'],
  }));
}
