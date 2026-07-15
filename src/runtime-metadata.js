'use strict';

const {
  BLOCKED_REASONS,
  normalizeClassification,
  normalizeOrphanReason,
  normalizeProvider,
  sanitizePatternName,
} = require('./runtime-vocabulary');

const CONFIDENCE_LEVELS = new Set(['low', 'medium', 'high']);

function toPublicRuntimeMetadata(candidate = {}) {
  const explicitlyEligible = candidate.cleanupEligible === true;
  const classification = normalizeClassification(
    candidate.classification,
    explicitlyEligible ? 'confirmed-stale' : 'unattributed'
  );
  const cleanupEligible = explicitlyEligible && classification === 'confirmed-stale';
  const blockedReasons = cleanupEligible ? [] : sanitizeBlockedReasons(candidate.blockedReasons);
  if (!cleanupEligible && blockedReasons.length === 0) {
    blockedReasons.push('classification-incomplete');
  }
  return {
    provider: normalizeProvider(candidate.provider),
    classification,
    confidence: normalizeConfidence(candidate.confidence),
    evidence: sanitizeEvidence(candidate.evidence),
    cleanupEligible,
    blockedReasons,
  };
}

function normalizeConfidence(value) {
  const numericScore = Number(value?.score);
  const score = Number.isFinite(numericScore)
    ? Math.max(0, Math.min(100, Math.round(numericScore)))
    : 0;
  const requestedLevel = String(value?.level ?? '').trim().toLowerCase();
  const level = CONFIDENCE_LEVELS.has(requestedLevel)
    ? requestedLevel
    : score >= 85 ? 'high' : score >= 55 ? 'medium' : 'low';
  return { score, level };
}

function sanitizeEvidence(values) {
  const sanitized = [];
  for (const item of Array.isArray(values) ? values : []) {
    const value = String(item ?? '').trim().toLowerCase();
    if (value === 'age-grace-met' || value === 'start-time:verified') {
      sanitized.push(value);
    } else if (value.startsWith('runtime-pattern:')) {
      sanitized.push(`runtime-pattern:${sanitizePatternName(value.slice(16))}`);
    } else if (value.startsWith('provider-pattern:')) {
      sanitized.push(`provider-pattern:${sanitizePatternName(value.slice(17))}`);
    } else if (value.startsWith('provider:')) {
      sanitized.push(`provider:${normalizeProvider(value.slice(9))}`);
    } else if (value === 'provider-context:built-in-ai-dir' || value === 'provider-context:custom-ai-dir') {
      sanitized.push(value);
    } else if (value.startsWith('orphan:')) {
      sanitized.push(`orphan:${normalizeOrphanReason(value.slice(7))}`);
    }
  }
  return [...new Set(sanitized)];
}

function sanitizeBlockedReasons(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter((value) => BLOCKED_REASONS.has(value)))];
}

module.exports = {
  normalizeConfidence,
  sanitizeBlockedReasons,
  sanitizeEvidence,
  toPublicRuntimeMetadata,
};
