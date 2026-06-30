'use strict';

function buildCandidateReview(item) {
  const memory = item.mem || 0;
  const age = item.age || 0;
  const riskScore = Math.min(100, 30 + Math.floor(memory / (100 * 1024 * 1024)) * 5 + Math.floor(age / 3600000));
  return {
    pid: item.pid,
    name: item.name || item.pattern || 'unknown',
    pattern: item.pattern || item.name || 'unknown',
    memoryBytes: memory,
    ageMs: age,
    reason: item.reason || '',
    risk: {
      score: riskScore,
      level: riskScore >= 75 ? 'high' : riskScore >= 50 ? 'medium' : 'low',
    },
  };
}

function groupCandidatesByPattern(candidates) {
  const grouped = {};
  for (const candidate of candidates) {
    grouped[candidate.pattern] = (grouped[candidate.pattern] || 0) + 1;
  }
  return grouped;
}

function groupCandidateSourcesByPattern(candidates) {
  const grouped = {};
  for (const candidate of candidates) {
    const pattern = candidate.pattern;
    if (!grouped[pattern]) {
      grouped[pattern] = {
        count: 0,
        memoryBytes: 0,
        pids: [],
      };
    }
    grouped[pattern].count++;
    grouped[pattern].memoryBytes += candidate.memoryBytes;
    grouped[pattern].pids.push(candidate.pid);
  }
  return grouped;
}

function sortCandidatesByRisk(candidates) {
  return [...candidates].sort((left, right) => {
    if (right.risk.score !== left.risk.score) return right.risk.score - left.risk.score;
    if (right.memoryBytes !== left.memoryBytes) return right.memoryBytes - left.memoryBytes;
    if (right.ageMs !== left.ageMs) return right.ageMs - left.ageMs;
    return (left.pid || 0) - (right.pid || 0);
  });
}

function pickCandidate(candidates, field) {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) => {
    if (candidate[field] > best[field]) return candidate;
    if (candidate[field] === best[field] && (candidate.pid || 0) < (best.pid || 0)) return candidate;
    return best;
  });
}

function calculateScore(candidates, warnings, errors) {
  if (errors.length > 0) return 0;
  const candidatePenalty = candidates.reduce((sum, item) => sum + Math.min(20, Math.ceil(item.risk.score / 10)), 0);
  const warningPenalty = warnings.length * 5;
  return Math.max(0, 100 - candidatePenalty - warningPenalty);
}

function riskLevel(candidateCount, warningCount) {
  if (candidateCount === 0 && warningCount === 0) return 'clean';
  if (candidateCount <= 2 && warningCount === 0) return 'watch';
  return 'attention';
}

module.exports = {
  buildCandidateReview,
  calculateScore,
  groupCandidateSourcesByPattern,
  groupCandidatesByPattern,
  pickCandidate,
  riskLevel,
  sortCandidatesByRisk,
};
