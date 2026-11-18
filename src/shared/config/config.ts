import { ConfigError, loadConfig, type Config } from './load-config.js';

/** Invalid configuration is reported once, readably, and ends the process before anything starts. */
function loadOrExit(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

/** Validated when this module is first imported, so every module that needs configuration shares one result. */
export const config = loadOrExit();
