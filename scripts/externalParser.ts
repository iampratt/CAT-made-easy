import { readFile } from 'node:fs/promises';
import { env } from '@/lib/env';

export interface ExternalPageParseResult {
  pageNumber: number;
  text: string;
  provider: 'llamaparse';
}

async function uploadToLlamaParse(filePath: string) {
  if (!env.LLAMA_CLOUD_API_KEY) return null;

  const form = new FormData();
  const fileBytes = await readFile(filePath);
  const blob = new Blob([fileBytes], { type: 'application/pdf' });
  form.append('file', blob, filePath.split('/').pop() ?? 'input.pdf');
  form.append('result_type', 'text');
  form.append('language', 'en');
  form.append('parsing_mode', env.LLAMA_PARSE_MODE === 'premium' ? 'premium' : 'auto');

  const response = await fetch('https://api.cloud.llamaindex.ai/api/v1/parsing/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.LLAMA_CLOUD_API_KEY}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LlamaParse upload failed: ${response.status} ${body}`);
  }

  const payload = await response.json() as { id?: string; job_id?: string };
  return payload.id ?? payload.job_id ?? null;
}

async function getJobResult(jobId: string) {
  const response = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${jobId}/result/text`, {
    headers: { Authorization: `Bearer ${env.LLAMA_CLOUD_API_KEY}` },
  });

  if (response.status === 202) return null;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LlamaParse result fetch failed: ${response.status} ${body}`);
  }

  const text = await response.text();
  return text;
}

export async function parsePdfWithExternalService(filePath: string): Promise<Map<number, ExternalPageParseResult> | null> {
  if (!env.LLAMA_CLOUD_API_KEY) return null;

  const jobId = await uploadToLlamaParse(filePath);
  if (!jobId) return null;

  let output: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    output = await getJobResult(jobId);
    if (output !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  if (!output) return null;

  // LlamaParse text format may vary. We split by explicit page markers when present.
  const byPage = new Map<number, ExternalPageParseResult>();
  const chunks = output.split(/\n(?=\s*---\s*Page\s+\d+\s*---)/i);

  if (chunks.length <= 1) {
    return byPage;
  }

  for (const chunk of chunks) {
    const match = chunk.match(/Page\s+(\d+)/i);
    if (!match) continue;
    const pageNumber = Number(match[1]);
    if (!Number.isFinite(pageNumber)) continue;

    const text = chunk.replace(/^[\s\S]*?---\s*Page\s+\d+\s*---/i, '').trim();
    if (!text) continue;

    byPage.set(pageNumber, {
      pageNumber,
      text,
      provider: 'llamaparse',
    });
  }

  return byPage;
}
