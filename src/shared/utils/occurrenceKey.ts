/** Spec: local `y-m-d-h-m` without zero-padding, e.g. `2026-10-28-8-0`. */
export const OCCURRENCE_KEY_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}-\d{1,2}-\d{1,2}$/;

export function isValidOccurrenceKey(value: string): boolean {
  return OCCURRENCE_KEY_PATTERN.test(value);
}
