/**
 * Uniform per-command approval ("ask" mode) permission relay.
 *
 * Public surface for normalizing native permission requests, building native
 * responses, relaying decisions, and inspecting per-tool parity.
 */

export {
  ASK_SUPPORTED_TOOLS,
  ASK_DECISIONS,
  ASK_SCOPE,
  PERMISSION_PARITY,
  supportsAsk,
  askUnsupportedError,
  normalizePermissionRequest,
  buildPermissionResponse,
} from './normalize.mjs';

export { PermissionRelay, createPermissionRelay } from './relay.mjs';
