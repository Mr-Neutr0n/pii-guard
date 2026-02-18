/**
 * PII Guard Lite — PII Detector
 *
 * Orchestrates Tier 1 (regex + validators) and Tier 2 (NER model).
 * Can run with or without the NER model.
 */

import { PATTERNS, contextBoost } from "./regex-patterns.js";
import { anonymize } from "./anonymizer.js";

/**
 * Tier 1: Regex-based detection with validation and context scoring.
 * Synchronous, <1ms for typical text.
 * @param {string} text
 * @returns {import('./anonymizer.js').DetectedEntity[]}
 */
export function detectWithRegex(text) {
  const entities = [];

  for (const pattern of PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.regex.lastIndex = 0;

    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      const matchedText = match[0];
      const start = match.index;
      const end = start + matchedText.length;

      // Run validator if present
      if (pattern.validate && !pattern.validate(matchedText)) {
        continue;
      }

      // Calculate score with context boost
      const boost = contextBoost(text, start, end, pattern.context);
      const score = Math.min(1.0, pattern.score + boost);

      entities.push({
        entity_type: pattern.entity,
        start,
        end,
        score,
        original_text: matchedText,
      });
    }
  }

  return entities;
}

/**
 * Tier 2: NER-based detection for person names, locations, organizations.
 * Maps Transformers.js NER output (PER, LOC, ORG) to our entity types.
 * @param {Array} nerResults - Raw output from Transformers.js NER pipeline
 * @param {string} text - Original text (for offset mapping)
 * @returns {import('./anonymizer.js').DetectedEntity[]}
 */
export function mapNerResults(nerResults, text) {
  if (!nerResults || nerResults.length === 0) return [];

  const TYPE_MAP = {
    PER: "PERSON",
    LOC: "LOCATION",
    ORG: "ORGANIZATION",
  };

  const entities = [];
  let currentEntity = null;

  for (const token of nerResults) {
    // Transformers.js NER returns tokens like { entity: "B-PER", word: "John", start: 0, end: 4, score: 0.99 }
    const tag = token.entity || token.entity_group || "";
    const prefix = tag.substring(0, 2); // "B-" or "I-"
    const label = tag.substring(2); // "PER", "LOC", "ORG", "MISC"

    if (!TYPE_MAP[label]) {
      // Flush current entity
      if (currentEntity) {
        entities.push(currentEntity);
        currentEntity = null;
      }
      continue;
    }

    if (prefix === "B-") {
      // New entity — flush previous
      if (currentEntity) entities.push(currentEntity);
      currentEntity = {
        entity_type: TYPE_MAP[label],
        start: token.start,
        end: token.end,
        score: token.score,
        original_text: text.substring(token.start, token.end),
      };
    } else if (prefix === "I-" && currentEntity && TYPE_MAP[label] === currentEntity.entity_type) {
      // Continuation of current entity
      currentEntity.end = token.end;
      currentEntity.original_text = text.substring(currentEntity.start, currentEntity.end);
      currentEntity.score = Math.min(currentEntity.score, token.score);
    } else {
      // Unexpected tag — flush
      if (currentEntity) {
        entities.push(currentEntity);
        currentEntity = null;
      }
    }
  }

  // Flush final entity
  if (currentEntity) entities.push(currentEntity);

  return entities;
}

/**
 * Full detection pipeline: Tier 1 (regex) + optional Tier 2 (NER).
 * @param {string} text - Input text
 * @param {Array|null} nerResults - NER results from Transformers.js (null if NER unavailable)
 * @returns {{ text: string, entities: Array, count: number }}
 */
export function detect(text, nerResults = null) {
  // Tier 1: regex
  const regexEntities = detectWithRegex(text);

  // Tier 2: NER (if available)
  const nerEntities = nerResults ? mapNerResults(nerResults, text) : [];

  // Merge both tiers
  const allEntities = [...regexEntities, ...nerEntities];

  // Anonymize (handles overlaps internally)
  return anonymize(text, allEntities);
}
