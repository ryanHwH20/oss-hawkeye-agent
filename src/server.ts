import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadPolicy } from './policy.js';
import { checkPackage, checkPackages } from './checker.js';
import { detectAndParse } from './parser.js';
import { formatResult, formatCommandVerdict, ossieHeader } from './formatter.js';

const policy = loadPolicy();

// ─── Tool Definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'check_package',
    description: [
      '【Ossie 開源守護大使】查詢套件安全性，並依公司政策評估是否可用。',
      '回傳：授權、已知漏洞數、OpenSSF Scorecard、政策違規原因、建議替代套件。',
      '適用生態系統：npm pip cargo go gem nuget maven。',
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
      '解析一段套件安裝指令，查詢所有涉及套件的安全性與政策合規性。',
      '支援：npm install、pip install、cargo add、go get、gem install、dotnet add、mvn dependency:get。',
      '例如輸入 npm install lodash express 或 pip install requests flask。',
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
    description: '顯示目前公司套件使用政策（授權黑名單、Scorecard 門檻、漏洞規則等）。',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'cathayossguard', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === 'show_policy') {
      const lines = [
        ossieHeader(),
        '## Open Source Package Policy',
        '',
        '> 以下為公司現行開源套件合規政策，所有套件引入前均須通過本政策審查。',
        '',
        '| Policy Rule | Configuration |',
        '|-------------|---------------|',
        `| Organization | ${policy.organizationName} |`,
        `| Blocked Licenses | \`${policy.blockedLicenses.join('`, `')}\` |`,
        `| OpenSSF Scorecard Threshold | \`${policy.minScorecardScore}/10\` |`,
        `| Known Vulnerabilities | ${policy.blockVulnerabilities ? '⛔ Blocked' : '✅ Allowed'} |`,
        `| Deprecated Packages | ${policy.blockDeprecated ? '⛔ Blocked' : '✅ Allowed'} |`,
        '',
        `**Exception Request Form:** ${policy.exceptionFormUrl}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'check_package') {
      const ecosystem = ((args?.ecosystem as string) ?? '').toUpperCase();
      const pkg = args?.package as string;
      const version = (args?.version as string) || undefined;

      if (!ecosystem || !pkg) {
        return { content: [{ type: 'text', text: '錯誤：請提供 ecosystem 和 package 參數。' }] };
      }

      const result = await checkPackage(ecosystem, pkg, version, policy);
      return { content: [{ type: 'text', text: formatResult(result) }] };
    }

    if (name === 'check_command') {
      const command = args?.command as string;
      if (!command) {
        return { content: [{ type: 'text', text: '錯誤：請提供 command 參數。' }] };
      }

      const tokens = command.trim().split(/\s+/);
      const detected = detectAndParse(tokens);

      if (!detected || detected.result.packages.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: [
                ossieHeader(),
                '> ⚠️ Ossie 無法解析此安裝指令，請確認格式後重新提交。',
                '',
                `指令：\`${command}\``,
                '',
                '支援格式：',
                '| 生態系統 | 範例指令 |',
                '|----------|----------|',
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
        ossieHeader(),
        '## 批次合規審查',
        '',
        `指令： \`${command}\``,
        '',
        formatCommandVerdict(results),
        '',
        '---',
        '',
        results.map(formatResult).join('\n\n---\n\n'),
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }

    return { content: [{ type: 'text', text: `未知工具：${name}` }] };
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: [
            ossieHeader(),
            '> ⚠️ Ossie 查詢過程中發生錯誤，可能為網路異常或 API 服務中斷。',
            '',
            `錯誤詳情：\`${String(err)}\``,
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
  process.stderr.write('CathayOSSGuard MCP Server (Ossie) started\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
