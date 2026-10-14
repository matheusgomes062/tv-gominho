// Splitting a day into files under 4 GB (FAT32, the usual pendrive format, cannot hold more).
// A part never starts or ends inside a video, and it prefers to end where a TV channel would
// have a break: right after a commercial break, so the next file opens on the show again.

/** Target size of one part. FAT32's hard limit is 4 GiB - 1 byte; this leaves room for the container's own overhead. */
export const PART_TARGET_BYTES = 3_500_000_000;
export const FAT32_MAX_BYTES = 4_294_967_295;
/** A part is not closed early at a good boundary unless it is at least this full. */
const MIN_FILL = 0.5;

/** The fields of a piece that decide where a cut may fall. */
export interface CutInfo {
  inBreak: boolean;
}

/**
 * How good a cut between two consecutive pieces is: 1 = right after a commercial break (best),
 * 2 = between two items of the schedule, 3 = between an act of an episode and its commercial break,
 * 4 = between two commercials of the same break (only when nothing else fits).
 */
export function cutRank(before: CutInfo, after: CutInfo): 1 | 2 | 3 | 4 {
  if (before.inBreak) return after.inBreak ? 4 : 1;
  return after.inBreak ? 3 : 2;
}

export interface PartRange {
  /** Index of the first piece. */
  start: number;
  /** One past the last piece. */
  end: number;
  bytes: number;
  /** A single video larger than the target: it could not be split without cutting it. */
  oversize: boolean;
}

/**
 * Greedy split of `pieces` (with their sizes in bytes) into parts of at most `cap` bytes. When the next
 * piece would not fit, the part is closed at the best cut so far: the latest one of the best rank that
 * leaves it at least half full (then the same without the half-full rule, and last of all, between two
 * commercials). A video bigger than `cap` by itself becomes a part of its own, marked `oversize`.
 */
export function splitParts(pieces: readonly CutInfo[], sizes: readonly number[], cap: number = PART_TARGET_BYTES): PartRange[] {
  const parts: PartRange[] = [];
  let start = 0;
  while (start < pieces.length) {
    let end = start;
    let bytes = 0;
    // `prefix[k]` = bytes of pieces start..start+k-1.
    const prefix: number[] = [0];
    while (end < pieces.length && (end === start || bytes + sizes[end]! <= cap)) {
      bytes += sizes[end]!;
      end++;
      prefix.push(bytes);
    }
    if (end >= pieces.length) {
      parts.push({ start, end: pieces.length, bytes, oversize: end - start === 1 && bytes > cap });
      break;
    }

    // The next piece (`end`) does not fit: close the part before one of the pieces start+1..end.
    let cut = -1;
    const rankAt = (at: number) => cutRank(pieces[at - 1]!, pieces[at]!);
    const latest = (rank: number, minBytes: number) => {
      for (let at = end; at > start; at--) if (rankAt(at) === rank && prefix[at - start]! >= minBytes) return at;
      return -1;
    };
    for (const minBytes of [cap * MIN_FILL, 0]) {
      for (const rank of [1, 2, 3]) {
        if (cut < 0) cut = latest(rank, minBytes);
      }
    }
    if (cut < 0) cut = latest(4, 0);
    if (cut < 0) cut = end; // cannot happen: `end` is always a cut of some rank

    const partBytes = prefix[cut - start]!;
    parts.push({ start, end: cut, bytes: partBytes, oversize: cut - start === 1 && partBytes > cap });
    start = cut;
  }
  return parts;
}

// ---------------------------------------------------------------- size estimates

/**
 * Typical bitrates of the encoder in this tool (see `encoding.ts`), used for the dry run and the free-space
 * check. The real sizes are measured after each piece is rendered, and the parts are split from those.
 */
export const AUDIO_BITS_PER_SECOND = 160_000;

/** Estimated size of `seconds` of video at `videoBitsPerSecond`, plus the audio and a little container overhead. */
export function estimateBytes(seconds: number, videoBitsPerSecond: number): number {
  return Math.round(((seconds * (videoBitsPerSecond + AUDIO_BITS_PER_SECOND)) / 8) * 1.01);
}
