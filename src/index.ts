// Existing package API — retained when package.json moves from checker.js to
// this explicit public entrypoint.
export { checkPackage, checkPackages } from './checker.js';
export type { CheckResult, Policy, Verdict, Violation } from './types.js';

// Canonical agent-facing API.
export { assessAction } from './runtime/assess-action.js';
export type { AssessActionOptions } from './runtime/assess-action.js';
export { assessPackage } from './runtime/assess-package.js';
export type { PackageAssessment } from './runtime/assess-package.js';
export { collectPackageEvidence } from './runtime/collect-package-evidence.js';
export type { CollectPackageEvidenceOptions } from './runtime/collect-package-evidence.js';
export { evaluatePackage } from './core/evaluate-package.js';
export { loadPolicy, loadPolicyWithMetadata } from './policy.js';
export type { LoadedPolicy } from './policy.js';
export { scanProject } from './scan/scan.js';
export type { ScanReport } from './scan/scan.js';
export { policyDigest } from './core/policy-ref.js';
export type { ActionPlan, ActionKind } from './core/action.js';
export type {
  ActionAssessment,
  AdmissionDecision,
  AppliedOverride,
} from './core/decision.js';
export type { EvidenceRef, EvidenceStatus, EvidenceTrust, EvidenceType } from './core/evidence.js';
export type {
  CollectedEvidence,
  DependencyPackageEvidence,
  EvidenceProvenance,
  PackageEvidence,
  PackageEvidenceRequest,
} from './evidence/package-evidence.js';
export type { HawkeyeError, HawkeyeErrorKind, Retryability } from './core/errors.js';
export type { Finding, FindingEffect } from './core/finding.js';
export type { ActionIntent, PackageCoordinate, ShellCommandIntent } from './core/intent.js';
export type { PolicyRef } from './core/policy-ref.js';
export type { RemediationAction, RemediationCandidate } from './core/remediation.js';

// Deterministic, resumable Agent Harness workflow.
export { createRun } from './harness/create-run.js';
export type { CreateRunOptions } from './harness/create-run.js';
export { HarnessError } from './harness/errors.js';
export type { HarnessErrorCode } from './harness/errors.js';
export { nextAction } from './harness/planner.js';
export { submitResult } from './harness/reducer.js';
export type {
  ActionResult,
  ApprovalRequestedResult,
  AssessmentCompletedResult,
  ExecutionCompletedResult,
  RetryCompletedResult,
  StoppedResult,
} from './harness/result.js';
export type {
  ActionRecord,
  ApprovalRecord,
  HawkeyeRunPhase,
  HawkeyeRunState,
  RunError,
} from './harness/state.js';
