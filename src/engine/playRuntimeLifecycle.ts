/**
 * Decides when Play's retained engine runtime can be released without
 * interrupting a live reply or a manual engine probe. Browser workers and the
 * shared desktop UCI process follow the same user-visible safety boundary.
 */
export interface PlayRuntimeState {
  outsidePlay: boolean
  gameFinished: boolean
  premoveWindow: boolean
  thinking: boolean
  engineProbeActive: boolean
}

export function shouldReleaseIdlePlayRuntime({
  outsidePlay,
  gameFinished,
  premoveWindow,
  thinking,
  engineProbeActive,
}: PlayRuntimeState): boolean {
  return (outsidePlay || gameFinished)
    && !premoveWindow
    && !thinking
    && !engineProbeActive
}
