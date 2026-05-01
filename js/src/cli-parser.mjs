/**
 * Parse CLI arguments
 * Simple argument parser without external dependencies
 */

const VALUE_OPTION_KEYS = new Set(['tool-arg']);

/**
 * Parse command line arguments
 * @param {string[]} args - Process arguments
 * @returns {Object} Parsed options
 */
export function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const nextArg = args[i + 1];

      // Check if it's a flag (boolean) or has a value
      if (
        nextArg &&
        (!nextArg.startsWith('--') || VALUE_OPTION_KEYS.has(key))
      ) {
        setOptionValue(options, key, nextArg);
        i++; // Skip next arg as it's the value
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  options._positional = positional;
  return options;
}

/**
 * Set an option value while preserving repeated options.
 * @param {Object} options - Parsed options
 * @param {string} key - Option key
 * @param {string} value - Option value
 */
function setOptionValue(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value;
  } else if (Array.isArray(options[key])) {
    options[key].push(value);
  } else {
    options[key] = [options[key], value];
  }
}

/**
 * Get all values for a repeated option.
 * @param {Object} parsed - Parsed options
 * @param {string} key - Option key
 * @returns {string[]} Option values
 */
function getOptionValues(parsed, key) {
  const value = parsed[key];
  if (value === undefined || value === true) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse start-agent CLI arguments
 * @param {string[]} args - Process arguments
 * @returns {Object} Parsed configuration
 */
export function parseStartAgentArgs(args) {
  const parsed = parseArgs(args);

  return {
    tool: parsed.tool,
    workingDirectory: parsed['working-directory'],
    prompt: parsed.prompt,
    promptFile: parsed['prompt-file'],
    systemPrompt: parsed['system-prompt'],
    appendSystemPrompt: parsed['append-system-prompt'],
    model: parsed.model,
    fallbackModel: parsed['fallback-model'],
    verbose: parsed.verbose || false,
    replayUserMessages: parsed['replay-user-messages'] || false,
    readOnly: parsed['read-only'] || parsed['plan-only'] || false,
    resume: parsed.resume,
    sessionId: parsed['session-id'],
    forkSession: parsed['fork-session'] || false,
    toolExecutable: parsed['tool-executable'],
    toolArgs: getOptionValues(parsed, 'tool-arg'),
    toolEnv: getOptionValues(parsed, 'tool-env'),
    skipDefaultSafetyFlags: parsed['skip-default-safety-flags'] || false,
    isolation: parsed.isolation || 'none',
    screenName: parsed['screen-name'],
    containerName: parsed['container-name'],
    dryRun: parsed['dry-run'] || false,
    detached: parsed.detached || false,
    attached: !parsed.detached, // Default is attached unless detached is specified
    help: parsed.help || parsed.h || false,
  };
}

/**
 * Parse stop-agent CLI arguments
 * @param {string[]} args - Process arguments
 * @returns {Object} Parsed configuration
 */
export function parseStopAgentArgs(args) {
  const parsed = parseArgs(args);

  return {
    isolation: parsed.isolation,
    screenName: parsed['screen-name'],
    containerName: parsed['container-name'],
    dryRun: parsed['dry-run'] || false,
    help: parsed.help || parsed.h || false,
  };
}

/**
 * Show start-agent help message
 */
export function showStartAgentHelp() {
  console.log(`
Usage: start-agent [options]

Options:
  --tool <name>                    CLI tool to use (e.g., 'claude') [required]
  --working-directory <path>       Working directory for the agent [required]
  --prompt <text>                  Prompt for the agent
  --prompt-file <path>             Read prompt input from a file
  --system-prompt <text>           System prompt for the agent
  --append-system-prompt <text>    Append to the default system prompt
  --model <model>                  Model to use (e.g., 'sonnet', 'opus', 'haiku')
  --fallback-model <model>         Fallback model when default is overloaded
  --verbose                        Enable verbose mode
  --read-only                      Enforce native read-only/planning mode
  --plan-only                      Alias for --read-only
  --resume <sessionId>             Resume a previous session by ID
  --session-id <uuid>              Use a specific session ID (must be valid UUID)
  --fork-session                   Create new session ID when resuming
  --replay-user-messages           Re-emit user messages on stdout (streaming mode)
  --tool-executable <path>         Override the tool executable path/name
  --tool-env <KEY=VALUE>           Add an environment variable for the tool (repeatable)
  --tool-arg <arg>                 Append a raw argument to the tool command (repeatable)
  --skip-default-safety-flags      Do not add default autonomous safety bypass flags
  --isolation <mode>               Isolation mode: none, screen, docker (default: none)
  --screen-name <name>             Screen session name (required for screen isolation)
  --container-name <name>          Container name (required for docker isolation)
  --detached                       Run in detached mode
  --dry-run                        Show command without executing
  --help, -h                       Show this help message

Examples:
  # Basic usage (no isolation)
  start-agent --tool claude --working-directory "/tmp/dir" --prompt "Hello"

  # With model selection
  start-agent --tool claude --working-directory "/tmp/dir" \\
    --prompt "Hello" --model opus --fallback-model sonnet

  # Resume a session with fork
  start-agent --tool claude --working-directory "/tmp/dir" \\
    --resume abc123 --fork-session

  # Read-only planning mode
  start-agent --tool claude --working-directory "/tmp/dir" \\
    --prompt "Inspect this project" --read-only

  # With screen isolation (detached)
  start-agent --tool claude --working-directory "/tmp/dir" \\
    --isolation screen --screen-name my-agent --detached

  # With docker isolation (attached)
  start-agent --tool claude --working-directory "/tmp/dir" \\
    --isolation docker --container-name my-container

  # Dry run
  start-agent --tool claude --working-directory "/tmp/dir" --dry-run
`);
}

/**
 * Show stop-agent help message
 */
export function showStopAgentHelp() {
  console.log(`
Usage: stop-agent [options]

Options:
  --isolation <mode>               Isolation mode: screen, docker [required]
  --screen-name <name>             Screen session name (required for screen isolation)
  --container-name <name>          Container name (required for docker isolation)
  --dry-run                        Show command without executing
  --help, -h                       Show this help message

Examples:
  # Stop screen session
  stop-agent --isolation screen --screen-name my-agent

  # Stop docker container
  stop-agent --isolation docker --container-name my-container

  # Dry run
  stop-agent --isolation screen --screen-name my-agent --dry-run
`);
}

/**
 * Validate start-agent options
 * @param {Object} options - Parsed options
 * @returns {Object} Validation result with { valid: boolean, errors: string[] }
 */
export function validateStartAgentOptions(options) {
  const errors = [];

  if (!options.tool) {
    errors.push('--tool is required');
  }

  if (!options.workingDirectory) {
    errors.push('--working-directory is required');
  }

  if (options.isolation === 'screen' && !options.screenName) {
    errors.push('--screen-name is required for screen isolation');
  }

  if (options.isolation === 'docker' && !options.containerName) {
    errors.push('--container-name is required for docker isolation');
  }

  if (
    options.isolation &&
    !['none', 'screen', 'docker'].includes(options.isolation)
  ) {
    errors.push('--isolation must be one of: none, screen, docker');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate stop-agent options
 * @param {Object} options - Parsed options
 * @returns {Object} Validation result with { valid: boolean, errors: string[] }
 */
export function validateStopAgentOptions(options) {
  const errors = [];

  if (!options.isolation) {
    errors.push('--isolation is required');
  }

  if (options.isolation && !['screen', 'docker'].includes(options.isolation)) {
    errors.push('--isolation must be one of: screen, docker');
  }

  if (options.isolation === 'screen' && !options.screenName) {
    errors.push('--screen-name is required for screen isolation');
  }

  if (options.isolation === 'docker' && !options.containerName) {
    errors.push('--container-name is required for docker isolation');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
