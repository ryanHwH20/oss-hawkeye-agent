import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { createDefaultMcpService } from './runtime.js';
import { MAX_STDIO_MESSAGE_BYTES } from './schemas.js';
import { createHawkeyeMcpServer } from './server.js';

export function startMcpServer(workspace = process.cwd()): void {
  serveStdio(
    () => createHawkeyeMcpServer(createDefaultMcpService(workspace)),
    {
      transport: new StdioServerTransport(process.stdin, process.stdout, {
        maxBufferSize: MAX_STDIO_MESSAGE_BYTES,
      }),
      onerror: error => console.error(`Hawkeye MCP transport error: ${error.message}`),
    },
  );
}

startMcpServer();
