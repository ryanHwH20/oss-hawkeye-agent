import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadPolicy } from './policy.js';
import { checkPackage, checkPackages } from './checker.js';
import { detectAndParse } from './parser.js';
import { formatResult, formatCommandVerdict, hawkeyeHeader } from './formatter.js';

const policy = loadPolicy();

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    // PRD §4 — Primary tool: inspect_package
    name: 'inspect_package',
    description: [
      '【Hawkeye Agent】Enterprise-grade open source security guardrail.',
      'Evaluates open source package security, health, license compliance, and generates SBOMs.',
      'Provides indisputable security judgments and automated remediation snippets.',
      'Invoke this when a user asks if a package is safe, or types npm install / pip install commands.',
      'Returns: License compliance, CVE vulnerabilities (with CVSS), OpenSSF Scorecard, SBOM, and remediation strategies.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        ecosystem: {
          type: 'string',
          description: '套件生態系，例如 npm, pypi, go, cargo, rubygems, nuget, maven',
          enum: ['NPM', 'PYPI', 'CARGO', 'GO', 'RUBYGEMS', 'NUGET', 'MAVEN'],
        },
        package_name: {
          type: 'string',
          description: '套件名稱，例如 lodash, requests, serde',
        },
        version: {
          type: 'string',
          description: '特定版本號，若無則預設為 latest',
        },
      },
      required: ['ecosystem', 'package_name'],
    },
  },
  {
    // Legacy-compatible alias: check_package (uses `package` param for backward compat)
    name: 'check_package',
    description: [
      '【Hawkeye Agent】Check a single package (legacy alias, use inspect_package).',
      'Returns: License, Vulnerabilities, Scorecard, Policy violations, and alternatives.',
      'Supported ecosystems: npm pip cargo go gem nuget maven.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        ecosystem: {
          type: 'string',
          description: '套件生態系統，可用值：NPM, PYPI, CARGO, GO, RUBYGEMS, NUGET, MAVEN',
          enum: ['NPM', 'PYPI', 'CARGO', 'GO', 'RUBYGEMS', 'NUGET', 'MAVEN'],
        },
        package: {
          type: 'string',
          description: '套件名稱，如 lodash、requests、serde',
        },
        version: {
          type: 'string',
          description: '指定版本（選填），不填則自動取最新穩定版',
        },
      },
      required: ['ecosystem', 'package'],
    },
  },
  {
    name: 'check_command',
    description: [
      'Parses an installation command and performs a batch compliance scan on all mentioned packages.',
      'Supports: npm install, pip install, cargo add, go get, gem install, dotnet add, mvn dependency:get.',
      'Example: npm install lodash express OR pip install requests flask.',
    ].join(' '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: '完整的安裝指令，例如：npm install lodash 或 pip install mysql-connector-python',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'show_policy',
    description: 'Show current enterprise open-source compliance policy (blocked licenses, Scorecard thresholds, vulnerability rules).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'hawkeye-agent', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // ── show_policy ──────────────────────────────────────────────────────────
    if (name === 'show_policy') {
      const lines = [
        hawkeyeHeader(),
        '## 🏛️ Open Source Package Policy',
        '',
        '> The following is the current corporate open-source package compliance policy. All packages must pass this policy review before being introduced.',
        '',
        '| Policy Rule | Configuration |',
        '| :--- | :--- |',
        `| 🏢 Organization | ${policy.organizationName} |`,
        `| ⛔ Blocked Licenses | \`${policy.blockedLicenses.join('`, `')}\` |`,
        `| 📊 OpenSSF Scorecard Threshold | \`${policy.minScorecardScore}/10\` |`,
        `| 🛡️ Known Vulnerabilities | ${policy.blockVulnerabilities ? '⛔ Blocked' : '✅ Allowed'} |`,
        `| 🗑️ Deprecated Packages | ${policy.blockDeprecated ? '⛔ Blocked' : '✅ Allowed'} |`,
        '',
        `**例外申請表單 (Exception Request Form):** ${policy.exceptionFormUrl}`,
        '',
        '> "Hawkeye Agent: The indisputable, high-precision line-judge for your software supply chain."',
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    // ── inspect_package (PRD primary tool) ───────────────────────────────────
    if (name === 'inspect_package') {
      const ecosystem = ((args?.ecosystem as string) ?? '').toUpperCase();
      const pkg = args?.package_name as string;
      const version = (args?.version as string) || undefined;

      if (!ecosystem || !pkg) {
        return { content: [{ type: 'text', text: 'Error: ecosystem and package_name parameters are required.' }] };
      }

      const result = await checkPackage(ecosystem, pkg, version, policy);
      return { content: [{ type: 'text', text: formatResult(result) }] };
    }

    // ── check_package (backward-compatible alias) ────────────────────────────
    if (name === 'check_package') {
      const ecosystem = ((args?.ecosystem as string) ?? '').toUpperCase();
      const pkg = args?.package as string;
      const version = (args?.version as string) || undefined;

      if (!ecosystem || !pkg) {
        return { content: [{ type: 'text', text: 'Error: ecosystem and package parameters are required.' }] };
      }

      const result = await checkPackage(ecosystem, pkg, version, policy);
      return { content: [{ type: 'text', text: formatResult(result) }] };
    }

    // ── check_command ────────────────────────────────────────────────────────
    if (name === 'check_command') {
      const command = args?.command as string;
      if (!command) {
        return { content: [{ type: 'text', text: 'Error: command parameter is required.' }] };
      }

      const tokens = command.trim().split(/\s+/);
      const detected = detectAndParse(tokens);

      if (!detected || detected.result.packages.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: [
                hawkeyeHeader(),
                '> ⚠️ Hawkeye Agent could not parse this installation command. Please verify the format and try again.',
                '',
                `Command: \`${command}\``,
                '',
                '**Supported Formats:**',
                '| Ecosystem | Example Command |',
                '| :--- | :--- |',
                '| npm | `npm install package` |',
                '| pip | `pip install package` |',
                '| cargo | `cargo add package` |',
                '| go | `go get package` |',
                '| gem | `gem install package` |',
                '| nuget | `dotnet add package PackageName` |',
                '| maven | `mvn dependency:get -Dartifact=group:artifact:version` |',
              ].join('\n'),
            },
          ],
        };
      }

      const { system, packages } = detected.result;
      const toCheck = packages.map((p) => ({
        system,
        name: p.name,
        version: p.version,
      }));

      const results = await checkPackages(toCheck, policy);

      const text = [
        hawkeyeHeader(),
        '## 📦 Batch Compliance Scan',
        '',
        `**Command:** \`${command}\``,
        '',
        formatCommandVerdict(results),
        '',
        '---',
        '',
        results.map(formatResult).join('\n\n---\n\n'),
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: [
            hawkeyeHeader(),
            '> ⚠️ An error occurred during the query. This may be a network issue or API service outage.',
            '',
            `Error Details: \`${String(err)}\``,
          ].join('\n'),
        },
      ],
      isError: true,
    };
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('Hawkeye Agent MCP Server started\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
