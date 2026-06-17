/**
 * Tests for main library interface
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agent } from '../src/index.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';

test('agent - throws without tool', () => {
  assert.throws(() => {
    agent({
      workingDirectory: '/tmp/test',
    });
  }, /tool is required/);
});

test('agent - throws without workingDirectory', () => {
  assert.throws(() => {
    agent({
      tool: 'claude',
    });
  }, /workingDirectory is required/);
});

test('agent - throws for screen isolation without screenName', () => {
  assert.throws(() => {
    agent({
      tool: 'claude',
      workingDirectory: '/tmp/test',
      isolation: 'screen',
    });
  }, /screenName is required/);
});

test('agent - throws for docker isolation without containerName', () => {
  assert.throws(() => {
    agent({
      tool: 'claude',
      workingDirectory: '/tmp/test',
      isolation: 'docker',
    });
  }, /containerName is required/);
});

test('agent - creates controller with valid options', () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
  });

  assert.ok(controller);
  assert.strictEqual(typeof controller.start, 'function');
  assert.strictEqual(typeof controller.stop, 'function');
});

test('agent - start in dry-run mode', async () => {
  const controller = agent({
    tool: 'echo',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
  });

  const result = await controller.start({ dryRun: true });

  // start() in dry-run mode returns void, doesn't return result
  assert.strictEqual(result, undefined);
});

test('agent - stop throws for no isolation without start', async () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'none',
  });

  await assert.rejects(async () => {
    await controller.stop();
  }, /Agent not started/);
});

test('agent - stop in dry-run mode with screen', async () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'screen',
    screenName: 'test-session',
  });

  const result = await controller.stop({ dryRun: true });

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.output);
  assert.ok(result.output.plain !== undefined);
  assert.ok(result.output.parsed !== undefined);
});

// Skip this test on Windows - uses bash-dependent command execution
// and dynamic module loading that isn't available on Windows
test(
  'agent - start and stop with no isolation',
  { skip: process.platform === 'win32' },
  async () => {
    const controller = agent({
      tool: 'echo',
      workingDirectory: '/tmp',
      prompt: 'Hello World',
    });

    // Start should not wait for completion
    await controller.start({ attached: false });

    // Stop should wait and collect output
    const result = await controller.stop();

    assert.ok(result.exitCode !== null);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.output);
    assert.ok(result.output.plain);
    assert.ok(result.output.plain.includes('Hello World'));
  }
);

test(
  'agent - stdin tools handle large shell-sensitive prompts through a file',
  { skip: process.platform === 'win32' || isDeno },
  async (t) => {
    const binDir = await mkdtemp(join(tmpdir(), 'agent-commander-test-bin-'));
    for (const tool of ['agent', 'qwen', 'gemini']) {
      const fakeTool = join(binDir, tool);
      await writeFile(
        fakeTool,
        '#!/usr/bin/env bash\nwc -c | tr -d "[:space:]"\n'
      );
      await chmod(fakeTool, 0o755);
    }

    const previousPath = process.env.PATH || '';
    process.env.PATH = `${binDir}:${previousPath}`;
    t.after(async () => {
      process.env.PATH = previousPath;
      await rm(binDir, { recursive: true, force: true });
    });

    for (const tool of ['agent', 'qwen', 'gemini']) {
      const prompt = `${'x'.repeat(3 * 1024 * 1024)}\n' "$HOME" \`pwd\``;
      const systemPrompt = 'system instructions';
      const expectedBytes = Buffer.byteLength(`${systemPrompt}\n\n${prompt}`);
      const controller = agent({
        tool,
        workingDirectory: '/tmp',
        prompt,
        systemPrompt,
      });

      await controller.start({ attached: false });
      const result = await controller.stop();

      assert.strictEqual(result.exitCode, 0, `tool: ${tool}`);
      assert.strictEqual(
        result.output.plain.trim(),
        String(expectedBytes),
        `tool: ${tool}`
      );
    }
  }
);

test(
  'agent - stop includes normalized metadata for Claude JSON result output',
  { skip: process.platform === 'win32' || isDeno },
  async (t) => {
    const binDir = await mkdtemp(join(tmpdir(), 'agent-commander-test-bin-'));
    const fakeClaude = join(binDir, 'claude');
    await writeFile(
      fakeClaude,
      `#!/usr/bin/env bash
printf '%s\\n' '{"type":"system","session_id":"claude-session-1"}'
printf '%s\\n' '{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":25,"cache_creation_input_tokens":5,"cache_read_input_tokens":7}}}'
printf '%s\\n' '{"type":"result","subtype":"success","session_id":"claude-session-1","total_cost_usd":0.0123,"result":"Implemented the requested change."}'
`
    );
    await chmod(fakeClaude, 0o755);

    const previousPath = process.env.PATH || '';
    process.env.PATH = `${binDir}:${previousPath}`;
    t.after(async () => {
      process.env.PATH = previousPath;
      await rm(binDir, { recursive: true, force: true });
    });

    const controller = agent({
      tool: 'claude',
      workingDirectory: '/tmp',
      prompt: 'hello',
      json: true,
    });

    await controller.start({ attached: false });
    const result = await controller.stop();

    assert.ok(result.metadata);
    assert.strictEqual(result.metadata.tool, 'claude');
    assert.strictEqual(result.metadata.success, true);
    assert.strictEqual(result.metadata.sessionId, 'claude-session-1');
    assert.strictEqual(result.metadata.anthropicTotalCostUSD, 0.0123);
    assert.strictEqual(
      result.metadata.resultSummary,
      'Implemented the requested change.'
    );
    assert.deepStrictEqual(result.metadata.streamTokenUsage, {
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationTokens: 5,
      cacheReadTokens: 7,
    });
    assert.strictEqual(result.metadata.errorDuringExecution, false);
  }
);

test(
  'agent - approve-each relays native permission requests end-to-end',
  { skip: process.platform === 'win32' || isDeno },
  async (t) => {
    // A fake `agent` binary that emits one native permission_request frame on
    // stdout and waits for the relay to write a permission_response on its
    // stdin, then echoes that response back so the test can verify the round
    // trip without a real CLI.
    const binDir = await mkdtemp(join(tmpdir(), 'agent-commander-test-bin-'));
    const fakeAgent = join(binDir, 'agent');
    await writeFile(
      fakeAgent,
      `#!/usr/bin/env bash
printf '%s\\n' '{"type":"permission_request","permissionID":"p1","tool":"bash","title":"Run command","metadata":{"command":"rm -rf build"}}'
while IFS= read -r line; do
  case "$line" in
    *permission_response*)
      printf 'RELAYED %s\\n' "$line"
      exit 0
      ;;
  esac
done
exit 0
`
    );
    await chmod(fakeAgent, 0o755);

    const previousPath = process.env.PATH || '';
    process.env.PATH = `${binDir}:${previousPath}`;
    t.after(async () => {
      process.env.PATH = previousPath;
      await rm(binDir, { recursive: true, force: true });
    });

    const seen = [];
    const controller = agent({
      tool: 'agent',
      workingDirectory: '/tmp',
      prompt: 'Refactor this file',
      approveEach: true,
      onPermissionRequest: (request) => {
        seen.push(request);
        return 'reject';
      },
    });

    await controller.start({ attached: false });
    const result = await controller.stop();

    assert.strictEqual(result.exitCode, 0);

    // The normalized request was relayed to the consumer.
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].type, 'permission_request');
    assert.strictEqual(seen[0].tool, 'agent');
    assert.strictEqual(seen[0].id, 'p1');
    assert.strictEqual(seen[0].command, 'rm -rf build');
    assert.strictEqual(seen[0].scope, 'session');

    // The native response frame was written to the tool's stdin (the fake tool
    // echoes it back prefixed with RELAYED).
    assert.ok(result.output.plain.includes('RELAYED'));
    assert.ok(result.output.plain.includes('"permissionID":"p1"'));
    assert.ok(result.output.plain.includes('"response":"reject"'));
  }
);

test('agent - approve-each on unsupported tool throws at start', async () => {
  const controller = agent({
    tool: 'codex',
    workingDirectory: '/tmp',
    prompt: 'Hello',
    approveEach: true,
    onPermissionRequest: () => 'once',
  });

  await assert.rejects(
    () => controller.start({ attached: false }),
    /does not support enforceable per-command approval/
  );
});
