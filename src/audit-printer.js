'use strict';

const { c, bold, formatBytes, formatDuration } = require('./reporter');
const { normalizeProvider, toPublicRuntimeMetadata } = require('./runtime-classifier');

function reportAudit(report, options = {}) {
  const commandName = options.commandName || 'audit';
  console.log(bold(`\n  zclean ${commandName}`) + c('gray', ' - AI runtime hygiene review\n'));
  console.log(`  Score:       ${formatRiskScore(report.risk)}`);
  console.log(`  Status:      ${report.summary.status}`);
  console.log(`  Candidates:  ${report.summary.zombieCount} (${report.summary.eligibleCount || 0} eligible, ${report.summary.blockedCount || 0} blocked)`);
  console.log(`  Memory:      ${formatBytes(report.summary.reclaimableBytes)} reclaimable`);
  console.log('  Scope:       AI coding runtime hygiene plus safe workspace caches; not app uninstall or whole-disk cleanup');
  console.log();

  console.log(c('cyan', '  Safety'));
  console.log(`    Manual scans are dry-run: ${report.proGradeReview.guardrails.dryRunDefault ? 'yes' : 'configured false, but --yes is still required'}`);
  console.log(`    Cleanup requires --yes:  ${report.proGradeReview.guardrails.cleanupRequiresYes ? 'yes' : 'no'}`);
  console.log(`    Whitelist entries:       ${report.proGradeReview.guardrails.whitelistCount}`);
  console.log(`    Custom AI dirs:          ${report.proGradeReview.guardrails.customAiDirCount}`);
  console.log(`    Telemetry:               none`);
  console.log();

  if (!report.risk.enumerationComplete) {
    console.log(c('red', '  Enumeration incomplete'));
    for (const error of report.diagnostics.errors) {
      console.log(`    ${formatDiagnostic(error)}`);
    }
    console.log();
  }

  if (report.diagnostics.warnings.length > 0) {
    console.log(c('yellow', '  Warnings'));
    for (const warning of report.diagnostics.warnings) {
      console.log(`    ${formatDiagnostic(warning)}`);
    }
    console.log();
  }

  if (report.proGradeReview.candidates.length > 0) {
    console.log(c('cyan', '  Top candidates'));
    for (const item of report.proGradeReview.topCandidates.slice(0, 5)) {
      const runtime = toPublicRuntimeMetadata(item);
      console.log(`    PID ${String(item.pid).padStart(6)}  ${runtime.provider.padEnd(12)}  ${runtime.classification.padEnd(15)}  ${formatBytes(item.memoryBytes).padStart(8)}  ${formatDuration(item.ageMs).padStart(6)}`);
      console.log(`      confidence: ${runtime.confidence.level} (${runtime.confidence.score}/100)`);
      console.log(`      evidence: ${runtime.evidence.join(', ') || 'none'}`);
      if (!runtime.cleanupEligible) {
        console.log(`      blocked: ${runtime.blockedReasons.join(', ')}`);
      }
    }
    console.log();
  }

  console.log(c('cyan', '  Recent history'));
  console.log(`    This week:  ${report.history.weekKilled} cleaned, ${formatBytes(report.history.weekMemFreed)} freed`);
  console.log(`    All time:   ${report.history.totalKilled} cleaned, ${formatBytes(report.history.totalMemFreed)} freed`);
  console.log(`    Last run:   ${report.history.lastRun || 'never'}`);
  console.log(`    Last dry-run: ${report.history.lastDryRun || 'never'}`);
  console.log(`    Recent failures: ${report.history.recentFailures.length}`);
  console.log();

  console.log(c('cyan', '  Positioning'));
  console.log(`    ${report.differentiation}`);
  console.log();

  console.log(c('cyan', '  Recommendations'));
  for (const action of report.nextActions) {
    const command = action.command ? ` (${action.command})` : '';
    console.log(`    - [${action.priority}] ${action.description}${command}`);
  }
  console.log();
}

function formatRiskScore(risk) {
  const text = `${risk.score}/100 (${risk.level})`;
  if (risk.level === 'clean' || risk.level === 'watch') return c('green', text);
  if (risk.level === 'unknown') return c('red', text);
  return c('yellow', text);
}

function formatDiagnostic(item) {
  if (!item || typeof item !== 'object') return 'scan diagnostic';
  const code = /^[a-z0-9-]{1,64}$/i.test(String(item.code || ''))
    ? String(item.code).toLowerCase()
    : 'scan-diagnostic';
  const providers = Array.isArray(item.providers)
    ? [...new Set(item.providers.map(normalizeProvider))]
    : item.provider ? [normalizeProvider(item.provider)] : [];
  const suffix = providers.length > 0 ? ` (providers: ${providers.join(', ')})` : '';
  return `${code}: process scan diagnostic${suffix}`;
}

module.exports = {
  reportAudit,
};
