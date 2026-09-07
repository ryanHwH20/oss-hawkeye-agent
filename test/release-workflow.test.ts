import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const workflowSource = readFileSync('.github/workflows/release.yml', 'utf8');
const workflow = parse(workflowSource);
const validate = workflow.jobs['validate-and-pack'];
const publish = workflow.jobs['publish-npm'];

function commands(job: { steps: Array<{ run?: string }> }): string {
  return job.steps.map(step => step.run ?? '').join('\n');
}

describe('release workflow trust boundary', () => {
  it('pins a trusted-publishing-compatible Node and npm toolchain', () => {
    expect(workflow.env.RELEASE_NODE_VERSION).toBe('24.15.0');
    expect(workflow.env.RELEASE_NPM_VERSION).toBe('11.12.1');
    expect(workflowSource).not.toContain('npm@latest');
    expect(workflowSource).toContain('package-manager-cache: false');
  });

  it('keeps OIDC permission out of validation', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(validate.permissions).toEqual({ contents: 'read' });
    expect(validate.permissions['id-token']).toBeUndefined();
  });

  it('runs the complete package and seven-ecosystem gates before upload', () => {
    const validateCommands = commands(validate);
    expect(validateCommands).toContain('npm test');
    expect(validateCommands).toContain('npm run check:package');
    expect(validateCommands).toContain('npm run check:setup');
    expect(validateCommands).toContain('npm run check:smoke');
    expect(validateCommands).toContain('npm run uat:pr7');
    expect(validateCommands).toContain('sha512sum -- *.tgz');
  });

  it('gives only the isolated publish job an OIDC token', () => {
    expect(publish.needs).toBe('validate-and-pack');
    expect(publish.environment).toBe('npm-production');
    expect(publish.permissions).toEqual({ contents: 'read', 'id-token': 'write' });

    const publishCommands = commands(publish);
    expect(publishCommands).not.toContain('npm ci');
    expect(publishCommands).not.toContain('npm run build');
    expect(publishCommands).toContain('sha512sum --check SHA512SUMS');
    expect(publishCommands).toContain('npm publish "${tarballs[0]}" --ignore-scripts --provenance --access public');
  });

  it('checks out only release identity without persisting GitHub credentials', () => {
    const checkout = publish.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'));
    expect(checkout.with['persist-credentials']).toBe(false);
  });

  it('pins every third-party action to a full commit SHA', () => {
    const uses = Object.values(workflow.jobs).flatMap((job: any) =>
      job.steps.map((step: { uses?: string }) => step.uses).filter(Boolean),
    );
    for (const action of uses) {
      expect(action).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
  });

  it('fails closed unless registry identity, integrity, and provenance match', () => {
    const publishCommands = commands(publish);
    expect(publishCommands).toContain('test "${git_head}" = "${GITHUB_SHA}"');
    expect(publishCommands).toContain('test "${integrity}" = "${expected_integrity}"');
    expect(publishCommands).toContain('https://slsa.dev/provenance/v1');
    expect(publishCommands).toContain('exit 1');
  });
});
