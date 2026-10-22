// Print the commands the shared launch options (issue #57) produce per tool.
import { buildAgentCommand } from '../js/src/command-builder.mjs';

const mcpConfig = {
  mcpServers: {
    files: { command: 'npx', args: ['-y', 'srv'], env: { K: 'v' } },
    'my srv': {
      type: 'http',
      url: 'https://h/mcp',
      headers: { Authorization: 'Bearer t' },
    },
  },
};
const cases = [
  { tool: 'claude', reasoningEffort: 'high', additionalDirectories: ['/a', '/b c'], mcpConfig, strictMcpConfig: true },
  { tool: 'codex', resume: 'abc', readOnly: true, reasoningEffort: 'xhigh', additionalDirectories: ['/a'], mcpConfig },
  { tool: 'opencode', reasoningEffort: 'max' },
  { tool: 'gemini', additionalDirectories: ['/a'] },
  { tool: 'qwen', additionalDirectories: ['/a'], mcpConfig: '/cfg.json' },
  { tool: 'agent', reasoningEffort: 'high' },
  { tool: 'codex', strictMcpConfig: true },
];
for (const options of cases) {
  try {
    console.log(buildAgentCommand({ workingDirectory: '/w', prompt: 'hi', ...options }));
  } catch (error) {
    console.log(`ERROR (${options.tool}): ${error.message}`);
  }
}
