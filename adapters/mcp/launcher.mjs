#!/usr/bin/env node

const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
if (major < 20) {
  console.error('hawkeye-mcp requires Node.js 20 or newer. The main Hawkeye CLI remains compatible with Node.js 18.');
  process.exit(1);
}

await import('./dist/server.js');
