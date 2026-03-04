import { pipeline } from '@huggingface/transformers';

interface TensorLike {
  tolist: () => number[][];
}

type EmbedderFn = (texts: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<TensorLike>;

let embedder: EmbedderFn | null = null;

export async function getEmbedder() {
  if (!embedder) {
    const raw = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5');
    embedder = raw as unknown as EmbedderFn;
  }
  return embedder;
}

export async function embedBatch(texts: string[]) {
  const model = await getEmbedder();
  const prefixed = texts.map((t) => `search_document: ${t}`);
  const output = await model(prefixed, { pooling: 'mean', normalize: true });
  return output.tolist();
}
