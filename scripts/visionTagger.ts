import { readFile } from 'node:fs/promises';
import { env } from '@/lib/env';

export type DilrImageType = 'table' | 'bar_chart' | 'line_chart' | 'pie_chart' | 'venn' | 'network' | 'unknown';

export interface VisionTagResult {
  setText: string;
  imageType: DilrImageType;
  unclearCount: number;
  shouldSkip: boolean;
}

const VISION_PROMPT = `You are processing a CAT exam DILR image (Data Interpretation and Logical Reasoning).
Convert this image to a complete structured text description preserving ALL data values exactly.
Rules:
- Never approximate — use exact numbers from the image
- Tables → reproduce as a markdown table with all rows and columns
- Bar/line charts → list every data point as "Label: value"
- Pie charts → list every segment as "Segment: X%"
- Venn diagrams → list all regions and their values explicitly
- Network/route diagrams → list all nodes and connections with values
- If any value is unclear or unreadable, write UNCLEAR for that value only
Return ONLY structured data. No commentary.`;

const OCR_PROMPT = `Extract all visible text from this CAT exam page exactly.
Rules:
- Preserve question numbering and option labels (A/B/C/D) exactly.
- Preserve line breaks where possible.
- Do not summarize.
- If text is unclear, output UNCLEAR only for that fragment.
Return ONLY plain text.`;

function inferImageType(text: string): DilrImageType {
  const lower = text.toLowerCase();
  if (/\|.+\|/.test(text) || lower.includes('row') || lower.includes('column')) return 'table';
  if (lower.includes('bar')) return 'bar_chart';
  if (lower.includes('line')) return 'line_chart';
  if (lower.includes('pie')) return 'pie_chart';
  if (lower.includes('venn')) return 'venn';
  if (lower.includes('node') || lower.includes('route') || lower.includes('network')) return 'network';
  return 'unknown';
}

export async function describeDilrImage(imagePath: string): Promise<VisionTagResult> {
  if (!env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY for vision tagging.');
  }

  const model = env.GROQ_VISION_MODEL ?? 'llama-4-scout-17b-16e-instruct';
  const bytes = await readFile(imagePath);
  const base64 = bytes.toString('base64');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq vision request failed: ${response.status} ${body}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  const setText = typeof content === 'string'
    ? content.trim()
    : Array.isArray(content)
      ? content.map((item) => item.text ?? '').join('\n').trim()
      : '';

  const unclearCount = (setText.match(/UNCLEAR/gi) ?? []).length;
  return {
    setText,
    imageType: inferImageType(setText),
    unclearCount,
    shouldSkip: unclearCount > 2,
  };
}

export async function transcribePageImage(imagePath: string): Promise<string> {
  if (!env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY for vision OCR.');
  }

  const model = env.GROQ_VISION_MODEL ?? 'llama-4-scout-17b-16e-instruct';
  const bytes = await readFile(imagePath);
  const base64 = bytes.toString('base64');

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq OCR request failed: ${response.status} ${body}`);
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === 'string'
    ? content.trim()
    : Array.isArray(content)
      ? content.map((item) => item.text ?? '').join('\n').trim()
      : '';
}
