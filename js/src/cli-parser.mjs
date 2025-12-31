/**
 * Parse CLI arguments
 * Simple argument parser without external dependencies
 */

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
      if (nextArg && !nextArg.startsWith('--')) {
        options[key] = nextArg;
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
    systemPrompt: parsed['system-prompt'],
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
  --system-prompt <text>           System prompt for the agent
  --isolation <mode>               Isolation mode: none, screen, docker (default: none)
  --screen-name <name>             Screen session name (required for screen isolation)
  --container-name <name>          Container name (required for docker isolation)
  --detached                       Run in detached mode
  --dry-run                        Show command without executing
  --help, -h                       Show this help message

Examples:
  # Basic usage (no isolation)
  start-agent --tool claude --working-directory "/tmp/dir" --prompt "Hello"

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
