import { redact } from "./redact.js";

/**
 * Structured JSON logging (spec 27.1). Every line carries the request ID and, where
 * known, the actor, so a request can be followed from transport through to persistence.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Derive a logger that adds fields to every line, e.g. a request or actor context. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly base?: LogFields;
  /** Sink override, for tests and for shipping elsewhere. */
  readonly write?: (line: string) => void;
  readonly now?: () => Date;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const base = options.base ?? {};
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  function log(entryLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const entry = {
      level: entryLevel,
      time: now().toISOString(),
      message,
      ...base,
      ...(fields ? (redact(fields) as LogFields) : {}),
    };
    write(JSON.stringify(entry));
  }

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    child: (fields) =>
      createLogger({
        ...options,
        level,
        base: { ...base, ...(redact(fields) as LogFields) },
      }),
  };
}

/** A logger that discards everything, for tests that do not assert on output. */
export const silentLogger: Logger = createLogger({ level: "error", write: () => {} });
