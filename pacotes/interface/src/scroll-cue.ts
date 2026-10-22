// The "mais abaixo" cue: the scrollbars of the panels are hidden, so a body that overflows shows a fade and a
// hint at its bottom edge while there is more to see. No DOM in here.

/** Closer than this to the end counts as the end (sub-pixel scroll positions). */
export const END_TOLERANCE = 4;

/** Whether a scrolling box still has content below what it shows. */
export function moreBelow({ scrollTop, clientHeight, scrollHeight }: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return clientHeight > 0 && scrollHeight - (scrollTop + clientHeight) > END_TOLERANCE;
}

/** The words of the hint. */
export const MORE_BELOW_TEXT = 'mais abaixo';
