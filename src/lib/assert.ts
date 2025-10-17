/**
 * Asserts that a value is not null or undefined.
 * @param {T} value - The value to check.
 * @param {string} message - The error message to throw if the value is null or undefined.
 * @template T
 */
export function assertExists<T>(
  value: T,
  message: string,
): asserts value is NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
}
