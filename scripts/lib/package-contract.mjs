export const REQUIRED_PACKAGE_FILES = Object.freeze([
  'package.json',
  'dist/cli.js',
  'dist/index.js',
  'adapters/claude-code.mjs',
  'adapters/lib/gate.mjs',
  'adapters/mcp/launcher.mjs',
  'adapters/mcp/dist/server.js',
  'policy.json',
  'SKILL.md',
  'skills/oss-hawkeye/SKILL.md',
  'docs/AGENT-HARNESS.md',
  'docs/INTEGRATIONS.md',
  'docs/UAT-PR7.md',
]);

export function missingPackageFiles(files) {
  const paths = new Set(files.map(file => typeof file === 'string' ? file : file.path));
  return REQUIRED_PACKAGE_FILES.filter(path => !paths.has(path));
}

export function assertPackageFiles(files) {
  const missing = missingPackageFiles(files);
  if (missing.length > 0) {
    throw new Error(`npm package is missing required artifacts:\n${missing.map(path => `- ${path}`).join('\n')}`);
  }
}
