export class QuickAddError extends Error {
  /**
   * Creates a new QuickAddError that can be surfaced to end-users.
   *
   * @param message - Technical/low-level error message. Helpful for developers and logs.
   * @param userMessage - Friendly, high-level message that will be shown to the user.
   * @param code - Stable error code that can be used for conditional logic and telemetry.
   * @param recoveryHint - (Optional) Tip that helps the user resolve the problem.
   * @param details - (Optional) Additional structured data useful during debugging.
   */
  constructor(
    public message: string,
    public userMessage: string,
    public code: string,
    public recoveryHint?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "QuickAddError";

    // Gracefully invoke V8 specific stack trace capture if available (V8 environments)
    type ErrorConstructorWithTrace = ErrorConstructor & {
      captureStackTrace?: (
        target: object,
        constructorOpt?: new (...args: unknown[]) => unknown
      ) => void;
    };

    const ErrorWithTrace = Error as ErrorConstructorWithTrace;
    if (typeof ErrorWithTrace.captureStackTrace === "function") {
      ErrorWithTrace.captureStackTrace(this, this.constructor);
    }
  }
}