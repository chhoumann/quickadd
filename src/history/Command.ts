export interface Command {
  /**
   * Perform the action represented by this command.
   */
  execute(): Promise<void>;

  /**
   * Revert the effects of execute(). Must be idempotent.
   */
  undo(): Promise<void>;

  /**
   * Execute the command again after an undo.
   * The default semantics should mirror execute().
   */
  redo(): Promise<void>;

  /**
   * Return true if this command can be undone at the current state.
   */
  canUndo(): boolean;

  /**
   * Human-readable description for UI feedback.
   */
  getDescription(): string;
}