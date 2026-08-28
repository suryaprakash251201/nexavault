/**
 * Logger - Structured logging utility
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
  data?: any;
}

export class Logger {
  private component: string;
  private minLevel: LogLevel = 'info';
  private logs: LogEntry[] = [];
  private maxLogs = 1000;

  constructor(component: string, minLevel: LogLevel = 'info') {
    this.component = component;
    this.minLevel = minLevel;
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  getLevel(): LogLevel {
    return this.minLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private sanitizeData(data: any): any {
    if (!data) return data;
    
    const sensitiveKeys = [
      'token', 'password', 'secret', 'key', 'credential',
      'accessKey', 'secretKey', 'authorization', 'auth',
      'passphrase', 'privateKey', 'apiKey',
    ];
    
    if (typeof data === 'object') {
      const sanitized = Array.isArray(data) ? [] : {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        const isSensitive = sensitiveKeys.some(k => lowerKey.includes(k));
        
        if (isSensitive) {
          (sanitized as any)[key] = '[REDACTED]';
        } else if (typeof value === 'object' && value !== null) {
          (sanitized as any)[key] = this.sanitizeData(value);
        } else {
          (sanitized as any)[key] = value;
        }
      }
      return sanitized;
    }
    
    return data;
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (!this.shouldLog(level)) return;
    
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      component: this.component,
      message,
      data: this.sanitizeData(data),
    };
    
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    const prefix = `[${new Date(entry.timestamp).toISOString()}] [${level.toUpperCase()}] [${this.component}]`;
    
    switch (level) {
      case 'debug':
        console.debug(prefix, message, data ? this.sanitizeData(data) : '');
        break;
      case 'info':
        console.info(prefix, message, data ? this.sanitizeData(data) : '');
        break;
      case 'warn':
        console.warn(prefix, message, data ? this.sanitizeData(data) : '');
        break;
      case 'error':
        console.error(prefix, message, data ? this.sanitizeData(data) : '');
        break;
    }
  }

  debug(message: string, data?: any): void {
    this.log('debug', message, data);
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

  getLogs(level?: LogLevel): LogEntry[] {
    if (!level) return [...this.logs];
    return this.logs.filter(entry => entry.level === level);
  }

  clearLogs(): void {
    this.logs = [];
  }

  exportLogs(): string {
    return JSON.stringify(this.logs, null, 2);
  }
}

// Global logger factory
const loggers = new Map<string, Logger>();

export function getLogger(component: string, minLevel?: LogLevel): Logger {
  if (!loggers.has(component)) {
    loggers.set(component, new Logger(component, minLevel));
  }
  return loggers.get(component)!;
}

export function setGlobalLogLevel(level: LogLevel): void {
  for (const logger of loggers.values()) {
    logger.setLevel(level);
  }
}
