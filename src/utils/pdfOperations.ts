import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
  degrees,
  rgb,
} from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfFormFieldValue, PdfHighlight, PdfSource, VirtualPage } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type PdfJsDoc = pdfjsLib.PDFDocumentProxy;
export { pdfjsLib };

const docCache = new Map<string, Promise<PdfJsDoc>>();

export function getPdfJsDoc(source: PdfSource): Promise<PdfJsDoc> {
  let cached = docCache.get(source.id);
  if (!cached) {
    const copy = new Uint8Array(source.bytes);
    const loadingTask = pdfjsLib.getDocument({ data: copy });
    cached = loadingTask.promise;
    docCache.set(source.id, cached);
  }
  return cached;
}

export function clearPdfJsCache(sourceId: string): void {
  const cached = docCache.get(sourceId);
  if (cached) {
    cached.then((doc) => doc.destroy()).catch(() => {});
    docCache.delete(sourceId);
  }
}

export async function loadPdfPageCount(bytes: Uint8Array): Promise<number> {
  const copy = new Uint8Array(bytes);
  const task = pdfjsLib.getDocument({ data: copy });
  const doc = await task.promise;
  const count = doc.numPages;
  await doc.destroy();
  return count;
}

export interface OutlineEntry {
  title: string;
  pageIndex0: number | null;
  children: OutlineEntry[];
}

export async function readPdfOutline(source: PdfSource): Promise<OutlineEntry[]> {
  const doc = await getPdfJsDoc(source);
  const raw = await doc.getOutline();
  if (!raw) return [];

  const convert = async (items: typeof raw): Promise<OutlineEntry[]> => {
    const out: OutlineEntry[] = [];
    for (const item of items) {
      let pageIndex0: number | null = null;
      try {
        let dest = item.dest;
        if (typeof dest === 'string') {
          dest = await doc.getDestination(dest);
        }
        if (Array.isArray(dest) && dest[0]) {
          pageIndex0 = await doc.getPageIndex(dest[0]);
        }
      } catch {
        pageIndex0 = null;
      }
      out.push({
        title: item.title || 'Abschnitt',
        pageIndex0,
        children: item.items ? await convert(item.items) : [],
      });
    }
    return out;
  };

  return convert(raw);
}

export async function readPdfFormFields(source: PdfSource): Promise<PdfFormFieldValue[]> {
  try {
    const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields();
    const result: PdfFormFieldValue[] = [];

    for (const field of fields) {
      const name = field.getName();
      if (field instanceof PDFTextField) {
        result.push({ name, kind: 'text', value: field.getText() ?? '' });
      } else if (field instanceof PDFCheckBox) {
        result.push({ name, kind: 'checkbox', value: field.isChecked() });
      } else if (field instanceof PDFDropdown) {
        result.push({
          name,
          kind: 'dropdown',
          value: field.getSelected()[0] ?? '',
          options: field.getOptions(),
        });
      } else if (field instanceof PDFRadioGroup) {
        result.push({
          name,
          kind: 'radio',
          value: field.getSelected() ?? '',
          options: field.getOptions(),
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

function hexToRgbTuple(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 6 ? clean : 'fde047', 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export async function buildPdfFromPages(
  sources: PdfSource[],
  pages: VirtualPage[],
  highlights: PdfHighlight[] = [],
  formValues: Record<string, string | boolean> = {}
): Promise<Uint8Array> {
  const outDoc = await PDFDocument.create();
  const loadedSources = new Map<string, PDFDocument>();

  for (const src of sources) {
    const srcDoc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
    // Apply edited form field values if present
    if (Object.keys(formValues).length > 0) {
      try {
        const form = srcDoc.getForm();
        for (const field of form.getFields()) {
          const val = formValues[field.getName()];
          if (val === undefined) continue;
          if (field instanceof PDFTextField && typeof val === 'string') {
            field.setText(val);
          } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
            if (val) field.check();
            else field.uncheck();
          } else if (
            (field instanceof PDFDropdown || field instanceof PDFRadioGroup) &&
            typeof val === 'string' &&
            val
          ) {
            field.select(val);
          }
        }
      } catch {
        // Ignore if source has no form or read-only fields
      }
    }
    loadedSources.set(src.id, srcDoc);
  }

  for (const vPage of pages) {
    const srcDoc = loadedSources.get(vPage.sourceId);
    if (!srcDoc) continue;
    const [copied] = await outDoc.copyPages(srcDoc, [vPage.sourcePageIndex]);
    if (vPage.rotation !== 0) {
      const currentAngle = copied.getRotation().angle;
      copied.setRotation(degrees((currentAngle + vPage.rotation) % 360));
    }

    const pageHighlights = highlights.filter((h) => h.pageId === vPage.id);
    if (pageHighlights.length > 0) {
      const { width, height } = copied.getSize();
      for (const hl of pageHighlights) {
        const [r, g, b] = hexToRgbTuple(hl.color);
        copied.drawRectangle({
          x: hl.xNorm * width,
          y: height - (hl.yNorm + hl.hNorm) * height,
          width: hl.wNorm * width,
          height: hl.hNorm * height,
          color: rgb(r / 255, g / 255, b / 255),
          opacity: 0.35,
        });
      }
    }

    outDoc.addPage(copied);
  }

  return outDoc.save();
}

export async function extractPdfPageAsDataUrl(
  source: PdfSource,
  pageIndex0: number,
  scale = 2.0,
  extraRotation = 0
): Promise<string> {
  const doc = await getPdfJsDoc(source);
  const page = await doc.getPage(pageIndex0 + 1);
  const viewport = page.getViewport({
    scale,
    rotation: (page.rotate + extraRotation) % 360,
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

export const PART_COLORS = [
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#06b6d4', // Cyan
  '#ef4444', // Red
  '#84cc16', // Lime
];
