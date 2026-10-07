// Force a four-byte code point across separate stdout/stderr chunks.
import { setTimeout } from 'node:timers';
const encoded = Buffer.from('🙂');
process.stdout.write(encoded.subarray(0, 1));
process.stderr.write(encoded.subarray(0, 2));
setTimeout(() => {
  process.stdout.write(encoded.subarray(1));
  process.stderr.write(encoded.subarray(2));
}, 30);
