import { describe, it, expect } from 'vitest';
import { detectAndParse } from '../src/parser.js';

const parse = (cmd: string) => detectAndParse(cmd.split(/\s+/));

describe('detectAndParse (issue #10)', () => {
  it('parses npm install with versions, scopes, and flags', () => {
    const r = parse('npm install lodash express@4.17.1 @scope/pkg@2.0.0 -D');
    expect(r?.result.system).toBe('NPM');
    expect(r?.result.packages).toEqual([
      { name: 'lodash', version: '' },
      { name: 'express', version: '4.17.1' },
      { name: '@scope/pkg', version: '2.0.0' },
    ]);
  });

  it('parses pip install with == version specifiers', () => {
    const r = parse('pip install requests==2.31.0 flask');
    expect(r?.result.system).toBe('PYPI');
    expect(r?.result.packages).toEqual([
      { name: 'requests', version: '2.31.0' },
      { name: 'flask', version: '' },
    ]);
  });

  it('parses go get with an @version', () => {
    const r = parse('go get github.com/gin-gonic/gin@v1.9.0');
    expect(r?.result.system).toBe('GO');
    expect(r?.result.packages).toEqual([{ name: 'github.com/gin-gonic/gin', version: 'v1.9.0' }]);
  });

  it('parses cargo add and dotnet add package', () => {
    expect(parse('cargo add serde')?.result).toEqual({ system: 'CARGO', packages: [{ name: 'serde', version: '' }] });
    expect(parse('dotnet add package Newtonsoft.Json')?.result).toEqual({
      system: 'NUGET',
      packages: [{ name: 'Newtonsoft.Json', version: '' }],
    });
  });

  it('parses mvn -Dartifact into group:artifact + version', () => {
    const r = parse('mvn dependency:get -Dartifact=org.springframework.boot:spring-boot:3.5.8');
    expect(r?.result.system).toBe('MAVEN');
    expect(r?.result.packages).toEqual([{ name: 'org.springframework.boot:spring-boot', version: '3.5.8' }]);
  });

  it('returns null for a non-install command', () => {
    expect(parse('ls -la')).toBeNull();
  });

  it('ignores package-manager commands that are not installs', () => {
    // These must NOT be treated as installing packages named ci/test/build/etc.
    expect(parse('npm ci')).toBeNull();
    expect(parse('npm test')).toBeNull();
    expect(parse('npm run build')).toBeNull();
    expect(parse('pip freeze')).toBeNull();
    expect(parse('go build ./...')).toBeNull();
    expect(parse('cargo build')).toBeNull();
  });
});
