'use strict';

function buildRecommendations({
  zombieCount,
  eligibleCount = 0,
  blockedCount = 0,
  enumerationComplete = true,
  errors,
  warnings,
  commandName,
}) {
  if (errors.length > 0) {
    return [
      'Run `zclean doctor` before cleaning; process enumeration is incomplete.',
      `Do not trust a zero-candidate ${commandName} until enumeration errors are resolved.`,
    ];
  }

  const recommendations = [];
  if (zombieCount > 0) {
    recommendations.push('Review the classified runtime candidates and their evidence before cleanup.');
    if (enumerationComplete && eligibleCount > 0) {
      recommendations.push(`Run \`zclean --yes\` only for the ${eligibleCount} confirmed eligible candidate${eligibleCount === 1 ? '' : 's'}.`);
    } else {
      recommendations.push(`No cleanup command is recommended; ${blockedCount || zombieCount} candidate${(blockedCount || zombieCount) === 1 ? '' : 's'} remain blocked by safety gates.`);
    }
  } else {
    recommendations.push('No AI runtime leftovers are currently visible.');
  }
  if (warnings.length > 0) {
    recommendations.push('Review scan warnings; some candidates may need manual attribution.');
  }
  recommendations.push(`Use \`zclean ${commandName} --json\` for dashboards, CI notes, or local automation.`);
  return recommendations;
}

function buildNextActions({
  zombieCount,
  eligibleCount = 0,
  blockedCount = 0,
  enumerationComplete = true,
  errors,
  warnings,
  commandName,
}) {
  if (errors.length > 0) {
    return [
      {
        id: 'run-doctor',
        priority: 'high',
        command: 'zclean doctor',
        description: 'Fix process enumeration before trusting the report.',
      },
      {
        id: 'avoid-cleanup',
        priority: 'high',
        command: null,
        description: `Do not run cleanup from this ${commandName} result while enumeration is incomplete.`,
      },
    ];
  }

  const actions = [];
  if (zombieCount > 0) {
    actions.push({
      id: 'review-top-candidates',
      priority: 'high',
      command: null,
      description: 'Review topCandidates, largestCandidate, and oldestCandidate before cleanup.',
    });
    if (enumerationComplete && eligibleCount > 0) {
      actions.push({
        id: 'manual-cleanup-requires-yes',
        priority: 'high',
        command: 'zclean --yes',
        description: `Cleanup remains opt-in for ${eligibleCount} eligible candidate${eligibleCount === 1 ? '' : 's'} and requires an explicit --yes run.`,
      });
    }
    if (blockedCount > 0) {
      actions.push({
        id: 'review-blocked-candidates',
        priority: 'normal',
        command: null,
        description: `${blockedCount} candidate${blockedCount === 1 ? '' : 's'} remain blocked by classification safety gates.`,
      });
    }
  } else {
    actions.push({
      id: 'monitor-runtime-hygiene',
      priority: 'normal',
      command: `zclean ${commandName}`,
      description: 'No AI runtime leftovers are visible; rerun the report when sessions change.',
    });
  }

  if (warnings.length > 0) {
    actions.push({
      id: 'review-warnings',
      priority: 'normal',
      command: null,
      description: 'Review scan warnings before making cleanup decisions.',
    });
  }

  actions.push({
    id: 'export-json',
    priority: 'low',
    command: `zclean ${commandName} --json`,
    description: 'Use the JSON report for local dashboards, CI notes, or automation.',
  });
  return actions;
}

module.exports = {
  buildNextActions,
  buildRecommendations,
};
