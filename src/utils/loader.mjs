/**
 * Dynamic module loader using use-m
 * Inspired by hive-mind's approach to loading dependencies
 */

let useFunction;

/**
 * Initialize the use-m loader
 */
async function initializeLoader() {
  if (useFunction) {
    return useFunction;
  }

  try {
    // Load use-m from CDN
    const response = await fetch('https://unpkg.com/use-m/use.js');
    const code = await response.text();
    const module = await eval(code);
    useFunction = module.use;
    return useFunction;
  } catch (error) {
    console.error('Failed to load use-m:', error.message);
    process.exit(1);
  }
}

/**
 * Load a module using use-m
 * @param {string} moduleName - The name of the module to load
 * @returns {Promise<any>} The loaded module
 */
export async function use(moduleName) {
  const loader = await initializeLoader();
  return await loader(moduleName);
}

/**
 * Get command-stream $ function for executing commands
 * @returns {Promise<{$: Function}>} Command execution function
 */
export async function getCommandStream() {
  const commandStream = await use('command-stream');
  return commandStream;
}

/**
 * Get getenv for environment variable access
 * @returns {Promise<Function>} getenv function
 */
export async function getEnv() {
  return await use('getenv');
}
