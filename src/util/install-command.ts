/** A single package coordinate to render in a package-manager command. */
export interface InstallEntry { name: string; version: string; }

function pkgToken(system: string, entry: InstallEntry): string {
  const version = entry.version;
  switch (system) {
    case 'PYPI': return version ? `${entry.name}==${version}` : entry.name;
    case 'GO': return version ? `${entry.name}@v${version.replace(/^v/, '')}` : entry.name;
    default: return version ? `${entry.name}@${version}` : entry.name;
  }
}

/** Build one copy-paste install command containing all installable entries. */
export function buildInstallCommand(system: string, entries: InstallEntry[], tool?: string): string {
  if (entries.length === 0) return '';
  switch (system) {
    case 'RUBYGEMS':
      return entries.map(e => e.version ? `gem install ${e.name} -v ${e.version}` : `gem install ${e.name}`).join('\n');
    case 'NUGET':
      return entries.map(e => e.version ? `dotnet add package ${e.name} --version ${e.version}` : `dotnet add package ${e.name}`).join('\n');
    case 'MAVEN':
      return entries.map(e => `mvn dependency:get -Dartifact=${e.name}${e.version ? ':' + e.version : ''}`).join('\n');
    case 'PYPI': return `pip install ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    case 'CARGO': return `cargo add ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    case 'GO': return `go get ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    case 'NPM': {
      const manager = (tool ?? 'npm').toLowerCase();
      const verb = manager === 'yarn' ? 'yarn add'
        : manager === 'pnpm' ? 'pnpm add'
          : manager === 'bun' ? 'bun add' : 'npm install';
      return `${verb} ${entries.map(e => pkgToken(system, e)).join(' ')}`;
    }
    default: return entries.map(e => pkgToken(system, e)).join(' ');
  }
}
