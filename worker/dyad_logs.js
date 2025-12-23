/**
 * dyad_logs.js – Console interception script
 * Intercepts all console methods and forwards them to the parent window
 */

(function () {
  // Store original console methods
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  // Helper function to safely stringify arguments
  function stringifyArgs(args) {
    return args.map((arg) => {
      if (arg === null) return "null";
      if (arg === undefined) return "undefined";
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return "[Object: unable to stringify]";
        }
      }
      return String(arg);
    });
  }

  // Intercept console.log
  console.log = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "log",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalLog.apply(console, args);
  };

  // Intercept console.warn
  console.warn = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "warn",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalWarn.apply(console, args);
  };

  // Intercept console.error
  console.error = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "error",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalError.apply(console, args);
  };

  // Intercept console.info
  console.info = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "info",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalInfo.apply(console, args);
  };

  // Intercept console.debug
  console.debug = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "debug",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalDebug.apply(console, args);
  };
})();
