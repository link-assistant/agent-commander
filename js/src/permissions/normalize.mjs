/**
 * Permission normalization for the uniform per-command approval ("ask") mode.
 *
 * Each backend CLI that supports interactive, per-command approval exposes the
 * approval handshake over a different JSON wire format. This module translates
 * those native frames into a single normalized `permission_request` event and
 * translates a normalized decision (`once` | `always` | `reject`) back into the
 * native response frame that the CLI expects on its stdin.
 *
 * Only tools with a *drivable* JSON request/response permission protocol can be
 * relayed (see {@link ASK_SUPPORTED_TOOLS}). Tools whose only native approval
 * mechanism is a static policy (`opencode`), a sandbox coupling (`codex`), or a
 * non-streaming approval flag (`qwen`, `gemini`) are documented in the parity
 * table but fail clearly when ask mode is requested — mirroring the
 * `--read-only` unsupported-tool pattern.
 */

/**
 * Tools that expose a relayable per-command approval protocol over JSON.
 * @type {Set<string>}
 */
export const ASK_SUPPORTED_TOOLS = new Set(['agent', 'claude']);

/**
 * Normalized decisions a consumer may return for a permission request.
 * @type {Set<string>}
 */
export const ASK_DECISIONS = new Set(['once', 'always', 'reject']);

/**
 * Scope of an `always` decision for each backend. The reviewer (m13v) flagged
 * that "always" does not mean the same thing across CLIs, so the normalized
 * event and the parity table both carry this scope.
 *
 * - `session`  — `always` auto-approves later matching requests for the rest of
 *                the session (agent's native `always`).
 * - `tool-input` — approval binds to the tool name + input shape; Claude has no
 *                native session-wide `always`, so `once` and `always` both map
 *                to a single allow decision bound to that tool call's input.
 * @type {Record<string, string>}
 */
export const ASK_SCOPE = {
  agent: 'session',
  claude: 'tool-input',
};

/**
 * Whether agent-commander can relay per-command approvals for the given tool.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @returns {boolean} True when the tool has a relayable approval protocol
 */
export function supportsAsk(options) {
  const { tool } = options;
  return ASK_SUPPORTED_TOOLS.has(tool);
}

/**
 * Build the standard error for tools without a relayable per-command approval
 * mechanism (ask mode). Mirrors `readOnlyUnsupportedError`.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @returns {string} Error message
 */
export function askUnsupportedError(options) {
  const { tool } = options;
  const supported = [...ASK_SUPPORTED_TOOLS].join(', ');
  return `Tool "${tool}" does not support enforceable per-command approval (ask mode). Choose one of: ${supported}; or run without --approve-each.`;
}

/**
 * Derive a human-readable command string from a Claude tool input payload.
 * @param {Object} options - Options
 * @param {string} [options.toolName] - Claude tool name (e.g. `Bash`, `Edit`)
 * @param {Object} [options.input] - Tool input payload
 * @returns {string|null} A best-effort command/target string or null
 */
function deriveClaudeCommand(options) {
  const { toolName, input } = options;
  if (!input || typeof input !== 'object') {
    return null;
  }
  // Bash carries the literal shell command.
  if (typeof input.command === 'string') {
    return input.command;
  }
  // File tools carry the target path.
  if (typeof input.file_path === 'string') {
    return input.file_path;
  }
  if (typeof input.path === 'string') {
    return input.path;
  }
  // WebFetch / WebSearch carry a URL or query.
  if (typeof input.url === 'string') {
    return input.url;
  }
  return toolName || null;
}

/**
 * Normalize a native permission request frame into a uniform event.
 *
 * Returns `null` when the message is not a permission request for the tool, so
 * callers can pass every parsed output message through unconditionally.
 *
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name (`agent` | `claude`)
 * @param {Object} options.message - A parsed output message from the tool
 * @returns {Object|null} Normalized permission_request event or null
 */
export function normalizePermissionRequest(options) {
  const { tool, message } = options;
  if (!message || typeof message !== 'object') {
    return null;
  }

  if (tool === 'agent') {
    if (message.type !== 'permission_request') {
      return null;
    }
    const id = message.permissionID ?? message.permission_id ?? null;
    const metadata =
      message.metadata && typeof message.metadata === 'object'
        ? message.metadata
        : {};
    return {
      type: 'permission_request',
      tool: 'agent',
      id,
      sessionId: message.sessionID ?? message.session_id ?? null,
      callId: message.callID ?? message.call_id ?? null,
      toolName: message.tool ?? null,
      title: message.title ?? null,
      command: metadata.command ?? message.title ?? null,
      pattern: message.pattern ?? metadata.patterns ?? null,
      scope: ASK_SCOPE.agent,
      input: null,
      raw: message,
    };
  }

  if (tool === 'claude') {
    if (
      message.type !== 'control_request' ||
      !message.request ||
      message.request.subtype !== 'can_use_tool'
    ) {
      return null;
    }
    const request = message.request;
    const toolName = request.tool_name ?? null;
    const input =
      request.input && typeof request.input === 'object' ? request.input : null;
    return {
      type: 'permission_request',
      tool: 'claude',
      id: message.request_id ?? null,
      sessionId: message.session_id ?? null,
      callId: request.tool_use_id ?? null,
      toolName,
      title: toolName,
      command: deriveClaudeCommand({ toolName, input }),
      pattern: null,
      scope: ASK_SCOPE.claude,
      input,
      raw: message,
    };
  }

  return null;
}

/**
 * Build the native response frame for a normalized decision.
 *
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name (`agent` | `claude`)
 * @param {Object} options.request - The normalized request being answered
 * @param {string} options.decision - `once` | `always` | `reject`
 * @returns {Object} Native response frame ready to be serialized to stdin
 */
export function buildPermissionResponse(options) {
  const { tool, request, decision } = options;

  if (!ASK_DECISIONS.has(decision)) {
    throw new Error(
      `Invalid permission decision "${decision}". Expected one of: once, always, reject.`
    );
  }
  if (!request || typeof request !== 'object') {
    throw new Error('A normalized permission request is required.');
  }

  if (tool === 'agent') {
    // Agent's native protocol accepts once | always | reject verbatim.
    return {
      type: 'permission_response',
      permissionID: request.id,
      response: decision,
    };
  }

  if (tool === 'claude') {
    // Claude's stream-json control protocol expects an allow/deny behavior.
    // It has no native session-wide "always", so once and always both map to a
    // single allow bound to this tool call's input (scope: tool-input).
    if (decision === 'reject') {
      return {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: request.id,
          response: {
            behavior: 'deny',
            message: 'Denied by consumer (ask mode).',
          },
        },
      };
    }
    return {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: request.id,
        response: {
          behavior: 'allow',
          updatedInput: request.input ?? {},
        },
      },
    };
  }

  throw new Error(askUnsupportedError({ tool }));
}

/**
 * Parity description for each tool's native per-command approval mechanism.
 * Surfaced in the docs parity table; `scope` documents what an `always`/allow
 * decision attaches to, and `relay` indicates whether agent-commander can drive
 * the handshake as normalized JSON.
 * @type {Array<Object>}
 */
export const PERMISSION_PARITY = [
  {
    tool: 'agent',
    nativeMechanism: '--permission-mode ask (+ --input-format stream-json)',
    scope: 'session',
    relay: true,
    notes:
      'Native JSON permission_request/permission_response protocol; once | always | reject map 1:1.',
  },
  {
    tool: 'claude',
    nativeMechanism: '--permission-mode default (stream-json can_use_tool)',
    scope: 'tool-input',
    relay: true,
    notes:
      'control_request/control_response handshake; no session-wide always, so once and always both allow this call.',
  },
  {
    tool: 'codex',
    nativeMechanism: '--ask-for-approval (coupled with --sandbox)',
    scope: 'sandbox-coupled',
    relay: false,
    notes:
      'Approval is coupled with the sandbox policy and not exposed as a tool-agnostic JSON request/response stream.',
  },
  {
    tool: 'qwen',
    nativeMechanism: '--approval-mode default',
    scope: 'interactive-only',
    relay: false,
    notes:
      'Headless mode has no relayable per-command JSON approval handshake.',
  },
  {
    tool: 'gemini',
    nativeMechanism: '--approval-mode default',
    scope: 'interactive-only',
    relay: false,
    notes:
      'No JSON stdin channel (prompt is passed via -p), so approvals cannot be relayed.',
  },
  {
    tool: 'opencode',
    nativeMechanism: 'OPENCODE_PERMISSION (static {edit,bash,task} policy)',
    scope: 'static-policy',
    relay: false,
    notes:
      'Only a static up-front policy is available; there is no per-command request/response relay.',
  },
];
