import assert from 'node:assert';
import { test } from 'node:test';
import { $ } from 'command-stream';

test(
  'installed command-stream preserves apostrophes and quoted shell operators',
  { timeout: 10_000 },
  async () => {
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
