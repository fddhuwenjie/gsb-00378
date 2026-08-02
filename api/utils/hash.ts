import { createHash } from 'node:crypto';
import { toLF } from './lineUtils';

/**
 * SHA-256 hex digest of a raw string.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Hash of merge input after CRLF/CR normalization to LF.
 * Used to detect whether base/local/remote changed between sessions.
 */
export function hashContent(text: string): string {
  return sha256Hex(toLF(text));
}

/**
 * Short deterministic hash for stable conflict identifiers.
 * The input already encodes the conflict's content, so identical
 * conflicts on identical inputs always get the same id.
 */
export function shortHash(text: string, length = 10): string {
  return sha256Hex(text).slice(0, length);
}
