// Simple logger utility for the application
// This can be expanded to use electron-log or other logging libraries

export interface Logger {
  info(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, data?: any): void;
  debug(message: string, data?: any): void;
}

class ScopedLogger implements Logger {
  constructor(private scope: string) {}

  private safeStringify(obj: any): string {
    try {
      return JSON.stringify(obj);
    } catch (error) {
      // Handle circular references by creating a safe copy
      try {
        const seen = new WeakSet();
        const replacer = (key: string, value: any) => {
          if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
              return '[Circular Reference]';
            }
            seen.add(value);
          }
          return value;
        };
        return JSON.stringify(obj, replacer);
      } catch (fallbackError) {
        // If all else fails, return a basic representation
        return `[Object: ${typeof obj}]`;
      }
    }
  }

  private log(level: string, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logData = data ? ` ${this.safeStringify(data)}` : '';
    const logMessage = `[${timestamp}] [${this.scope}] ${message}${logData}`;

    switch (level) {
      case 'info':
        console.info(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'error':
        console.error(logMessage);
        break;
      case 'debug':
        console.debug(logMessage);
        break;
      default:
        console.log(logMessage);
    }
  }

  info(message: string, data?: any): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: any): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: any): void {
    this.log('error', message, data);
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
  }
}

export function createScopedLogger(scope: string): Logger {
  return new ScopedLogger(scope);
}
