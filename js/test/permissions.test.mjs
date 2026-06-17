/**
 * Tests for the uniform per-command approval ("ask" mode) permission relay.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  ASK_SUPPORTED_TOOLS,
  ASK_DECISIONS,
  ASK_SCOPE,
  PERMISSION_PARITY,
  supportsAsk,
  askUnsupportedError,
  normalizePermissionRequest,
  buildPermissionResponse,
  PermissionRelay,
  createPermissionRelay,
} from '../src/permissions/index.mjs';

test('supportsAsk - only agent and claude are relayable', () => {
  assert.equal(supportsAsk({ tool: 'agent' }), true);
  assert.equal(supportsAsk({ tool: 'claude' }), true);
  assert.equal(supportsAsk({ tool: 'codex' }), false);
  assert.equal(supportsAsk({ tool: 'qwen' }), false);
  assert.equal(supportsAsk({ tool: 'gemini' }), false);
  assert.equal(supportsAsk({ tool: 'opencode' }), false);
  assert.deepEqual([...ASK_SUPPORTED_TOOLS], ['agent', 'claude']);
});

test('askUnsupportedError - mentions the tool and supported tools', () => {
  const message = askUnsupportedError({ tool: 'codex' });
  assert.match(message, /Tool "codex"/);
  assert.match(message, /per-command approval/);
  assert.match(message, /agent, claude/);
  assert.match(message, /--approve-each/);
});

test('ASK_DECISIONS - exactly once, always, reject', () => {
  assert.deepEqual([...ASK_DECISIONS].sort(), ['always', 'once', 'reject']);
});

test('ASK_SCOPE - documents per-backend always semantics', () => {
  assert.equal(ASK_SCOPE.agent, 'session');
  assert.equal(ASK_SCOPE.claude, 'tool-input');
});

test('normalizePermissionRequest - agent permission_request', () => {
  const message = {
    type: 'permission_request',
    permissionID: 'perm-1',
    sessionID: 'sess-1',
    callID: 'call-1',
    tool: 'bash',
    title: 'Run a command',
    pattern: 'rm *',
    metadata: { command: 'rm -rf build' },
  };

  const normalized = normalizePermissionRequest({ tool: 'agent', message });
  assert.equal(normalized.type, 'permission_request');
  assert.equal(normalized.tool, 'agent');
  assert.equal(normalized.id, 'perm-1');
  assert.equal(normalized.sessionId, 'sess-1');
  assert.equal(normalized.callId, 'call-1');
  assert.equal(normalized.toolName, 'bash');
  assert.equal(normalized.title, 'Run a command');
  assert.equal(normalized.command, 'rm -rf build');
  assert.equal(normalized.pattern, 'rm *');
  assert.equal(normalized.scope, 'session');
  assert.equal(normalized.input, null);
  assert.deepEqual(normalized.raw, message);
});

test('normalizePermissionRequest - agent snake_case permission_id fallback', () => {
  const normalized = normalizePermissionRequest({
    tool: 'agent',
    message: {
      type: 'permission_request',
      permission_id: 'perm-2',
      tool: 'edit',
    },
  });
  assert.equal(normalized.id, 'perm-2');
  assert.equal(normalized.toolName, 'edit');
});

test('normalizePermissionRequest - agent ignores non-permission messages', () => {
  assert.equal(
    normalizePermissionRequest({
      tool: 'agent',
      message: { type: 'step_finish' },
    }),
    null
  );
});

test('normalizePermissionRequest - claude can_use_tool control_request', () => {
  const message = {
    type: 'control_request',
    request_id: 'req-9',
    session_id: 'sess-9',
    request: {
      subtype: 'can_use_tool',
      tool_use_id: 'tu-9',
      tool_name: 'Bash',
      input: { command: 'npm test' },
    },
  };

  const normalized = normalizePermissionRequest({ tool: 'claude', message });
  assert.equal(normalized.tool, 'claude');
  assert.equal(normalized.id, 'req-9');
  assert.equal(normalized.sessionId, 'sess-9');
  assert.equal(normalized.callId, 'tu-9');
  assert.equal(normalized.toolName, 'Bash');
  assert.equal(normalized.command, 'npm test');
  assert.equal(normalized.scope, 'tool-input');
  assert.deepEqual(normalized.input, { command: 'npm test' });
});

test('normalizePermissionRequest - claude derives command from file_path', () => {
  const normalized = normalizePermissionRequest({
    tool: 'claude',
    message: {
      type: 'control_request',
      request_id: 'req-10',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        input: { file_path: '/tmp/a.txt' },
      },
    },
  });
  assert.equal(normalized.command, '/tmp/a.txt');
});

test('normalizePermissionRequest - claude ignores unrelated control_request', () => {
  assert.equal(
    normalizePermissionRequest({
      tool: 'claude',
      message: {
        type: 'control_request',
        request: { subtype: 'initialize' },
      },
    }),
    null
  );
});

test('buildPermissionResponse - agent maps decisions verbatim', () => {
  const request = { id: 'perm-1' };
  for (const decision of ['once', 'always', 'reject']) {
    const frame = buildPermissionResponse({ tool: 'agent', request, decision });
    assert.deepEqual(frame, {
      type: 'permission_response',
      permissionID: 'perm-1',
      response: decision,
    });
  }
});

test('buildPermissionResponse - claude reject denies', () => {
  const frame = buildPermissionResponse({
    tool: 'claude',
    request: { id: 'req-1', input: { command: 'x' } },
    decision: 'reject',
  });
  assert.equal(frame.type, 'control_response');
  assert.equal(frame.response.subtype, 'success');
  assert.equal(frame.response.request_id, 'req-1');
  assert.equal(frame.response.response.behavior, 'deny');
});

test('buildPermissionResponse - claude once/always allow with input', () => {
  for (const decision of ['once', 'always']) {
    const frame = buildPermissionResponse({
      tool: 'claude',
      request: { id: 'req-2', input: { command: 'npm test' } },
      decision,
    });
    assert.equal(frame.response.response.behavior, 'allow');
    assert.deepEqual(frame.response.response.updatedInput, {
      command: 'npm test',
    });
  }
});

test('buildPermissionResponse - rejects invalid decision', () => {
  assert.throws(() => {
    buildPermissionResponse({
      tool: 'agent',
      request: { id: 'x' },
      decision: 'maybe',
    });
  }, /Invalid permission decision/);
});

test('buildPermissionResponse - rejects unsupported tool', () => {
  assert.throws(() => {
    buildPermissionResponse({
      tool: 'codex',
      request: { id: 'x' },
      decision: 'once',
    });
  }, /does not support enforceable per-command approval/);
});

test('PERMISSION_PARITY - covers all six tools with scope and relay', () => {
  const tools = PERMISSION_PARITY.map((row) => row.tool);
  assert.deepEqual(tools.sort(), [
    'agent',
    'claude',
    'codex',
    'gemini',
    'opencode',
    'qwen',
  ]);
  for (const row of PERMISSION_PARITY) {
    assert.ok(
      typeof row.nativeMechanism === 'string' && row.nativeMechanism.length > 0
    );
    assert.ok(typeof row.scope === 'string' && row.scope.length > 0);
    assert.equal(typeof row.relay, 'boolean');
    assert.ok(typeof row.notes === 'string' && row.notes.length > 0);
  }
  const relayable = PERMISSION_PARITY.filter((row) => row.relay).map(
    (row) => row.tool
  );
  assert.deepEqual(relayable.sort(), ['agent', 'claude']);
});

test('PermissionRelay - constructor validates required options', () => {
  assert.throws(() => new PermissionRelay({}), /tool is required/);
  assert.throws(
    () => new PermissionRelay({ tool: 'agent' }),
    /onRequest callback is required/
  );
  assert.throws(
    () => new PermissionRelay({ tool: 'agent', onRequest: () => {} }),
    /write callback is required/
  );
});

test('PermissionRelay - relays an agent request and writes the response', async () => {
  const written = [];
  const relay = new PermissionRelay({
    tool: 'agent',
    onRequest: (request) => {
      assert.equal(request.id, 'perm-1');
      assert.equal(request.command, 'rm -rf build');
      return 'always';
    },
    write: (line) => written.push(line),
  });

  const record = await relay.handleMessage({
    message: {
      type: 'permission_request',
      permissionID: 'perm-1',
      tool: 'bash',
      metadata: { command: 'rm -rf build' },
    },
  });

  assert.equal(record.decision, 'always');
  assert.equal(written.length, 1);
  const frame = JSON.parse(written[0]);
  assert.deepEqual(frame, {
    type: 'permission_response',
    permissionID: 'perm-1',
    response: 'always',
  });
  assert.equal(relay.getHandled().length, 1);
});

test('PermissionRelay - ignores non-permission messages', async () => {
  const written = [];
  const relay = new PermissionRelay({
    tool: 'agent',
    onRequest: () => 'once',
    write: (line) => written.push(line),
  });

  const result = await relay.handleMessage({
    message: { type: 'step_finish' },
  });
  assert.equal(result, null);
  assert.equal(written.length, 0);
});

test('PermissionRelay - defaults invalid consumer decision to reject', async () => {
  const written = [];
  const relay = createPermissionRelay({
    tool: 'claude',
    onRequest: () => 'banana',
    write: (line) => written.push(line),
  });

  const record = await relay.handleMessage({
    message: {
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'x' },
      },
    },
  });

  assert.equal(record.decision, 'reject');
  const frame = JSON.parse(written[0]);
  assert.equal(frame.response.response.behavior, 'deny');
});

test('PermissionRelay - claude allow forwards updatedInput', async () => {
  const written = [];
  const relay = new PermissionRelay({
    tool: 'claude',
    onRequest: () => 'once',
    write: (line) => written.push(line),
  });

  await relay.handleMessage({
    message: {
      type: 'control_request',
      request_id: 'req-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        input: { command: 'npm test' },
      },
    },
  });

  const frame = JSON.parse(written[0]);
  assert.equal(frame.response.response.behavior, 'allow');
  assert.deepEqual(frame.response.response.updatedInput, {
    command: 'npm test',
  });
});
