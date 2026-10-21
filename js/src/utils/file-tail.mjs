import { promises as fs } from 'node:fs';

/**
 * Read at most `maxBytes` from the end of a file. When the file is longer,
 * the cut first line is dropped, because it is not a whole record.
 * @param {string} file - File path
 * @param {number} maxBytes - Bytes read from the end
 * @returns {Promise<string>}
 */
export async function readFileTail(file, maxBytes) {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const text = buffer.toString('utf8');
    return length < size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await handle.close();
  }
}
