/**
 * PII Guard Lite — Regex Patterns for Structured PII Detection
 *
 * Each pattern has: entity type, regex, optional validator, score, and context keywords.
 * Context keywords boost confidence when found near the match.
 */

import { luhn, verhoeff, validatePAN, validateSSN } from "./validators.js";

// UPI bank suffixes (30+ Indian banks)
const UPI_SUFFIXES =
  "ybl|okhdfcbank|okicici|okaxis|oksbi|apl|ibl|sbi|axisb|icici|hdfc|paytm|upi|gpay|phonepe|freecharge|airtel|jio|kotak|barodampay|dbs|federal|indus|rbl|yesbank|citi|hsbc|sc|idbi|pnb|bob|canara|unionbank";

/**
 * @typedef {Object} PIIPattern
 * @property {string} entity - Entity type name (e.g., "EMAIL_ADDRESS")
 * @property {RegExp} regex - Pattern to match
 * @property {function|null} validate - Optional validator function (returns boolean)
 * @property {number} score - Base confidence score (0-1)
 * @property {string[]} context - Context keywords that boost score
 */

/** @type {PIIPattern[]} */
export const PATTERNS = [
  // --- Email ---
  {
    entity: "EMAIL_ADDRESS",
    regex: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
    validate: null,
    score: 1.0,
    context: ["email", "mail", "contact", "send", "address"],
  },

  // --- Phone (Indian) ---
  {
    entity: "PHONE_NUMBER",
    regex: /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g,
    validate: (match) => match.replace(/\D/g, "").length >= 10,
    score: 0.85,
    context: ["phone", "call", "mobile", "number", "contact", "tel", "whatsapp"],
  },

  // --- Phone (US / International) ---
  {
    entity: "PHONE_NUMBER",
    regex: /(?:\+1[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    validate: (match) => match.replace(/\D/g, "").length >= 10,
    score: 0.8,
    context: ["phone", "call", "number", "contact", "tel"],
  },

  // --- Credit Card (Luhn validated) ---
  {
    entity: "CREDIT_CARD",
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    validate: (match) => luhn(match),
    score: 0.95,
    context: ["card", "credit", "debit", "visa", "mastercard", "amex", "payment"],
  },

  // --- Aadhaar (Verhoeff validated) ---
  {
    entity: "IN_AADHAAR",
    regex: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    validate: (match) => verhoeff(match),
    score: 0.95,
    context: ["aadhaar", "aadhar", "uid", "uidai", "identity"],
  },

  // --- PAN Card ---
  {
    entity: "IN_PAN",
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    validate: (match) => validatePAN(match),
    score: 0.9,
    context: ["pan", "income tax", "tax", "permanent account"],
  },

  // --- US SSN ---
  {
    entity: "US_SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    validate: (match) => validateSSN(match),
    score: 0.9,
    context: ["ssn", "social security", "social"],
  },

  // --- IP Address (IPv4) ---
  {
    entity: "IP_ADDRESS",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    validate: null,
    score: 0.9,
    context: ["ip", "address", "server", "host", "network"],
  },

  // --- UPI ID ---
  {
    entity: "IN_UPI_ID",
    regex: new RegExp(`\\b[a-zA-Z0-9._-]+@(?:${UPI_SUFFIXES})\\b`, "g"),
    validate: null,
    score: 0.85,
    context: ["upi", "payment", "pay", "gpay", "phonepe", "paytm", "vpa"],
  },

  // --- Indian Passport ---
  {
    entity: "IN_PASSPORT",
    regex: /\b[A-Z][1-9]\d{6}\b/g,
    validate: null,
    score: 0.7,
    context: ["passport", "travel", "visa", "immigration"],
  },
];

/**
 * Check if any context keywords appear near the match in the source text.
 * Returns a score boost (0 or 0.1).
 */
export function contextBoost(text, matchStart, matchEnd, contextWords) {
  if (!contextWords || contextWords.length === 0) return 0;
  // Check 50 characters before and after the match
  const windowStart = Math.max(0, matchStart - 50);
  const windowEnd = Math.min(text.length, matchEnd + 50);
  const window = text.substring(windowStart, windowEnd).toLowerCase();
  for (const word of contextWords) {
    if (window.includes(word)) return 0.1;
  }
  return 0;
}
