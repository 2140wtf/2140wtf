/**
 * Shared client-side upload validation.
 *
 * Every user file upload flows through `useUploadFile()` (the single choke
 * point for Blossom uploads), and a few dialogs additionally read the selected
 * file into a data-URL preview before uploading. These bounds run before any
 * read or network I/O so an accidental multi-gigabyte selection fails fast
 * instead of ballooning tab memory — a base64 data URL costs ~4/3× the file
 * size and is held in React state — or streaming the whole body to the blob
 * server before anything checks it.
 *
 * Bounds here are a client-side backstop, not a substitute for server-side
 * limits: Blossom servers still enforce their own quotas.
 */

/** Hard ceiling for any single upload through the shared hook (100 MB). */
export const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

/**
 * Lower ceiling for files read into data-URL previews (10 MB). Previews are
 * base64 strings held in component state, so the 4/3× inflation plus render
 * cost argues for a much tighter bound than raw uploads.
 */
export const MAX_PREVIEW_DATA_URL_SIZE = 10 * 1024 * 1024;

export type UploadFileRejection =
  | { reason: 'empty' }
  | { reason: 'too-large'; size: number; max: number };

/**
 * Validate a file selected for upload. Returns `undefined` when the file is
 * acceptable, or a structured rejection otherwise. Synchronous on purpose:
 * `File.size` is metadata, so no file contents are read to decide.
 */
export function validateUploadFile(
  file: Pick<File, 'size'>,
  max: number = MAX_UPLOAD_SIZE,
): UploadFileRejection | undefined {
  // `size` should always be a non-negative integer on real Files; treat
  // missing/non-finite values as empty rather than trusting them.
  if (!Number.isFinite(file.size) || file.size <= 0) return { reason: 'empty' };
  if (file.size > max) return { reason: 'too-large', size: file.size, max };
  return undefined;
}

/**
 * Human-readable message for a rejection, mirroring the tone of the pet-asset
 * validators ("SVG files must be 1 MB or smaller"). Avoids parentheses because
 * `baoError(code, detail)` wraps the detail in its own.
 */
export function describeUploadRejection(rejection: UploadFileRejection): string {
  switch (rejection.reason) {
    case 'empty':
      return 'The file is empty.';
    case 'too-large':
      return `Files must be ${formatBytes(rejection.max)} or smaller; the selected file is ${formatBytes(rejection.size)}.`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${Number.isInteger(mb) ? mb : Number(mb.toFixed(1))} MB`;
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : Number(kb.toFixed(1))} KB`;
  }
  return `${bytes} bytes`;
}
