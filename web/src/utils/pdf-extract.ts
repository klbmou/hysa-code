import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;

export const MAX_PDF_TEXT_LENGTH = 30000;

export interface PdfExtractResult {
  text: string;
  pageCount: number;
  truncated: boolean;
  hasText: boolean;
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument(arrayBuffer).promise;
  const pageCount = pdf.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    pages.push(pageText);
  }

  const fullText = pages.join('\n\n');
  const hasText = fullText.trim().length > 0;
  let text = fullText;
  let truncated = false;

  if (text.length > MAX_PDF_TEXT_LENGTH) {
    text = text.slice(0, MAX_PDF_TEXT_LENGTH);
    truncated = true;
  }

  return { text, pageCount, truncated, hasText };
}
