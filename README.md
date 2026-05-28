# 🛡️ CathayOSSGuard — Open Source Compliance MCP Server

> Powered by **Ossie**，國泰開源合規守護大使

CathayOSSGuard 是一個基於 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 的伺服器，讓 AI 助手（如 GitHub Copilot、Claude）能在開發者安裝套件前，自動查詢授權風險、已知漏洞與公司合規政策，即時攔截不合規的開源套件。

---

## 📋 目錄

- [背景](#背景)
- [功能特色](#功能特色)
- [系統架構](#系統架構)
- [前置需求](#前置需求)
- [安裝與建置](#安裝與建置)
- [啟動伺服器](#啟動伺服器)
- [MCP 客戶端設定](#mcp-客戶端設定)
- [可用工具](#可用工具)
- [政策設定](#政策設定)
- [應用場景](#應用場景)

---

## 背景

在企業環境中引入開源套件前，需要確認：

1. **授權合規** — 套件是否使用了 GPL、AGPL 等 Copyleft 授權，可能迫使衍生作品開源？
2. **資安風險** — 套件是否存在已知漏洞（CVE）？
3. **維護狀態** — 套件的 OpenSSF Scorecard 評分是否達標？
4. **依賴鏈風險** — 傳遞依賴是否藏有受限授權？

CathayOSSGuard 將這些檢查封裝為 MCP 工具，AI 助手可在對話中直接呼叫，實現「安裝前自動審查」的開發流程。

---

## 功能特色

- 🔍 **單套件查詢** — 查詢任意套件的授權、漏洞、評分與合規狀態
- 📦 **批次指令解析** — 自動解析 `npm install`、`pip install`、`cargo add` 等指令，一次查詢多個套件
- 📜 **政策引擎** — 根據 `policy.json` 定義的組織政策判定合規性
- 🛡️ **漏洞掃描** — 透過 [OSV.dev API](https://osv.dev) 查詢已知漏洞
- 📊 **SBOM 分析** — 掃描依賴鏈中所有套件的授權狀態
- 💡 **替代套件推薦** — 當套件不合規時，自動推薦政策中定義的替代方案
- 🌐 **多生態系統支援** — NPM、PyPI、Cargo、Go、RubyGems、NuGet、Maven

---

## 系統架構

```
┌─────────────────┐       stdio        ┌──────────────────────┐
│  MCP Client     │◄──────────────────►│  CathayOSSGuard      │
│  (Copilot/Chat) │                    │  MCP Server          │
└─────────────────┘                    └──────┬───────────────┘
                                              │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                     ┌──────────────┐  ┌─────────────┐  ┌────────────┐
                     │ deps.dev API │  │  OSV.dev    │  │ policy.json│
                     │ (授權/依賴)   │  │ (漏洞資料庫) │  │ (公司政策)  │
                     └──────────────┘  └─────────────┘  └────────────┘
```

---

## 前置需求

- **Node.js** ≥ 18（需支援全域 `fetch`）
- **npm** ≥ 9

---

## 安裝與建置

```bash
# 1. 安裝依賴
npm install

# 2. 編譯 TypeScript
npm run build
```

建置完成後，編譯產物位於 `dist/` 目錄。

---

## 啟動伺服器

```bash
npm start
```

伺服器透過 **stdio** 傳輸層啟動，等待 MCP 客戶端連線。啟動成功後會在 stderr 輸出：

```
CathayOSSGuard MCP Server (Ossie) started
```

> ⚠️ 本伺服器使用 stdio 通訊，不會監聽任何網路埠。需搭配支援 MCP 的客戶端使用。

---

## MCP 客戶端設定

### VS Code (GitHub Copilot)

在 `.vscode/mcp.json` 或使用者設定中加入：

```json
{
  "servers": {
    "cathayossguard": {
      "command": "node",
      "args": ["<path-to-project>/dist/server.js"]
    }
  }
}
```

### Claude Desktop

在 `claude_desktop_config.json` 中加入：

```json
{
  "mcpServers": {
    "cathayossguard": {
      "command": "node",
      "args": ["<path-to-project>/dist/server.js"]
    }
  }
}
```

將 `<path-to-project>` 替換為本專案的絕對路徑。

---

## 可用工具

| 工具名稱 | 說明 |
|----------|------|
| `check_package` | 查詢單一套件的授權、漏洞、評分與合規狀態 |
| `check_command` | 解析安裝指令（如 `npm install lodash express`），批次審查所有套件 |
| `show_policy` | 顯示目前公司的開源套件使用政策 |

### check_package

| 參數 | 必填 | 說明 |
|------|------|------|
| `ecosystem` | ✅ | 生態系統：`NPM`、`PYPI`、`CARGO`、`GO`、`RUBYGEMS`、`NUGET`、`MAVEN` |
| `package` | ✅ | 套件名稱 |
| `version` | ❌ | 指定版本，不填則自動取最新穩定版 |

### check_command

| 參數 | 必填 | 說明 |
|------|------|------|
| `command` | ✅ | 完整安裝指令，如 `npm install lodash` 或 `pip install requests flask` |

支援的指令格式：

| 生態系統 | 範例 |
|----------|------|
| npm | `npm install package` / `yarn add package` / `pnpm add package` |
| pip | `pip install package` / `pip3 install package==1.0.0` |
| cargo | `cargo add package` |
| go | `go get package@version` |
| gem | `gem install package` |
| nuget | `dotnet add package PackageName` |
| maven | `mvn dependency:get -Dartifact=group:artifact:version` |

---

## 政策設定

公司合規政策定義在專案根目錄的 `policy.json`：

```jsonc
{
  "organizationName": "Cathay Financial Holdings",
  "blockedLicenses": [
    "GPL-2.0", "GPL-3.0", "AGPL-3.0", "SSPL-1.0", "BUSL-1.1", ...
  ],
  "minScorecardScore": 4,
  "blockVulnerabilities": true,
  "blockDeprecated": true,
  "exceptionFormUrl": "https://forms.example.com/oss-exception-request",
  "alternatives": {
    "moment": [
      { "name": "dayjs", "reason": "輕量、API 相容、積極維護" },
      { "name": "date-fns", "reason": "Tree-shakeable、函式導向" }
    ]
  }
}
```

| 欄位 | 說明 |
|------|------|
| `blockedLicenses` | SPDX 授權黑名單，命中即觸發違規 |
| `minScorecardScore` | OpenSSF Scorecard 最低門檻（0-10） |
| `blockVulnerabilities` | 是否攔截有已知漏洞的套件 |
| `blockDeprecated` | 是否攔截已棄用的套件 |
| `exceptionFormUrl` | 例外申請表單連結 |
| `alternatives` | 不合規套件的推薦替代方案 |

---

## 應用場景

### 場景一：開發者在 Chat 中詢問套件安全性

> 「lodash 可以用嗎？」

AI 助手自動呼叫 `check_package`，回傳完整合規報告，包含授權、漏洞、SBOM 分析與最終結論。

### 場景二：貼上安裝指令進行批次審查

> 「幫我檢查 `npm install moment request express`」

AI 助手呼叫 `check_command`，解析指令後逐一查詢，回傳總覽表格與各套件詳細報告。對不合規套件提供升級建議或替代方案。

### 場景三：查詢公司政策

> 「公司的 OSS 政策是什麼？」

AI 助手呼叫 `show_policy`，以表格形式呈現現行政策規則。

---

## 授權

MIT
