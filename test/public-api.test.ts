import { describe, expect, it } from 'vitest';
import {
  assessAction,
  assessPackage,
  checkPackage,
  checkPackages,
  collectPackageEvidence,
  evaluatePackage,
  loadPolicyWithMetadata,
  policyDigest,
} from '../src/index.js';

describe('public package API', () => {
  it('retains the checker exports while adding the canonical action API', () => {
    expect(checkPackage).toBeTypeOf('function');
    expect(checkPackages).toBeTypeOf('function');
    expect(assessAction).toBeTypeOf('function');
    expect(assessPackage).toBeTypeOf('function');
    expect(collectPackageEvidence).toBeTypeOf('function');
    expect(evaluatePackage).toBeTypeOf('function');
    expect(loadPolicyWithMetadata).toBeTypeOf('function');
    expect(policyDigest).toBeTypeOf('function');
  });
});
