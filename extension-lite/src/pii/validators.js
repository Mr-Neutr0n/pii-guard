/**
 * PII Guard Lite — Validation Algorithms
 *
 * Luhn (credit cards), Verhoeff (Aadhaar), PAN format, SSN rules.
 * All pure JS, zero dependencies.
 */

// ==========================================================================
// Luhn Algorithm — Credit card validation
// ==========================================================================

export function luhn(num) {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ==========================================================================
// Verhoeff Algorithm — Aadhaar card validation
// Dihedral group D5 multiplication, permutation, and inverse tables.
// ==========================================================================

const _d = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const _p = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const _inv = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeff(num) {
  const digits = num.replace(/\D/g, "");
  if (digits.length !== 12) return false;

  // First digit must be >= 2
  if (parseInt(digits[0], 10) < 2) return false;

  // Must not be palindromic
  const reversed = digits.split("").reverse().join("");
  if (digits === reversed) return false;

  // Verhoeff checksum
  let c = 0;
  const reversedDigits = digits.split("").reverse();
  for (let i = 0; i < reversedDigits.length; i++) {
    c = _d[c][_p[i % 8][parseInt(reversedDigits[i], 10)]];
  }
  return c === 0;
}

// ==========================================================================
// PAN format — AAAAA0000A (5 letters, 4 digits, 1 letter)
// ==========================================================================

export function validatePAN(pan) {
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan);
}

// ==========================================================================
// SSN rules — cannot start with 000, 666, or 9xx
// ==========================================================================

export function validateSSN(ssn) {
  const digits = ssn.replace(/\D/g, "");
  if (digits.length !== 9) return false;
  const area = parseInt(digits.substring(0, 3), 10);
  if (area === 0 || area === 666 || area >= 900) return false;
  const group = parseInt(digits.substring(3, 5), 10);
  if (group === 0) return false;
  const serial = parseInt(digits.substring(5, 9), 10);
  if (serial === 0) return false;
  return true;
}
