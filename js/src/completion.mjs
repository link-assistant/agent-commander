/** Track the last native turn; an OS exit code alone cannot prove completion. */
export function completionState(tool, messages) {
  let state = null;
  for (const event of messages) {
    if (event?.parent_tool_use_id) {
      continue;
    }
    const type = event?.type;
    if (
      tool === 'gemini' &&
      !type &&
      event?.stats &&
      (event.response !== undefined || event.error)
    ) {
      state = event.error ? 'failed' : 'completed';
    }
    if (tool === 'codex') {
      if (type === 'thread.started' || type === 'turn.started') {
        state = 'incomplete';
      }
      if (type === 'turn.completed') {
        state = 'completed';
      }
      if (type === 'turn.failed') {
        state = 'failed';
      }
    } else if (tool === 'opencode' || tool === 'agent') {
      if (type === 'step_start') {
        state = 'incomplete';
      }
      if (type === 'step_finish') {
        state =
          event.part?.reason === 'tool-calls' ? 'incomplete' : 'completed';
      }
    } else {
      if (
        type === 'init' ||
        (type === 'system' && event.subtype === 'init') ||
        type === 'assistant'
      ) {
        state = 'incomplete';
      }
      if (type === 'result') {
        state =
          event.is_error === true ||
          event.status === 'error' ||
          event.subtype?.startsWith('error')
            ? 'failed'
            : 'completed';
      }
    }
  }
  return state;
}

/** Earlier recoverable errors do not override the last completed turn. */
export function outcomeMessages(tool, messages) {
  const main = messages.filter((event) => !event?.parent_tool_use_id);
  if (completionState(tool, main) !== 'completed') {
    return main;
  }
  const terminal = main.findLastIndex(
    (event) => completionState(tool, [event]) === 'completed'
  );
  return main.slice(terminal);
}

/** JSON controllers require native evidence even when the CLI prints nothing. */
export function requireCompletedResult(metadata, tool, messages) {
  if (metadata.success && completionState(tool, messages) !== 'completed') {
    Object.assign(metadata, {
      success: false,
      errorDuringExecution: true,
      errorType: 'incomplete_stream',
      errorMessage: 'Process exited before the native completion event',
    });
  }
  return metadata;
}
