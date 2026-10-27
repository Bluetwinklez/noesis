import type { DocNode } from '../../core/doc';
import { repos } from '../../app/state';
import { blobStore, saveFile } from '../../lib/platform';
import type { ImageLoader } from '../../editor/docx';

/** Reads an `attachment:` image for embedding in an exported document. */
const loadAttachmentImage: ImageLoader = async (src) => {
    if (!src.startsWith('attachment:')) return null;
    const att = await repos().attachments.get(src.slice('attachment:'.length));
    if (!att) return null;
    const type = att.mime.includes('png') ? 'png' : /jpe?g/.test(att.mime) ? 'jpg' : att.mime.includes('gif') ? 'gif' : att.mime.includes('bmp') ? 'bmp' : null;
    if (!type) return null;
    const data = await blobStore.get(att.storage_key);
    const bitmap = await createImageBitmap(new Blob([data as BlobPart], { type: att.mime }));
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { bytes: data, type, ...dims };
};

/** Exports a page as .docx; `attachment:` images are embedded at their natural size. */
export async function exportDocx(title: string, doc: DocNode) {
  const { docToDocx } = await import('../../editor/docx');
  const bytes = await docToDocx(title, doc, loadAttachmentImage);
  await saveFile(`${title || 'Untitled'}.docx`, bytes, [{ name: 'Word document', extensions: ['docx'] }]);
}

/** Exports a page straight to a .pdf file (no print dialog). */
export async function exportPdf(title: string, doc: DocNode) {
  const { docToPdf } = await import('../../editor/pdf');
  const bytes = await docToPdf(title, doc, loadAttachmentImage);
  await saveFile(`${title || 'Untitled'}.pdf`, bytes, [{ name: 'PDF', extensions: ['pdf'] }]);
}
