export interface ParsedQuestionChunk {
  text: string;
  options: string[];
  questionNo?: number | null;
  subtype?: string;
  extractionConfidence?: number;
  rawBlock?: string;
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
  const byAlt = Array.from(text.matchAll(ALT_START_REGEX));
  ALT_START_REGEX.lastIndex = 0;

  if (byAlt.length > 0) {
    const blocks: string[] = [];
    for (let i = 0; i < byAlt.length; i += 1) {
      const start = byAlt[i].index ?? 0;
      const end = i + 1 < byAlt.length ? (byAlt[i + 1].index ?? text.length) : text.length;
      const chunk = text.slice(start, end).trim();
      if (chunk) blocks.push(chunk);
    }
    return blocks;
  }

  const byBase = Array.from(text.matchAll(START_REGEX));
  START_REGEX.lastIndex = 0;

  if (byBase.length === 0) return [] as string[];

  const blocks: string[] = [];
  for (let i = 0; i < byBase.length; i += 1) {
    const start = byBase[i].index ?? 0;
    const end = i + 1 < byBase.length ? (byBase[i + 1].index ?? text.length) : text.length;
    const chunk = text.slice(start, end).trim();
    if (chunk) blocks.push(chunk);
  }

  return blocks;
}

function firstQuestionStart(pageText: string) {
  const alt = pageText.match(ALT_START_REGEX);
  ALT_START_REGEX.lastIndex = 0;
  if (alt?.index !== undefined) return alt.index;

  const base = pageText.match(START_REGEX);
  START_REGEX.lastIndex = 0;
  if (base?.index !== undefined) return base.index;

  return null;
}

function extractQuestionNo(value: string): number | null {
  const match = value.match(/^(?:Q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\).:-]\s*/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripQuestionPrefix(value: string) {
  return value
    .replace(/^(?:Q(?:uestion)?\.?\s*)?\d{1,3}\s*[\).:-]\s*/i, '')
    .trim();
}

function parseInlineOptions(block: string) {
  const inlineMatches = Array.from(block.matchAll(INLINE_OPTION_REGEX));
  INLINE_OPTION_REGEX.lastIndex = 0;

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
  if (/passage|author|inference|paragraph|argument|implied|sentence\s+order|para\s*jumbles?/.test(text) || leadContext.length > 280) {
    return 'varc';
  }
  if (/table|chart|distribution|arrangement|seating|route|venn|graph|network|tournament/.test(text)) {
    return 'dilr';
  }
  return 'quant';
}

function inferSubtype(section: 'quant' | 'dilr' | 'varc', text: string) {
  const lower = text.toLowerCase();

  if (section === 'quant') {
    if (/profit|loss|discount|simple interest|compound interest/.test(lower)) return 'arithmetic_commercial_math';
    if (/time and work|pipes|cistern/.test(lower)) return 'arithmetic_time_work';
    if (/mixture|alligation/.test(lower)) return 'arithmetic_mixtures';
    if (/ratio|proportion|partnership/.test(lower)) return 'arithmetic_ratio';
    if (/geometry|triangle|circle|polygon|angle/.test(lower)) return 'geometry';
    if (/algebra|equation|polynomial|quadratic|roots/.test(lower)) return 'algebra';
    if (/number\s*system|remainder|divisibility|hcf|lcm/.test(lower)) return 'number_systems';
    if (/permutation|combination|probability/.test(lower)) return 'modern_math';
    return 'quant_mixed';
  }

  if (section === 'dilr') {
    if (/arrangement|seating|circular|linear/.test(lower)) return 'lr_arrangement';
    if (/table|chart|graph|bar|line|pie/.test(lower)) return 'di_charts_tables';
    if (/routes?|network|distance|assignment|matching/.test(lower)) return 'lr_network_assignment';
    if (/venn|set/.test(lower)) return 'di_venn_sets';
    return 'dilr_mixed_set';
  }

  if (/passage|author|inference|tone|main idea/.test(lower)) return 'rc';
  if (/para\s*jumbles?|sentence\s*order/.test(lower)) return 'va_parajumbles';
  if (/odd sentence|out of context/.test(lower)) return 'va_odd_sentence';
  if (/summary/.test(lower)) return 'va_summary';
  return 'varc_mixed';
}

function computeExtractionConfidence(args: { questionText: string; options: string[]; questionNo: number | null; leadContext: string }) {
  let score = 0.4;

  if (args.questionText.length >= 35) score += 0.2;
  if (args.questionNo !== null) score += 0.1;

  const completeOptions = args.options.filter((opt) => !/not found/i.test(opt)).length;
  score += (completeOptions / 4) * 0.25;

  if (args.leadContext.length > 40) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

export function splitQuantVarcQuestions(pageText: string): ParsedQuestionChunk[] {
  const blocks = splitByQuestionStart(pageText);
  const leadContext = extractLeadContext(pageText);
  const out: ParsedQuestionChunk[] = [];

  for (const block of blocks) {
    const normalizedBlock = cleanLine(block);
    const questionNo = extractQuestionNo(normalizedBlock);

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
    const subtype = inferSubtype(sectionHint, questionText);
    const extractionConfidence = computeExtractionConfidence({ questionText, options, questionNo, leadContext });

    out.push({
      text: questionText,
      options,
      questionNo,
      subtype,
      extractionConfidence,
      rawBlock: block,
      sectionHint,
      passageText: sectionHint === 'varc' && leadContext.length > 120 ? leadContext : null,
      setText: sectionHint === 'dilr' && leadContext.length > 80 ? leadContext : null,
    });
  }

  return out;
}
