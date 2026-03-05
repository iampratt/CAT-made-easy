import { mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

export interface ExtractedImage {
  page: number;
  imagePath: string;
  width: number;
  height: number;
}

interface RawImageLike {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

function toRgba(raw: RawImageLike): Uint8Array {
  const { data, width, height } = raw;
  const pixelCount = width * height;

  if (data.length === pixelCount * 4) {
    return Uint8Array.from(data);
  }

  if (data.length === pixelCount * 3) {
    const out = new Uint8Array(pixelCount * 4);
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      out[j] = data[i];
      out[j + 1] = data[i + 1];
      out[j + 2] = data[i + 2];
      out[j + 3] = 255;
    }
    return out;
  }

  if (data.length === pixelCount) {
    const out = new Uint8Array(pixelCount * 4);
    for (let i = 0, j = 0; i < data.length; i += 1, j += 4) {
      const v = data[i];
      out[j] = v;
      out[j + 1] = v;
      out[j + 2] = v;
      out[j + 3] = 255;
    }
    return out;
  }

  throw new Error(`Unsupported image buffer format (length=${data.length}, width=${width}, height=${height}).`);
}

async function writePng(filePath: string, width: number, height: number, rgba: Uint8Array) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    png.pack()
      .on('data', (chunk: Buffer) => chunks.push(chunk))
      .on('end', resolve)
      .on('error', reject);
  });

  await writeFile(filePath, Buffer.concat(chunks));
}

async function getImageFromObj(page: { objs: { get: (name: string, cb: (obj: unknown) => void) => void } }, name: string) {
  return new Promise<RawImageLike | null>((resolve) => {
    try {
      page.objs.get(name, (obj: unknown) => {
        const maybe = obj as Partial<RawImageLike>;
        if (maybe?.data && maybe?.width && maybe?.height) {
          resolve({ data: maybe.data as Uint8Array, width: maybe.width, height: maybe.height });
        } else {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

export async function extractImagesFromPdf(filePath: string): Promise<ExtractedImage[]> {
  const require = createRequire(import.meta.url);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const OPS = (pdfjs as unknown as { OPS?: Record<string, number> }).OPS;
  const data = await readFile(filePath);
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const standardFontDataUrl = path.join(pdfRoot, 'standard_fonts/');
  const wasmUrl = path.join(pdfRoot, 'wasm/');

  if (!OPS) return [];

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl,
    wasmUrl,
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;
  const outputDir = await mkdtemp(path.join(tmpdir(), 'cat-dilr-images-'));

  const images: ExtractedImage[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const operatorList = await page.getOperatorList();
    const fnArray = operatorList.fnArray as number[];
    const argsArray = operatorList.argsArray as unknown[];

    let indexOnPage = 0;
    for (let i = 0; i < fnArray.length; i += 1) {
      const fn = fnArray[i];

      if (fn !== OPS.paintImageXObject && fn !== OPS.paintInlineImageXObject && fn !== OPS.paintJpegXObject) {
        continue;
      }

      let rawImage: RawImageLike | null = null;
      const args = argsArray[i] as unknown[] | undefined;

      if (fn === OPS.paintInlineImageXObject && args?.[0]) {
        const inline = args[0] as Partial<RawImageLike>;
        if (inline.data && inline.width && inline.height) {
          rawImage = {
            data: inline.data as Uint8Array,
            width: inline.width,
            height: inline.height,
          };
        }
      } else if (typeof args?.[0] === 'string') {
        rawImage = await getImageFromObj(page as unknown as { objs: { get: (name: string, cb: (obj: unknown) => void) => void } }, args[0]);
      }

      if (!rawImage) continue;

      try {
        const rgba = toRgba(rawImage);
        const imagePath = path.join(outputDir, `page-${pageNumber}-${indexOnPage}.png`);
        await writePng(imagePath, rawImage.width, rawImage.height, rgba);
        images.push({
          page: pageNumber,
          imagePath,
          width: rawImage.width,
          height: rawImage.height,
        });
        indexOnPage += 1;
      } catch {
        // skip unsupported/invalid image payloads
      }
    }
  }

  return images;
}
