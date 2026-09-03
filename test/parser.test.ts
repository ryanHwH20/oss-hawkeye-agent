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

  it.each([
    ['npm', 'npm install lodash@4.17.21', 'NPM', 'lodash', '4.17.21'],
    ['pnpm', 'pnpm add zod@3.23.8', 'NPM', 'zod', '3.23.8'],
    ['yarn', 'yarn add react@18.3.1', 'NPM', 'react', '18.3.1'],
    ['bun', 'bun add hono@4.5.0', 'NPM', 'hono', '4.5.0'],
    ['PyPI', 'pip install requests==2.32.3', 'PYPI', 'requests', '2.32.3'],
    ['Cargo', 'cargo add serde@1.0.204', 'CARGO', 'serde', '1.0.204'],
    ['Go', 'go get github.com/gin-gonic/gin@v1.10.0', 'GO', 'github.com/gin-gonic/gin', 'v1.10.0'],
    ['RubyGems', 'gem install rails -v 7.1.3', 'RUBYGEMS', 'rails', '7.1.3'],
    ['NuGet', 'dotnet add package Newtonsoft.Json --version 13.0.3', 'NUGET', 'Newtonsoft.Json', '13.0.3'],
    ['Maven', 'mvn dependency:get -Dartifact=org.springframework.boot:spring-boot:3.5.8', 'MAVEN', 'org.springframework.boot:spring-boot', '3.5.8'],
  ])('parses an explicit %s package version', (_label, command, system, name, version) => {
    expect(parse(command)?.result).toEqual({ system, packages: [{ name, version }] });
  });

  it('supports the alternate version flags for RubyGems and NuGet', () => {
    expect(parse('gem install rails --version=7.1.3')?.result.packages[0].version).toBe('7.1.3');
    expect(parse('dotnet add package Newtonsoft.Json -v 13.0.3')?.result.packages[0].version).toBe('13.0.3');
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
    expect(parse('dotnet remove package Newtonsoft.Json')).toBeNull();
  });
});
