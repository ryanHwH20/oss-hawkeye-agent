import { z } from 'zod';

export const MAX_COMMAND_BYTES = 16 * 1024;
export const MAX_STATE_BYTES = 1024 * 1024;
export const MAX_RESULT_BYTES = 256 * 1024;
export const MAX_STDIO_MESSAGE_BYTES = 2 * 1024 * 1024;

const coordinateSchema = z.object({
  system: z.string().min(1),
  name: z.string().min(1),
  requestedVersion: z.string().optional(),
  resolvedVersion: z.string().optional(),
}).strict();

const intentSchema = z.object({
  kind: z.literal('shell_command'),
  command: z.string(),
  cwd: z.string().optional(),
}).strict();

const policyRefSchema = z.object({
  id: z.string().optional(),
  digest: z.string().min(1),
}).strict();

export const actionPlanSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'ASSESS', 'EXECUTE_ALLOWED_ACTION', 'TRY_VERIFIED_REMEDIATION', 'RETRY',
    'REQUEST_HUMAN_APPROVAL', 'EXPLAIN', 'STOP',
  ]),
  command: z.string().optional(),
  package: coordinateSchema.optional(),
  reason: z.string().optional(),
  expectedResult: z.string().min(1),
  retryAfterMs: z.number().nonnegative().optional(),
}).strict();

const findingSchema = z.object({
  id: z.string().min(1),
  subject: coordinateSchema,
  category: z.enum([
    'LICENSE', 'VULNERABILITY', 'SCORECARD', 'SBOM_LICENSE',
    'SBOM_VULNERABILITY', 'TYPOSQUAT', 'MALWARE',
  ]),
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  effect: z.enum(['blocking', 'advisory']),
  title: z.string().min(1),
  details: z.array(z.string()),
  explanation: z.string(),
  affectedDependency: z.string().optional(),
  dependencyPath: z.array(z.string()).optional(),
  fixedVersions: z.array(z.string()).optional(),
}).strict();

const evidenceSchema = z.object({
  id: z.string().min(1),
  subject: coordinateSchema,
  type: z.enum([
    'vulnerability', 'malware', 'license', 'dependency',
    'scorecard', 'typosquat', 'source_failure',
  ]),
  source: z.string().min(1),
  trust: z.enum(['authoritative', 'heuristic', 'asserted']),
  status: z.enum(['available', 'unavailable', 'not_found', 'unsupported']),
  uri: z.string().optional(),
}).strict();

const operationalErrorSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['EVIDENCE_UNAVAILABLE', 'SUBJECT_NOT_FOUND', 'UNSUPPORTED_CAPABILITY', 'INTERNAL_ERROR']),
  source: z.enum(['osv', 'deps.dev', 'scorecard', 'hawkeye']).optional(),
  retryability: z.enum(['retryable', 'non_retryable', 'unknown']),
  decisionImpact: z.enum(['UNKNOWN', 'ADVISORY_ONLY']),
  message: z.string().min(1),
}).strict();

const overrideSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  originalVerdict: z.enum(['SAFE', 'BLOCKED', 'UNKNOWN']),
  reason: z.string().min(1),
  approvedBy: z.string().optional(),
}).strict();

const remediationSchema = z.object({
  system: z.string().min(1),
  name: z.string().min(1),
  current: z.string().min(1),
  action: z.enum(['upgrade', 'find-alternative', 'verify']),
  recommendedVersion: z.string().nullable(),
  fix: z.string().nullable(),
  verified: z.boolean().optional(),
  reason: z.string().min(1),
}).strict();

const decisionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  subject: intentSchema,
  packages: z.array(coordinateSchema),
  rawVerdict: z.enum(['SAFE', 'BLOCKED', 'UNKNOWN']),
  effectiveVerdict: z.enum(['SAFE', 'BLOCKED', 'UNKNOWN']),
  findings: z.array(findingSchema),
  evidence: z.array(evidenceSchema),
  errors: z.array(operationalErrorSchema),
  overrides: z.array(overrideSchema),
  remediation: z.array(remediationSchema),
  policy: policyRefSchema,
  decidedAt: z.iso.datetime(),
}).strict();

export const actionAssessmentSchema = z.discriminatedUnion('applicability', [
  z.object({
    schemaVersion: z.literal(1),
    applicability: z.literal('applicable'),
    decision: decisionSchema,
    nextAction: actionPlanSchema,
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    applicability: z.literal('not_applicable'),
    subject: intentSchema,
    reason: z.string().min(1),
  }).strict(),
]);

export const actionResultSchema = z.discriminatedUnion('kind', [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('ASSESSMENT_COMPLETED'),
    assessment: actionAssessmentSchema,
    completedAt: z.iso.datetime(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('EXECUTION_COMPLETED'),
    command: z.string(),
    status: z.enum(['succeeded', 'failed']),
    exitCode: z.number().int(),
    completedAt: z.iso.datetime(),
    error: z.string().optional(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('RETRY_COMPLETED'),
    completedAt: z.iso.datetime(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('APPROVAL_REQUESTED'),
    completedAt: z.iso.datetime(),
    externalReference: z.string().optional(),
  }).strict(),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal('STOPPED'),
    completedAt: z.iso.datetime(),
    reason: z.string().optional(),
  }).strict(),
]);

export const runStateSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  intent: intentSchema,
  policy: policyRefSchema,
  decisions: z.array(decisionSchema),
  remediationCandidates: z.array(remediationSchema),
  phase: z.enum([
    'pending_assessment', 'blocked', 'unknown', 'awaiting_approval',
    'ready_to_execute', 'completed', 'failed',
  ]),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  actionHistory: z.array(z.object({
    action: actionPlanSchema,
    result: actionResultSchema,
  }).strict()),
  approvals: z.array(z.object({
    actionId: z.string().min(1),
    status: z.literal('requested'),
    requestedAt: z.iso.datetime(),
    externalReference: z.string().optional(),
  }).strict()),
  pendingAction: actionPlanSchema.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  terminalReason: z.string().optional(),
  error: z.object({
    message: z.string().min(1),
    actionId: z.string().optional(),
  }).strict().optional(),
}).strict();

export const checkActionInputSchema = z.object({
  command: z.string().min(1).max(MAX_COMMAND_BYTES),
  maxAttempts: z.number().int().min(1).max(10).optional(),
}).strict();

export const nextActionInputSchema = z.object({ state: runStateSchema }).strict();

export const submitResultInputSchema = z.object({
  state: runStateSchema,
  actionId: z.string().min(1).max(512),
  result: actionResultSchema,
}).strict();

export const toolOutputSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['SAFE', 'BLOCKED', 'UNKNOWN', 'NOT_APPLICABLE', 'WORKFLOW']),
  summary: z.string(),
  state: runStateSchema,
  nextAction: actionPlanSchema.nullable(),
  assessment: actionAssessmentSchema.optional(),
}).strict();
