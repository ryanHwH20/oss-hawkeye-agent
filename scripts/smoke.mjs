import { execSync } from 'node:child_process';

function run(cmd, label) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 5 });
    if (!out.includes('# Package Audit:')) {
      throw new Error(`${label} did not produce package audit output`);
    }
    return out;
  } catch (err) {
    const out = `${err?.stdout ?? ''}${err?.stderr ?? ''}`;
    if (!out.includes('# Package Audit:')) {
      throw new Error(`${label} failed without report output: ${String(err)}`);
    }
    // Non-zero is acceptable for blocked packages; smoke only validates report generation.
    return out;
  }
}

try {
  const cases = [
    { label: 'NPM express smoke', cmd: 'node dist/cli.js NPM express', expect: 'express@' },
    { label: 'PYPI numpy smoke', cmd: 'node dist/cli.js PYPI numpy', expect: 'numpy@' },
    {
      label: 'MAVEN spring-boot smoke',
      cmd: 'node dist/cli.js MAVEN org.springframework.boot:spring-boot 3.5.8',
      expect: 'org.springframework.boot:spring-boot@3.5.8',
    },
    {
      label: 'GO gin smoke',
      cmd: 'node dist/cli.js GO github.com/gin-gonic/gin',
      expect: 'github.com/gin-gonic/gin@',
    },
    {
      label: 'NUGET newtonsoft smoke',
      cmd: 'node dist/cli.js NUGET Newtonsoft.Json',
      expect: 'Newtonsoft.Json@',
    },
    { label: 'CARGO serde smoke', cmd: 'node dist/cli.js CARGO serde', expect: 'serde@' },
    { label: 'RUBYGEMS rake smoke', cmd: 'node dist/cli.js RUBYGEMS rake', expect: 'rake@' },
  ];

  for (const c of cases) {
    const out = run(c.cmd, c.label);
    if (!out.includes(c.expect)) {
      throw new Error(`${c.label} output missing expected marker: ${c.expect}`);
    }
  }

  console.log('Smoke tests passed.');
} catch (err) {
  console.error(`Smoke tests failed: ${String(err)}`);
  process.exit(1);
}
