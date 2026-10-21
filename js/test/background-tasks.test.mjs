/**
 * Print-mode turns, background tasks, signals and observed models ported from
 * Hive Mind (hive-mind#2301, #2840, #3015; issue #55).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  assessBackgroundTasks,
  buildNormalizedResultMetadata,
  extractObservedModels,
  printWaitCeilingSeconds,
  trackBackgroundTasks,
} from '../src/index.mjs';

const init = { type: 'system', subtype: 'init', model: 'claude-opus-5-5' };
const assistant = (text, extra = {}) => ({
  type: 'assistant',
  message: {
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
  },
  ...extra,
});
const success = (extra = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'Done',
  session_id: 's-1',
  ...extra,
});
const taskStarted = (id) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: id,
  task_type: 'local_bash',
  description: 'npm test',
  is_backgrounded: true,
});

const metadata = (messages, extra = {}) =>
  buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 0,
    plainOutput: messages.map((m) => JSON.stringify(m)).join('\n'),
    ...extra,
  });

test('trackBackgroundTasks - a started task runs until it reports an end', () => {
  const started = trackBackgroundTasks([
    init,
    assistant('Working'),
    taskStarted('t1'),
    success(),
  ]);
  assert.deepStrictEqual(started.running, [
    { id: 't1', type: 'local_bash', description: 'npm test' },
  ]);
  assert.strictEqual(started.turnOpen, false);

  const finished = trackBackgroundTasks([
    taskStarted('t1'),
    {
      type: 'system',
      subtype: 'task_updated',
      task_id: 't1',
      patch: { status: 'completed' },
    },
    success(),
  ]);
  assert.deepStrictEqual(finished.running, []);
});

test('trackBackgroundTasks - background_tasks_changed is authoritative', () => {
  const state = trackBackgroundTasks([
    taskStarted('t1'),
    {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 't2', task_type: 'local_agent' }],
    },
  ]);
  assert.deepStrictEqual(
    state.running.map((task) => task.id),
    ['t2']
  );
});

test('assessBackgroundTasks - the print wait ceiling makes a success incomplete', () => {
  const messages = [init, assistant('Working'), taskStarted('t1'), success()];
  const output = 'Background tasks still running after 600s; terminating';
  assert.strictEqual(printWaitCeilingSeconds(output), 600);
  const verdict = assessBackgroundTasks({ messages, output });
  assert.strictEqual(verdict.incomplete, true);
  assert.strictEqual(verdict.backgroundTasksStopped, 1);
  assert.match(verdict.cause, /600s print-mode wait ceiling/);
});

test('assessBackgroundTasks - a stop the model asked for is followed by a reply', () => {
  const stopped = {
    type: 'system',
    subtype: 'task_notification',
    task_id: 't1',
    status: 'stopped',
    summary: 'npm test',
  };
  const idle = assessBackgroundTasks({
    messages: [assistant('Working'), taskStarted('t1'), success(), stopped],
  });
  assert.strictEqual(idle.incomplete, true);
  assert.deepStrictEqual(idle.stoppedBackgroundTasks, [
    { id: 't1', summary: 'npm test', outputFile: null },
  ]);

  const asked = assessBackgroundTasks({
    messages: [
      taskStarted('t1'),
      stopped,
      assistant('Stopped the tests'),
      success(),
    ],
  });
  assert.strictEqual(asked.incomplete, false);
});

test('assessBackgroundTasks - subagent_stats.killed.system counts stopped tasks', () => {
  const verdict = assessBackgroundTasks({
    messages: [success({ subagent_stats: { killed: { system: 2 } } })],
  });
  assert.strictEqual(verdict.backgroundTasksStopped, 2);
  assert.strictEqual(verdict.incomplete, true);
});

test('metadata - stopped background tasks fail a successful result', () => {
  const messages = [init, assistant('Working'), taskStarted('t1'), success()];
  const result = metadata(messages, {
    plainOutput: `${messages
      .map((m) => JSON.stringify(m))
      .join('\n')}\nBackground tasks still running after 600s; terminating\n`,
  });
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorType, 'background_tasks_stopped');
  assert.strictEqual(result.printWaitCeilingSeconds, 600);
  assert.strictEqual(result.backgroundTasksStopped, 1);
  assert.strictEqual(result.runningBackgroundTasks.length, 1);
});

test('metadata - a caller stop after a successful result is not a failure', () => {
  const result = metadata([init, assistant('Done'), success()], {
    exitCode: 143,
    terminatedAfterResult: true,
  });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.exitCode, 143);
  assert.strictEqual(result.signal, 'SIGTERM');
  assert.strictEqual(result.terminatedAfterResult, true);
  assert.strictEqual(result.errorDuringExecution, false);

  const running = metadata(
    [init, assistant('Done'), taskStarted('t1'), success()],
    { exitCode: 143, terminatedAfterResult: true }
  );
  assert.strictEqual(running.success, false);
  assert.strictEqual(running.errorType, 'background_tasks_stopped');
  assert.match(running.errorMessage, /stopped after its result/);
});

test('metadata - a stop before the result is still a failure', () => {
  const result = metadata([init, assistant('Working')], {
    exitCode: 143,
    terminatedAfterResult: true,
  });
  assert.strictEqual(result.success, false);
});

test('metadata - a signal exit names the signal, not the last output line', () => {
  const result = buildNormalizedResultMetadata({
    tool: 'codex',
    exitCode: 137,
    plainOutput:
      '{"type":"thread.started","thread_id":"t"}\n{"type":"turn.started"}\n' +
      '2026-05-01T10:00:00.123Z DEBUG codex_core::exec: running npm test\n',
  });
  assert.strictEqual(result.signal, 'SIGKILL');
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorType, 'signal');
  assert.strictEqual(
    result.errorMessage,
    'Process exited with code 137 (SIGKILL)'
  );
});

test('metadata - tracing telemetry is never the exit reason', () => {
  const result = buildNormalizedResultMetadata({
    tool: 'codex',
    exitCode: 1,
    plainOutput:
      'error: unexpected argument --foo\n' +
      '2026-05-01T10:00:00.123Z INFO codex_core::session: shutting down\n',
  });
  assert.strictEqual(result.signal, null);
  assert.strictEqual(result.errorType, 'exit_code');
  assert.strictEqual(result.errorMessage, 'error: unexpected argument --foo');
});

test('metadata - an explicit signal overrides the exit-code inference', () => {
  const result = buildNormalizedResultMetadata({
    tool: 'codex',
    exitCode: 130,
    signal: 'SIGINT',
    plainOutput: 'fatal: interrupted\n',
  });
  assert.strictEqual(
    result.errorMessage,
    'Process exited with code 130 (SIGINT): fatal: interrupted'
  );
});

test('observed models - main thread first, synthetic ids skipped', () => {
  const messages = [
    init,
    assistant('Hi'),
    {
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { model: 'claude-haiku-5-5', content: [] },
    },
    {
      type: 'assistant',
      is_api_error_message: true,
      message: { model: '<synthetic>', content: [] },
    },
  ];
  assert.deepStrictEqual(extractObservedModels(messages), {
    observedModels: ['claude-opus-5-5', 'claude-haiku-5-5'],
    observedModel: 'claude-opus-5-5',
  });
  const result = metadata([
    ...messages,
    {
      type: 'assistant',
      message: {
        model: '<synthetic>',
        usage: { input_tokens: 0 },
        content: [],
      },
    },
  ]);
  assert.deepStrictEqual(result.observedModels, [
    'claude-opus-5-5',
    'claude-haiku-5-5',
  ]);
  assert.ok(!('<synthetic>' in (result.resultModelUsage || {})));
});

test('metadata - Claude API error details pass through', () => {
  const overloaded = metadata(
    [
      init,
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        error: 'overloaded_error',
        api_error_status: 529,
        terminal_reason: 'api_error',
        request_id: 'req_1',
      },
    ],
    { exitCode: 1 }
  );
  assert.strictEqual(overloaded.apiError, 'overloaded_error');
  assert.strictEqual(overloaded.apiErrorStatus, 529);
  assert.strictEqual(overloaded.terminalReason, 'api_error');
  assert.strictEqual(overloaded.requestId, 'req_1');

  const forbidden = metadata(
    [
      init,
      {
        type: 'result',
        subtype: 'success',
        is_error: true,
        error: 'oauth_org_not_allowed',
        api_error_status: 403,
        result: 'Your organization does not allow OAuth',
      },
    ],
    { exitCode: 1 }
  );
  assert.strictEqual(forbidden.errorType, 'oauth_org_not_allowed');
  assert.strictEqual(forbidden.apiErrorStatus, 403);

  const clean = metadata([init, assistant('Done'), success()]);
  assert.strictEqual(clean.apiError, null);
  assert.strictEqual(clean.apiErrorStatus, null);
});
