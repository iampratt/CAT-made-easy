export interface ParsedQuestionChunk {
  text: string;
  options: string[];
  passageText?: string | null;
  setText?: string | null;
  sectionHint?: 'quant' | 'dilr' | 'varc';
}

const START_REGEX = /(?:^|\n)\s*(?:Q(?:uestion)?\s*)?(\d{1,3})[\).:-]\s+/gi;
const ALT_START_REGEX = /Q(?:uestion)?\.?\s*(\d{1,3})\s*[\).:-]\s*/gi;
const INLINE_OPTION_REGEX = /(?:^|\s)(?:([A-D])(?:[\).:-]\s*|\s+)|\[(\d)\]\s*)/gi;

function normalizeOptionLabel(raw: string) {
  const value = raw.trim().toUpperCase();
  if (['A', 'B', 'C', 'D'].includes(value)) return value as 'A' | 'B' | 'C' | 'D';

  if (['1', '2', '3', '4'].includes(value)) {
    return (['A', 'B', 'C', 'D'][Number(value) - 1]) as 'A' | 'B' | 'C' | 'D';
  }

  return null;
}

function parseOptionStart(line: string) {
  const alpha = line.match(/^\s*([A-D])(?:[\).:-]\s*|\s+)/i);
  if (alpha) {
    const label = normalizeOptionLabel(alpha[1]);
    if (!label) return null;
    return {
      label,
      body: line.replace(/^\s*([A-D])(?:[\).:-]\s*|\s+)/i, '').trim(),
    };
  }

  const numericBracket = line.match(/^\s*\[([1-4])\]\s*/);
  if (numericBracket) {
    const label = normalizeOptionLabel(numericBracket[1]);
    if (!label) return null;
    return {
      label,
      body: line.replace(/^\s*\[([1-4])\]\s*/i, '').trim(),
    };
  }

  const numericPlain = line.match(/^\s*([1-4])(?:[\).:-]\s*|\s+)/);
  if (numericPlain) {
    const label = normalizeOptionLabel(numericPlain[1]);
    if (!label) return null;
    return {
      label,
      body: line.replace(/^\s*([1-4])(?:[\).:-]\s*|\s+)/, '').trim(),
    };
  }

  return null;
}

function cleanLine(line: string) {
  return line
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
}

function splitByQuestionStart(text: string) {
  const matches = Array.from(text.matchAll(ALT_START_REGEX));
  if (matches.length > 0) {
    const blocks: string[] = [];
    for (let i = 0; i < matches.length; i += 1) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
      const chunk = text.slice(start, end).trim();
      if (chunk) blocks.push(chunk);
    }
    return blocks;
  }

  const fallbackMatches = Array.from(text.matchAll(START_REGEX));
  if (fallbackMatches.length === 0) return [] as string[];

  const blocks: string[] = [];
  for (let i = 0; i < fallbackMatches.length; i += 1) {
    const start = fallbackMatches[i].index ?? 0;
    const end = i + 1 < fallbackMatches.length ? (fallbackMatches[i + 1].index ?? text.length) : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) blocks.push(chunk);
  }
  return blocks;
}

function firstQuestionStart(pageText: string) {
  const alt = ALT_START_REGEX.exec(pageText);
  ALT_START_REGEX.lastIndex = 0;
  if (alt && typeof alt.index === 'number') return alt.index;

  const base = START_REGEX.exec(pageText);
  START_REGEX.lastIndex = 0;
  if (base && typeof base.index === 'number') return base.index;

  return null;
}

function stripQuestionPrefix(value: string) {
  return value
    .replace(/^(?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[\).:-]\s*/i, '')
    .trim();
}

function parseInlineOptions(block: string) {
  const inlineMatches = Array.from(block.matchAll(INLINE_OPTION_REGEX));
  if (inlineMatches.length === 0) return null;
  if (inlineMatches.length < 4) return null;

  const firstStart = inlineMatches[0].index ?? 0;
  const questionText = stripQuestionPrefix(cleanLine(block.slice(0, firstStart)));
  if (!questionText) return null;

  const options: string[] = [];
  for (let i = 0; i < inlineMatches.length; i += 1) {
    const alphaLabel = inlineMatches[i][1];
    const numericLabel = inlineMatches[i][2];
    const label = normalizeOptionLabel(alphaLabel || numericLabel || '');
    if (!label) continue;

    const bodyStart = (inlineMatches[i].index ?? 0) + inlineMatches[i][0].length;
    const bodyEnd = i + 1 < inlineMatches.length ? (inlineMatches[i + 1].index ?? block.length) : block.length;
    const body = cleanLine(block.slice(bodyStart, bodyEnd));
    options.push(`${label}) ${body}`);
    if (options.length === 4) break;
  }
  return options.length === 4 ? { questionText, options } : null;
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

    const optionStart = parseOptionStart(line);
    if (optionStart) {
      activeLabel = optionStart.label;
      map.set(optionStart.label, optionStart.body);
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

function extractLeadContext(pageText: string) {
  const firstIndex = firstQuestionStart(pageText);
  if (typeof firstIndex !== 'number') return '';
  return cleanLine(pageText.slice(0, firstIndex));
}

function inferSectionHint(questionText: string, leadContext: string): 'quant' | 'dilr' | 'varc' {
  const text = `${leadContext} ${questionText}`.toLowerCase();
  if (/passage|author|inference|paragraph|argument|implied/.test(text) || leadContext.length > 280) {
    return 'varc';
  }
  if (/table|chart|distribution|arrangement|seating|route|venn/.test(text)) {
    return 'dilr';
  }
  return 'quant';
}

export function splitQuantVarcQuestions(pageText: string): ParsedQuestionChunk[] {
  const blocks = splitByQuestionStart(pageText);
  const leadContext = extractLeadContext(pageText);
  const out: ParsedQuestionChunk[] = [];

  for (const block of blocks) {
      const normalizedBlock = cleanLine(block);
      let questionText = '';
      let options: string[] = [];

      const inline = parseInlineOptions(normalizedBlock);
      if (inline) {
        questionText = inline.questionText;
        options = inline.options;
      }

      if (!questionText || options.length !== 4) {
        const lines = block.split('\n').map(cleanLine).filter(Boolean);
        if (lines.length === 0) continue;

        const firstOptionIndex = lines.findIndex((line) => parseOptionStart(line) !== null);
        const questionLines = firstOptionIndex >= 0 ? lines.slice(0, firstOptionIndex) : lines;
        const optionsLines = firstOptionIndex >= 0 ? lines.slice(firstOptionIndex) : [];

        questionText = questionLines
          .join(' ')
          .replace(/^(?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[\).:-]\s*/i, '')
          .trim();

        options = parseOptions(optionsLines);
      }

      if (!questionText || questionText.length < 20) continue;

      const sectionHint = inferSectionHint(questionText, leadContext);
      out.push({
        text: questionText,
        options,
        sectionHint,
        passageText: sectionHint === 'varc' && leadContext.length > 120 ? leadContext : null,
        setText: sectionHint === 'dilr' && leadContext.length > 80 ? leadContext : null,
      });
  }

  return out;
}
