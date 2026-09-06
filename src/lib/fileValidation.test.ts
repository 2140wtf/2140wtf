import { describe, expect, it } from 'vitest';

import { baoError, describeError, ErrorCodes } from '@/lib/errorCodes';
import {
  MAX_PREVIEW_DATA_URL_SIZE,
  MAX_UPLOAD_SIZE,
  describeUploadRejection,
  validateUploadFile,
} from '@/lib/fileValidation';

function fileOfSize(size: number): Pick<File, 'size'> {
  return { size };
}

describe('validateUploadFile', () => {
  it('accepts a normal-sized file', () => {
    expect(validateUploadFile(fileOfSize(1024))).toBeUndefined();
    expect(validateUploadFile(fileOfSize(MAX_UPLOAD_SIZE))).toBeUndefined();
  });

  it('rejects empty files', () => {
    expect(validateUploadFile(fileOfSize(0))).toEqual({ reason: 'empty' });
    expect(validateUploadFile(fileOfSize(-1))).toEqual({ reason: 'empty' });
  });

  it('treats missing or non-finite sizes as empty instead of trusting them', () => {
    expect(validateUploadFile({ size: Number.NaN })).toEqual({ reason: 'empty' });
    expect(validateUploadFile({ size: Number.POSITIVE_INFINITY })).toEqual({ reason: 'empty' });
  });

  it('rejects files above the default ceiling with sizes in the rejection', () => {
    const rejection = validateUploadFile(fileOfSize(MAX_UPLOAD_SIZE + 1));
    expect(rejection).toEqual({
      reason: 'too-large',
      size: MAX_UPLOAD_SIZE + 1,
      max: MAX_UPLOAD_SIZE,
    });
  });

  it('honors a caller-provided ceiling (preview data-URL bound)', () => {
    const justUnder = validateUploadFile(fileOfSize(MAX_PREVIEW_DATA_URL_SIZE), MAX_PREVIEW_DATA_URL_SIZE);
    expect(justUnder).toBeUndefined();

    const justOver = validateUploadFile(fileOfSize(MAX_PREVIEW_DATA_URL_SIZE + 1), MAX_PREVIEW_DATA_URL_SIZE);
    expect(justOver).toEqual({
      reason: 'too-large',
      size: MAX_PREVIEW_DATA_URL_SIZE + 1,
      max: MAX_PREVIEW_DATA_URL_SIZE,
    });
  });
});

describe('describeUploadRejection', () => {
  it('renders human-readable messages for each rejection reason', () => {
    expect(describeUploadRejection({ reason: 'empty' })).toMatch(/empty/i);
    const message = describeUploadRejection({ reason: 'too-large', size: MAX_UPLOAD_SIZE + 1, max: MAX_UPLOAD_SIZE });
    expect(message).toMatch(/100 MB/);
    // baoError wraps detail in parentheses, so the detail must not contain any.
    expect(message).not.toContain('(');
  });
});

describe('upload error codes', () => {
  it('carries friendly messages for the size rejections', () => {
    const tooLarge = describeError(baoError(ErrorCodes.UPLOAD_TOO_LARGE));
    expect(tooLarge.message).toMatch(/too large/i);
    expect(tooLarge.code).toBe('UPLOAD_005');

    const empty = describeError(baoError(ErrorCodes.UPLOAD_EMPTY));
    expect(empty.message).toMatch(/empty/i);
    expect(empty.code).toBe('UPLOAD_006');
  });
});
