import type {
  ActionAssessment,
  AdmissionDecision,
  ActionPlan,
  HawkeyeRunState,
  LoadedPolicy,
  ScanReport,
} from '../../../src/index.js';

function inline(value: string): string {
  const longest = Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${value} ${fence}`;
}

function block(value: string): string {
  const longest = Math.max(3, ...[...value.matchAll(/`+/g)].map(match => match[0].length + 1));
  const fence = '`'.repeat(longest);
  return `${fence}\n${value}\n${fence}`;
}

function verdictLabel(verdict: AdmissionDecision['effectiveVerdict']): string {
  if (verdict === 'SAFE') return '✅ SAFE';
  if (verdict === 'BLOCKED') return '❌ BLOCKED';
  return '⚠️ UNKNOWN';
}

function nextActionSection(action: ActionPlan | null): string[] {
  if (!action) return ['## Next action', '', 'This workflow is complete.'];
  return [
    '## Next action',
    '',
    `**${action.kind}**${action.reason ? ` — ${action.reason}` : ''}`,
    ...(action.command ? ['', block(action.command)] : []),
  ];
}

export function renderAssessment(
  assessment: ActionAssessment,
  state: HawkeyeRunState,
  action: ActionPlan | null,
): string {
  if (assessment.applicability === 'not_applicable') {
    return [
      '# Hawkeye — action not assessed', '', assessment.reason, '',
      'Provide an explicit supported package-install command. No `SAFE` verdict was issued.',
    ].join('\n');
  }
  const decision = assessment.decision;
  const lines = [
    `# Hawkeye — ${verdictLabel(decision.effectiveVerdict)}`,
    '',
    `**Run:** ${inline(state.runId)} · **Policy:** ${inline(decision.policy.digest)}`,
    '',
    '## Packages',
    '',
    ...decision.packages.map(item =>
      `- ${inline(`${item.system}:${item.name}@${item.resolvedVersion ?? item.requestedVersion ?? 'latest'}`)}`
    ),
  ];

  if (decision.rawVerdict !== decision.effectiveVerdict) {
    lines.push('', `Raw verdict: **${decision.rawVerdict}** · Effective verdict: **${decision.effectiveVerdict}**`);
  }
  if (decision.findings.length > 0) {
    lines.push('', '## Findings', '', ...decision.findings.map(item =>
      `- **${item.effect.toUpperCase()} · ${item.severity}** — ${item.title}`
    ));
  }
  if (decision.errors.length > 0) {
    lines.push('', '## Evidence status', '', ...decision.errors.map(item =>
      `- **${item.retryability}** — ${item.message}`
    ));
  }
  if (decision.overrides.length > 0) {
    lines.push('', '## Governed exceptions', '', ...decision.overrides.map(item =>
      `- ${inline(`${item.name}@${item.version}`)} — ${item.reason}`
    ));
  }
  lines.push('', ...nextActionSection(action), '',
    '> Chat guidance does not bypass Hawkeye PreToolUse or shell enforcement.');
  return lines.join('\n');
}

export function renderStatus(state: HawkeyeRunState, action: ActionPlan | null): string {
  const decision = state.decisions[state.decisions.length - 1];
  return [
    '# Hawkeye workflow status', '',
    `- Run: ${inline(state.runId)}`,
    `- Phase: **${state.phase}**`,
    `- Assessment attempts: **${state.attempt}/${state.maxAttempts}**`,
    `- Latest verdict: **${decision?.effectiveVerdict ?? 'none'}**`,
    '',
    ...nextActionSection(action),
    '',
    '> The Harness coordinates work; enforcement remains authoritative.',
  ].join('\n');
}

export function renderExplanation(decision: AdmissionDecision): string {
  const blocking = decision.findings.filter(item => item.effect === 'blocking');
  const advisory = decision.findings.filter(item => item.effect === 'advisory');
  return [
    `# Why Hawkeye returned ${verdictLabel(decision.effectiveVerdict)}`,
    '',
    `Raw verdict: **${decision.rawVerdict}** · Effective verdict: **${decision.effectiveVerdict}**`,
    '',
    '## Blocking findings', '',
    ...(blocking.length ? blocking.map(item => `- **${item.severity}** — ${item.title}`) : ['None.']),
    '',
    '## Advisory findings', '',
    ...(advisory.length ? advisory.map(item => `- **${item.severity}** — ${item.title}`) : ['None.']),
    '',
    '## Operational uncertainty', '',
    ...(decision.errors.length ? decision.errors.map(item => `- ${item.message}`) : ['None.']),
    '',
    `Policy identity: ${inline(decision.policy.digest)}`,
  ].join('\n');
}

export function renderFix(action: ActionPlan | null): string {
  if (action?.kind !== 'TRY_VERIFIED_REMEDIATION' || !action.command) {
    return [
      '# No verified automatic remediation', '',
      'Hawkeye has not produced a verified remediation command for the current run.',
      'Use `/explain`, request a governed exception when configured, or choose another package.',
    ].join('\n');
  }
  return [
    '# Verified remediation', '',
    action.reason ?? 'This candidate passed normal Hawkeye admission checks.', '',
    block(action.command), '',
    '> This command has not been executed. Normal Hawkeye enforcement must recheck it before installation.',
  ].join('\n');
}

export function renderPolicy(loaded: LoadedPolicy): string {
  const { policy, ref, source } = loaded;
  return [
    '# Active Hawkeye policy', '',
    `- Organization: **${policy.organizationName}**`,
    `- Policy source: **${source.kind}**`,
    `- Policy digest: ${inline(ref.digest)}`,
    `- Minimum blocking severity: **${policy.minBlockingSeverity}**`,
    `- Block vulnerabilities: **${policy.blockVulnerabilities ? 'yes' : 'no'}**`,
    `- Block deprecated packages: **${policy.blockDeprecated ? 'yes' : 'no'}**`,
    `- Block typosquats: **${policy.blockTyposquats ?? true ? 'yes' : 'no'}**`,
    `- Blocked licenses: ${policy.blockedLicenses.length
      ? policy.blockedLicenses.map(inline).join(', ')
      : 'none'}`,
    `- Governed exception workflow: **${policy.exceptionFormUrl ? 'configured' : 'not configured'}**`,
  ].join('\n');
}

export function renderScan(report: ScanReport): string {
  const blocked = report.results.filter(item => item.verdict === 'BLOCKED');
  const unknown = report.results.filter(item => item.verdict === 'UNKNOWN');
  return [
    `# Workspace scan — ${verdictLabel(report.verdict)}`,
    '',
    `- Supported manifests found: **${report.manifests.length}**`,
    `- Dependencies assessed: **${report.results.length}**`,
    `- Blocked: **${blocked.length}**`,
    `- Unknown: **${unknown.length}**`,
    `- Weak integrity entries: **${report.weakIntegrity.length}**`,
    '',
    ...(blocked.length ? ['## Blocked', '', ...blocked.map(item =>
      `- ${inline(`${item.system}:${item.name}@${item.version}`)}`
    ), ''] : []),
    ...(unknown.length ? ['## Unknown', '', ...unknown.map(item =>
      `- ${inline(`${item.system}:${item.name}@${item.version}`)}`
    ), ''] : []),
    '_Project manifest scanning currently covers package.json/lockfiles and requirements.txt. Use `/check` for explicit commands in all seven supported ecosystems._',
  ].join('\n');
}

export function renderHelp(argument = ''): string {
  return [
    '# OSS Hawkeye', '',
    argument ? `I could not safely infer an ecosystem from ${inline(argument)}.` : 'Choose an operation:',
    '',
    '- `/check <explicit install command>`',
    '- `/scan`',
    '- `/explain`',
    '- `/fix`',
    '- `/policy`',
    '- `/status`',
    '',
    'Example: `/check npm install axios@1.7.2`',
  ].join('\n');
}

export function renderFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [
    '# ⚠️ Hawkeye could not verify this request', '',
    message, '',
    'No approval was issued and no dependency command was executed.',
  ].join('\n');
}
