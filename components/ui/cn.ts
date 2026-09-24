/** Join class names, skipping falsy values. Later classes win only by order, so keep overrides last. */
export function cn(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}
