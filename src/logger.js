
/**
Allows options.logger to be a function that ignores all logging or does something special or can be an object.  If the object does not implement info, debug, or error, then it defaults to console.info, console.debug, console.error
*/
function getLogger(logger) {
  if (! logger) {
    logger = console;
    logger.debug = console.log;
  } else if (typeof logger === 'function') {
    logger = {
      info: logger,
      error: logger,
      debug: logger
    }
  } else {
    logger = {
      error: logger.error || console.error,
      info: logger.info || console.info,
      debug: logger.debug || console.log
    }
  }
  return logger;
}

module.exports = getLogger;