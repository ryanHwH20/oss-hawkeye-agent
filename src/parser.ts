/**
 * Parse package install commands into ecosystem + package list.
 */

interface ParsedCommand {
  system: string;
  packages: Array<{ name: string; version: string }>;
}

interface DetectResult {
  result: ParsedCommand;
}

const ECOSYSTEM_PATTERNS: Array<{
  regex: RegExp;
  system: string;
  extractor: (tokens: string[], matchIndex: number) => Array<{ name: string; version: string }>;
}> = [
  {
    // npm install pkg1 pkg2 | npm i pkg1@version
    regex: /^(?:npm|pnpm|yarn|bun)$/i,
    system: 'NPM',
    extractor: (tokens, idx) => {
      // skip the command verb (install, add, i)
      const verbs = ['install', 'i', 'add'];
      let start = idx + 1;
      // Require an explicit install verb — ignore `npm ci`, `npm test`, etc.
      if (!(start < tokens.length && verbs.includes(tokens[start].toLowerCase()))) return [];
      start++;
      const pkgs: Array<{ name: string; version: string }> = [];
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) continue; // skip flags
        // handle @scope/pkg@version or pkg@version
        const atIdx = t.lastIndexOf('@');
        if (atIdx > 0) {
          pkgs.push({ name: t.slice(0, atIdx), version: t.slice(atIdx + 1) });
        } else {
          pkgs.push({ name: t, version: '' });
        }
      }
      return pkgs;
    },
  },
  {
    // pip install pkg1 pkg2 | pip install pkg==1.0.0
    regex: /^pip[3]?$/i,
    system: 'PYPI',
    extractor: (tokens, idx) => {
      let start = idx + 1;
      if (!(start < tokens.length && tokens[start].toLowerCase() === 'install')) return [];
      start++;
      const pkgs: Array<{ name: string; version: string }> = [];
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) { if (t === '-r' || t === '--requirement') i++; continue; }
        // handle pkg==version, pkg>=version, pkg~=version
        const match = t.match(/^([a-zA-Z0-9_\-\.]+)(?:[=~<>!]+(.+))?$/);
        if (match) {
          pkgs.push({ name: match[1], version: match[2] ?? '' });
        }
      }
      return pkgs;
    },
  },
  {
    // cargo add pkg1 pkg2
    regex: /^cargo$/i,
    system: 'CARGO',
    extractor: (tokens, idx) => {
      let start = idx + 1;
      if (!(start < tokens.length && tokens[start].toLowerCase() === 'add')) return [];
      start++;
      const pkgs: Array<{ name: string; version: string }> = [];
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) continue;
        const atIdx = t.indexOf('@');
        if (atIdx > 0) {
          pkgs.push({ name: t.slice(0, atIdx), version: t.slice(atIdx + 1) });
        } else {
          pkgs.push({ name: t, version: '' });
        }
      }
      return pkgs;
    },
  },
  {
    // go get pkg@version
    regex: /^go$/i,
    system: 'GO',
    extractor: (tokens, idx) => {
      let start = idx + 1;
      if (!(start < tokens.length && tokens[start].toLowerCase() === 'get')) return [];
      start++;
      const pkgs: Array<{ name: string; version: string }> = [];
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith('-')) continue;
        const atIdx = t.lastIndexOf('@');
        if (atIdx > 0) {
          pkgs.push({ name: t.slice(0, atIdx), version: t.slice(atIdx + 1) });
        } else {
          pkgs.push({ name: t, version: '' });
        }
      }
      return pkgs;
    },
  },
  {
    // gem install pkg -v 1.2.3
    regex: /^gem$/i,
    system: 'RUBYGEMS',
    extractor: (tokens, idx) => {
      let start = idx + 1;
      if (!(start < tokens.length && tokens[start].toLowerCase() === 'install')) return [];
      start++;
      const pkgs: Array<{ name: string; version: string }> = [];
      for (let i = start; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '-v' || t === '--version') {
          const version = tokens[i + 1];
          if (version && pkgs.length > 0) pkgs[pkgs.length - 1].version = version;
          i++;
          continue;
        }
        if (t.startsWith('--version=') && pkgs.length > 0) {
          pkgs[pkgs.length - 1].version = t.slice('--version='.length);
          continue;
        }
        if (t.startsWith('-')) continue;
        pkgs.push({ name: t, version: '' });
      }
      return pkgs;
    },
  },
  {
    // dotnet add package PkgName --version 1.2.3
    regex: /^dotnet$/i,
    system: 'NUGET',
    extractor: (tokens, idx) => {
      let start = idx + 1;
      // dotnet add [project] package PkgName
      const addIdx = tokens.findIndex((token, tokenIndex) => tokenIndex >= start && token.toLowerCase() === 'add');
      const pkgIdx = tokens.findIndex((token, tokenIndex) => tokenIndex > addIdx && token.toLowerCase() === 'package');
      if (addIdx === -1 || pkgIdx === -1) return [];
      start = pkgIdx + 1;
      const name = tokens[start];
      if (!name || name.startsWith('-')) return [];
      let version = '';
      for (let i = start + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t === '-v' || t === '--version') {
          version = tokens[i + 1] ?? '';
          i++;
        } else if (t.startsWith('--version=')) {
          version = t.slice('--version='.length);
        }
      }
      return [{ name, version }];
    },
  },
  {
    // mvn dependency:get -Dartifact=group:artifact:version
    regex: /^mvn$/i,
    system: 'MAVEN',
    extractor: (tokens, idx) => {
      const pkgs: Array<{ name: string; version: string }> = [];
      for (let i = idx + 1; i < tokens.length; i++) {
        const t = tokens[i];
        const match = t.match(/^-Dartifact=(.+)$/);
        if (match) {
          const parts = match[1].split(':');
          if (parts.length >= 2) {
            const name = `${parts[0]}:${parts[1]}`;
            const version = parts[2] ?? '';
            pkgs.push({ name, version });
          }
        }
      }
      return pkgs;
    },
  },
];

export function detectAndParse(tokens: string[]): DetectResult | null {
  for (let i = 0; i < tokens.length; i++) {
    for (const pattern of ECOSYSTEM_PATTERNS) {
      if (pattern.regex.test(tokens[i])) {
        const packages = pattern.extractor(tokens, i);
        if (packages.length > 0) {
          return { result: { system: pattern.system, packages } };
        }
      }
    }
  }
  return null;
}
