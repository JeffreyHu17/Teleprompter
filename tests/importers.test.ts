import { describe, expect, it } from 'vitest';
import { decodeTextBuffer, markdownToPromptText } from '../src/core/importers';

describe('script import helpers', () => {
  it('decodes UTF-8 text', () => {
    const encoded = new TextEncoder().encode('中文提词稿');
    expect(decodeTextBuffer(encoded)).toBe('中文提词稿');
  });

  it('decodes UTF-16LE BOM text', () => {
    const body = new Uint8Array(new Uint16Array([0x4e2d, 0x6587]).buffer);
    const encoded = new Uint8Array([0xff, 0xfe, ...body]);
    expect(decodeTextBuffer(encoded)).toBe('中文');
  });

  it('removes Markdown presentation syntax', () => {
    const markdown = '# 标题\n\n- **重点内容**\n- [链接文本](https://example.com)';
    expect(markdownToPromptText(markdown)).toBe('标题\n\n重点内容\n链接文本');
  });
});
