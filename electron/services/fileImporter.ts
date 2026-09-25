import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import mammoth from 'mammoth';
import { decodeTextBuffer, markdownToPromptText } from '../../src/core/importers.js';
import type { ImportResult } from '../../src/types/session.js';

export async function importScriptViaDialog(parentWindow?: BrowserWindow | null): Promise<ImportResult | null> {
  const options: OpenDialogOptions = {
    title: '导入提词稿',
    properties: ['openFile'],
    filters: [
      { name: '提词稿', extensions: ['txt', 'md', 'docx'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  };
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const extension = extname(filePath).toLowerCase();
  const name = filePath.split(/[\\/]/).pop() ?? '导入稿件';
  if (extension === '.docx') {
    const extracted = await mammoth.extractRawText({ path: filePath });
    return { name, text: extracted.value };
  }
  const decoded = decodeTextBuffer(await readFile(filePath));
  return { name, text: extension === '.md' ? markdownToPromptText(decoded) : decoded };
}
