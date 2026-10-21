/**
 * Model ids a tool reports about itself (hive-mind#2840).
 *
 * Claude Code names the running model in `system/init` and in every assistant
 * `message.model`, long before the `result` event that carries `modelUsage`.
 * Reading them from the stream keeps the actual model known for a crashed,
 * killed or failed run. Synthetic ids such as `<synthetic>` are not models.
 */

/**
 * Whether a model id names a real model
 * @param {*} modelId - Candidate id
 * @returns {boolean}
 */
export function isRealModelId(modelId) {
  if (typeof modelId !== 'string') {
    return false;
  }
  const id = modelId.trim();
  return id.length > 0 && !(id.startsWith('<') && id.endsWith('>'));
}

/**
 * Model id an event reports, if any
 * @param {Object} event - Parsed stream event
 * @returns {string|null}
 */
function eventModelId(event) {
  if (event?.type === 'system' && event.subtype === 'init') {
    return event.model ?? null;
  }
  if (event?.type === 'assistant') {
    return event.message?.model ?? null;
  }
  return null;
}

/**
 * Collect observed model ids from stream events
 * @param {Object[]} messages - Parsed stream events, subagent events included
 * @returns {{observedModels: string[], observedModel: string|null}}
 *   `observedModels` lists main-thread models first, in order of first
 *   observation, then models only seen from subagents; `observedModel` is the
 *   main-thread model observed last
 */
export function extractObservedModels(messages = []) {
  const main = [];
  const subagent = [];
  let observedModel = null;
  for (const event of messages) {
    const id = eventModelId(event);
    if (!isRealModelId(id)) {
      continue;
    }
    const modelId = id.trim();
    if (event.parent_tool_use_id) {
      subagent.push(modelId);
    } else {
      main.push(modelId);
      observedModel = modelId;
    }
  }
  return {
    observedModels: [...new Set([...main, ...subagent])],
    observedModel,
  };
}
