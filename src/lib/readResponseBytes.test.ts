import { describe, expect, it } from 'vitest';

import { readResponseBytes } from '@/lib/readResponseBytes';

describe('readResponseBytes', () => {
  it('reads a response within the byte limit', async () => {
    const result = await readResponseBytes(new Response('hello'), 5);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('rejects a response whose declared length exceeds the limit', async () => {
    const response = new Response('hello', {
      headers: { 'content-length': '100' },
    });
    await expect(readResponseBytes(response, 5)).rejects.toThrow('5-byte limit');
  });

  it('rejects a streamed response after accumulated chunks exceed the limit', async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'));
        controller.enqueue(new TextEncoder().encode('!'));
        controller.close();
      },
    }));

    await expect(readResponseBytes(response, 5)).rejects.toThrow('5-byte limit');
  });

  it('rejects invalid limits', async () => {
    await expect(readResponseBytes(new Response('x'), -1)).rejects.toThrow('Invalid response size limit');
    await expect(readResponseBytes(new Response('x'), 1.5)).rejects.toThrow('Invalid response size limit');
  });
});
