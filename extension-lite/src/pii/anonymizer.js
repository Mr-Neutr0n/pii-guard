/**
 * PII Guard Lite — Anonymizer
 *
 * Replaces detected PII entities with typed tokens like <PERSON>, <EMAIL_ADDRESS>.
 * Handles overlapping entities by keeping the higher-scoring one.
 */

/**
 * @typedef {Object} DetectedEntity
 * @property {string} entity_type - e.g. "EMAIL_ADDRESS", "PERSON"
 * @property {number} start - Start offset in original text
 * @property {number} end - End offset in original text
 * @property {number} score - Confidence score (0-1)
 * @property {string} original_text - The matched text
 */

/**
 * Remove overlapping entities, keeping the higher-scoring one.
 * If scores are equal, keep the longer match.
 * @param {DetectedEntity[]} entities
 * @returns {DetectedEntity[]}
 */
export function resolveOverlaps(entities) {
  if (entities.length <= 1) return entities;

  // Sort by start position, then by score descending
  const sorted = [...entities].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return b.score - a.score;
  });

  const result = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = result[result.length - 1];
    const curr = sorted[i];

    if (curr.start < prev.end) {
      // Overlap — keep the higher scoring one
      if (curr.score > prev.score || (curr.score === prev.score && (curr.end - curr.start) > (prev.end - prev.start))) {
        result[result.length - 1] = curr;
      }
      // Otherwise keep prev (already in result)
    } else {
      result.push(curr);
    }
  }

  return result;
}

/**
 * Replace detected entities in text with <TYPE> tokens.
 * Entities must be non-overlapping and sorted by start position.
 * @param {string} text - Original text
 * @param {DetectedEntity[]} entities - Detected entities (will be deduplicated)
 * @returns {{ text: string, entities: DetectedEntity[], count: number }}
 */
export function anonymize(text, entities) {
  if (!entities || entities.length === 0) {
    return { text, entities: [], count: 0 };
  }

  const resolved = resolveOverlaps(entities);

  // Replace from end to start to preserve offsets
  let result = text;
  const manifest = [];

  for (let i = resolved.length - 1; i >= 0; i--) {
    const e = resolved[i];
    const token = `<${e.entity_type}>`;
    result = result.substring(0, e.start) + token + result.substring(e.end);
    manifest.unshift({
      entity_type: e.entity_type,
      start: e.start,
      end: e.start + token.length,
      score: e.score,
      original_text: e.original_text,
      new_value: token,
    });
  }

  return { text: result, entities: manifest, count: manifest.length };
}
