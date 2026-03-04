export interface ParsedQuestionChunk {
  text: string;
  options: string[];
}

const START_REGEX = /(?:^|\n)\s*(?:Q(?:uestion)?\s*)?(\d{1,3})[\).:-]\s+/gi;
const OPTION_START_REGEX = /^\s*([A-D])[\).:-]\s*/i;

function cleanLine(line: string) {
  return line
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
}

function splitByQuestionStart(text: string) {
  const matches = Array.from(text.matchAll(START_REGEX));
  if (matches.length === 0) return [] as string[];

  const blocks: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

function parseOptions(lines: string[]) {
  const map = new Map<string, string>();
  let activeLabel: 'A' | 'B' | 'C' | 'D' | null = null;

  for (const rawLine of lines) {
    const line = cleanLine(rawLine);
    if (!line) continue;

    if (/^(answer|solution|explanation)\b/i.test(line)) {
      break;
    }

    const match = line.match(OPTION_START_REGEX);
    if (match) {
      const label = match[1].toUpperCase() as 'A' | 'B' | 'C' | 'D';
      activeLabel = label;
      const body = line.replace(OPTION_START_REGEX, '').trim();
      map.set(label, body);
      continue;
    }

    if (activeLabel) {
      const existing = map.get(activeLabel) ?? '';
      map.set(activeLabel, cleanLine(`${existing} ${line}`));
    }
  }

  return ['A', 'B', 'C', 'D'].map((label) => {
    const body = map.get(label) ?? `${label} option not found`;
    return `${label}) ${body}`;
  });
}

export function splitQuantVarcQuestions(pageText: string): ParsedQuestionChunk[] {
  const blocks = splitByQuestionStart(pageText);

  return blocks
    .map((block) => {
      const lines = block.split('\n').map(cleanLine).filter(Boolean);
      if (lines.length === 0) return null;

      const firstOptionIndex = lines.findIndex((line) => OPTION_START_REGEX.test(line));
      const questionLines = firstOptionIndex >= 0 ? lines.slice(0, firstOptionIndex) : lines;
      const optionsLines = firstOptionIndex >= 0 ? lines.slice(firstOptionIndex) : [];

      const questionText = questionLines
        .join(' ')
        .replace(/^(?:Q(?:uestion)?\s*)?\d{1,3}[\).:-]\s*/i, '')
        .trim();

      if (!questionText || questionText.length < 20) return null;

      return {
        text: questionText,
        options: parseOptions(optionsLines),
      };
    })
    .filter((chunk): chunk is ParsedQuestionChunk => Boolean(chunk));
}
