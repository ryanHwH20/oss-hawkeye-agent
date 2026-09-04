export type HarnessErrorCode =
  | 'INVALID_STATE'
  | 'TERMINAL_STATE'
  | 'NO_PENDING_ACTION'
  | 'ACTION_MISMATCH'
  | 'INVALID_RESULT'
  | 'RESULT_KIND_MISMATCH'
  | 'ASSESSMENT_MISMATCH';

/** Machine-readable protocol error. The input state is never modified. */
export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: HarnessErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HarnessError';
    this.code = code;
    this.details = details;
  }
}
