/** Minimal browser-facing contract for handing a player to a new work area. */
export interface WorkspaceHandoffPort {
  scrollToTop: () => void
  focusWorkspace: () => void
}

/**
 * Keep a same-tab click quiet, but make a real Play/Review/Train/Library/etc.
 * transition start at the beginning of its new workspace for pointer, keyboard
 * and screen-reader users alike.
 */
export function handoffWorkspace(previous: string, next: string, port: WorkspaceHandoffPort): boolean {
  if (previous === next) return false
  port.scrollToTop()
  port.focusWorkspace()
  return true
}

/**
 * A Review → Train target is a navigation payload, not a sticky training
 * preference. Keep it for the active Train visit (including optional mastered
 * replays), then return later visits to the normal due-first queue.
 */
export function shouldClearRequestedRetryOnWorkspaceExit(previous: string, next: string): boolean {
  return previous === 'train' && next !== 'train'
}
