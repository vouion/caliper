/** Structured error types. CLI maps codes to exit statuses and clear messages. */

export type HavrinErrorCode =
  | 'USAGE'
  | 'NO_AUDIT'
  | 'NO_DATA'
  | 'IO'
  | 'PARSE'
  | 'UNSUPPORTED'
  | 'INTERNAL';

export class HavrinError extends Error {
  readonly code: HavrinErrorCode;
  readonly hint: string | undefined;

  constructor(code: HavrinErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'HavrinError';
    this.code = code;
    this.hint = hint;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
