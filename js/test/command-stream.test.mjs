import assert from 'node:assert';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { $ } from 'command-stream';

test(
  'installed command-stream preserves apostrophes and quoted shell operators',
  // On a fresh Windows runner the first node.exe launch took up to 9.4 s to
  // print anything (later launches took ~55 ms), which alone nearly used the
  // old 10 s budget under Deno. Launch it once before the real check.
  { timeout: 60_000 },
  async () => {
    await promisify(execFile)('node', ['--version']);

    // Use the static dependency, as consumers and src/tui.mjs do, rather than
    // the dynamic loader which independently fetches command-stream.
    const show = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
    const prompt = "it's";
    const systemPrompt = "Use the 'file' command; a | b & c";
    const result =
      await $`node -e ${show} -- -p ${prompt} --append-system-prompt ${systemPrompt}`.quiet();

    assert.strictEqual(result.code, 0, String(result.stderr));
    assert.strictEqual(String(result.stderr), '');
    assert.deepStrictEqual(JSON.parse(String(result.stdout)), [
      '-p',
      prompt,
      '--append-system-prompt',
      systemPrompt,
    ]);
  }
);
