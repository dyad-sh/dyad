/**
 * The single dollars <-> cents boundary.
 *
 * Money is whole cents everywhere inside the app: in the database, in every
 * sum, and in every JSON field. Dollars exist only in what a human types and
 * what a human reads, and both directions are converted here and nowhere else.
 *
 * The conversion is done on the decimal *string*, digit by digit, so no value
 * ever passes through binary floating point. That matters: the obvious
 * `Math.trunc(parseFloat("1250.10") * 100)` is `125009`, because the product is
 * `125009.99999999999`. `1250.10` is `125010`.
 */

/** Thrown for input that is not a well-formed dollar amount. */
export class MoneyFormatError extends Error {}

const DOLLARS = /^([+-]?)(\d+)(?:\.(\d+))?$/;

/**
 * Parses a dollars string (`"1250.10"`) into whole cents (`125010`).
 * Exact for any input with two or fewer decimals; a longer input is rounded
 * half-up on the third decimal. Never uses floating-point multiplication.
 */
export function dollarsToCents(value: string | number): number {
  const text = String(value).trim();
  const match = DOLLARS.exec(text);
  if (!match) {
    throw new MoneyFormatError(
      `"${text}" is not a valid amount — use dollars and cents, e.g. 1250.10.`,
    );
  }
  const [, sign, whole, fraction = ""] = match;
  let cents =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.slice(0, 2).padEnd(2, "0"), 10);
  if (fraction.length > 2 && Number.parseInt(fraction[2], 10) >= 5) cents += 1;
  return sign === "-" ? -cents : cents;
}

/** Cents (`125010`) as a plain two-decimal dollars string (`"1250.10"`). */
export function centsToDollars(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(Math.trunc(cents));
  const whole = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  return `${negative ? "-" : ""}${whole}.${String(remainder).padStart(2, "0")}`;
}

/** Cents as a display amount, e.g. `$1,250.10`. Display only — never stored. */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const [whole, fraction] = centsToDollars(Math.abs(cents)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction}`;
}
