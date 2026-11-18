/** Structured error types. CLI maps codes to exit statuses and clear messages. */

export type CaliperErrorCode =
  | 'USAGE'
  | 'NO_AUDIT'
  | 'NO_DATA'
  | 'IO'
  | 'PARSE'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export class CaliperError extends Error {
  readonly code: CaliperErrorCode;
  readonly hint: string | undefined;

  constructor(code: CaliperErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'CaliperError';
    this.code = code;
    this.hint = hint;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
