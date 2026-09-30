# atl — Atlassian CLI

[![npm version](https://img.shields.io/npm/v/@sahajamit/atlassian-cli.svg)](https://www.npmjs.com/package/@sahajamit/atlassian-cli)
[![license](https://img.shields.io/npm/l/@sahajamit/atlassian-cli.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@sahajamit/atlassian-cli.svg)](https://nodejs.org)

A lightweight Node.js CLI for Atlassian Jira and Confluence. Works with both **Cloud** and **Server/Data Center** deployments.

Built as a faster, leaner alternative to MCP servers for letting AI agents (like Claude Code, Cursor, Copilot) interact with Atlassian products.

📦 **npm:** https://www.npmjs.com/package/@sahajamit/atlassian-cli

### Install

```bash
npm install -g @sahajamit/atlassian-cli
```

Then jump to [Quick Start](#quick-start) to set env vars and verify, or skim [Why We Built This](#why-we-built-this) and [Beyond Plain Text](#beyond-plain-text) first.

---

## Why We Built This

### The Problem with MCP

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) is the standard way AI agents talk to external tools. The [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) server is an excellent implementation — 73 tools covering nearly every Jira and Confluence operation. But in practice, using MCP for Atlassian has real costs:

1. **Token overhead.** Every MCP call includes the full tool schema in the conversation context. With 73 tools, that's thousands of tokens spent just describing what's available — before any actual work happens. On long conversations, this adds up fast.

2. **Server lifecycle.** MCP requires a running server process. You need to start it, keep it alive, handle crashes, manage configuration. It's another moving part in your development setup.

3. **Cold start latency.** The Python MCP server needs to initialize, load dependencies, and establish connections before the first call. This adds seconds to every fresh session.

4. **All-or-nothing tool loading.** MCP sends all tool definitions to the agent upfront. Even if you only need `jira search` and `get-issue`, the agent sees all 73 tools and has to reason about which ones to use. This dilutes focus and wastes context.

### The CLI + Skills Approach

`atl` takes a different approach: it's a plain CLI binary that AI agents invoke directly via shell commands. Combined with skill files (markdown files that teach the agent how to use each command), this gives you:

| | MCP Server | CLI + Skills |
|---|---|---|
| **Token cost** | ~3,000+ tokens for tool schemas per turn | ~200 tokens per skill file, loaded on demand |
| **Setup** | Start server process, configure transport | Set env vars, `npm install -g`, `atl install --skills` |
| **Latency** | Server init + JSON-RPC overhead | Direct process spawn (~50ms) |
| **Tool selection** | Agent picks from 73 tools | Agent reads relevant skill file only |
| **Dependencies** | Python + FastMCP + atlassian-python-api | Node.js + 3 npm packages |
| **Debugging** | Inspect MCP messages | Run the same CLI command in your terminal |

The key insight: **an agent doesn't need a protocol to call a CLI.** It just runs a shell command and reads the output. Skills files teach it the command syntax and output schema — no runtime overhead, no server process, no token bloat.

### When to Use MCP Instead

MCP still makes sense when:
- You need **bi-directional communication** (server pushing updates to the agent)
- You're building a **multi-tenant SaaS** with OAuth per user
- You need **all 73 tools** and want automatic tool discovery
- Your agent framework **only supports MCP** (no shell access)

For the common case — a developer using an AI agent to work with their team's Jira and Confluence — the CLI is simpler and cheaper.

---

## Beyond Plain Text

Most Atlassian-to-text tools just strip HTML and feed the agent a flat string. `atl` does two things differently that turn out to matter a lot for AI workflows:

### Multimodal — images, not just words

Jira issues and Confluence pages frequently carry the *real* information in screenshots, architecture diagrams, mockups, error stack-trace images, and whiteboard exports. A text-only extractor throws all that away.

`atl` treats images as first-class output:

- `atl jira get-issue` and `atl confluence get-page` return an `images[]` array alongside the text body, with filename, URL, mime type, width/height for every embedded image and image attachment.
- `atl jira download-attachments --filter images` (and the Confluence equivalent) pulls them to local disk in one shot.
- The bundled skill files explicitly instruct vision-capable AI agents (Claude, Cursor, Copilot) to detect non-empty `images[]`, download them, **and read them with vision** to build understanding before answering. The synthesized answer combines text *and* visual content.

So a question like *"what's the proposed architecture in PROJ-456?"* doesn't fail just because the architecture lives in `architecture.png` rather than the issue description.

```bash
# Agent flow (this is what the skill file tells the agent to do)
atl jira get-issue PROJ-456 --json                              # text + images[] metadata
atl jira download-attachments --issue-key PROJ-456 --filter images --json
# → agent reads each downloaded image with vision, synthesizes a complete answer
```

### Layout-aware Confluence rendering

Confluence pages are stored in XHTML "storage format" with custom macros (`ac:layout-section`, `ac:structured-macro`, `ac:image`, etc.). Most tools convert this with a generic HTML stripper, which destroys:

- **Multi-column layouts** — collapsed into a single linear blob, losing the side-by-side relationship between columns.
- **Panels** (info / warning / note / tip) — flattened to plain paragraphs, losing severity and intent.
- **Code blocks** — language tags stripped, indentation often mangled.
- **Expand / collapse sections** — content either dropped or merged inline with no signal that it was hidden.
- **Embedded images** — left as broken HTML or omitted entirely.

`atl` ships [Turndown](https://github.com/mixmark-io/turndown) with a custom rule set (`src/preprocessing/html-to-markdown.ts`) that **preserves the layout signal**:

| Confluence construct | Rendered as |
|---|---|
| `ac:layout-section` with multiple `ac:layout-cell` | Each column rendered sequentially with `<!-- Column 1 -->`, `<!-- Column 2 -->` markers so the agent (and you) can still tell columns apart |
| `panel` / `info` / `warning` / `note` / `tip` macros | Labeled markdown blockquotes — `> **Warning: Title**\n> body` |
| `code` macro | Fenced code block with language tag preserved (` ```python `) |
| `expand` macro | HTML `<details><summary>title</summary>...</details>` |
| `ac:image` with `ri:attachment` or `ri:url` | `![filename](url)` markdown image **and** collected into `images[]` for downstream download |
| Confluence emoticons (`<img class="emoticon">`) | Their alt text inline (`:smile:`) |
| Tables, headings, lists, links | Standard markdown |
| Unknown `ac:structured-macro` | `[macro: name]` placeholder so nothing is silently dropped |

The result is markdown that an AI agent can reason over with the **same structural cues a human reader gets** — "this is in a warning box," "this is the second column of a two-column layout," "this code is Python," "this section is collapsed by default." For long architecture pages with multi-column overviews and embedded diagrams, the difference between layout-aware and "just strip the tags" output is the difference between a useful summary and noise.

Use `--raw` on `atl confluence get-page` if you want the original storage-format XHTML instead.

---

## Quick Start

### Prerequisites

- Node.js 22+
- An Atlassian account with API access

### Install

```bash
npm install -g @sahajamit/atlassian-cli
```

Or run without installing:

```bash
npx @sahajamit/atlassian-cli --help
```

### Configure

Set environment variables for your Atlassian instance. You only need to configure the services you use (Jira, Confluence, or both).

**Atlassian Cloud:**

```bash
export JIRA_URL=https://your-company.atlassian.net
export JIRA_USERNAME=your.email@company.com
export JIRA_API_TOKEN=your_api_token          # https://id.atlassian.com/manage-profile/security/api-tokens

export CONFLUENCE_URL=https://your-company.atlassian.net/wiki
export CONFLUENCE_USERNAME=your.email@company.com
export CONFLUENCE_API_TOKEN=your_api_token
```

**Server / Data Center (on-prem):**

```bash
export JIRA_URL=https://jira.yourcompany.com
export JIRA_PERSONAL_TOKEN=your_pat           # Generated in Jira → Profile → Personal Access Tokens

export CONFLUENCE_URL=https://confluence.yourcompany.com
export CONFLUENCE_PERSONAL_TOKEN=your_pat
```

The CLI auto-detects Cloud vs Server based on the URL (`atlassian.net` = Cloud, anything else = Server/DC).

### Install AI Agent Skills (optional)

```bash
atl install --skills    # Install skill files for Claude Code, Cursor, Copilot
```

This installs three skill files that teach AI agents how to use `atl`:
- **`atl`** — parent skill (routing + overview)
- **`atl-jira`** — all Jira commands with syntax and examples
- **`atl-confluence`** — all Confluence commands with syntax and examples

Agents load only the relevant skill file, keeping token usage minimal.

> Skill files are **not** auto-installed on `npm install`. You opt in by running `atl install --skills`. To remove them later: `atl uninstall --skills`.

### Verify

```bash
atl jira search "project = PROJ ORDER BY updated DESC" --limit 3
```

---

## Commands

### Jira

| Command | Purpose |
|---------|---------|
| `atl jira search <jql>` | Search issues by JQL |
| `atl jira get-issue <key>` | Full issue details with comments |
| `atl jira download-attachments` | Download attachments from an issue |
| `atl jira create-issue` | Create a new issue |
| `atl jira update-issue <key>` | Update issue fields |
| `atl jira add-comment <key> <body>` | Add a comment |
| `atl jira get-transitions <key>` | List available workflow transitions |
| `atl jira transition-issue <key>` | Transition an issue to a new status |

### Confluence

| Command | Purpose |
|---------|---------|
| `atl confluence search <query>` | Search pages and blog posts |
| `atl confluence get-page` | Get a page (markdown by default) |
| `atl confluence download-attachments` | Download attachments from a page |
| `atl confluence create-page` | Create a new page |
| `atl confluence update-page` | Update an existing page |
| `atl confluence add-comment <body>` | Add a comment to a page |

Run `atl <command> --help` for full options on any command. Detailed examples and JSON output schemas are in the [skill files](./src/skills/atl-jira/SKILL.md) shipped with the package.

---

## Output Modes

The CLI has two output modes:

| Mode | When | Format |
|------|------|--------|
| **Human** | stdout is a terminal (TTY) | Colored tables and formatted text |
| **JSON** | stdout is piped (non-TTY) | Structured JSON |

This means agents automatically get JSON without any flags:

```bash
# Agent runs this — gets JSON because stdout is piped
result=$(atl jira search "project = PROJ")

# Human runs the same command — gets a colored table
atl jira search "project = PROJ"

# Force JSON in terminal
atl jira search "project = PROJ" --json
```

---

## Cloud vs Server / Data Center

| | Cloud | Server / Data Center |
|---|---|---|
| **Detection** | URL contains `atlassian.net` | Everything else |
| **Auth** | Email + API token | Personal Access Token (preferred) or username + password |
| **Jira API** | REST API v3 | REST API v2 |
| **Confluence API** | REST API v1 (content) | REST API v1 (content) |
| **Descriptions** | ADF (auto-converted to markdown) | Wiki markup / plain text |

You don't need to specify which deployment type you're using — the CLI detects it from the URL.

### Authentication Methods

**Cloud — Basic Auth (email + API token):**

```bash
export JIRA_URL=https://your-company.atlassian.net
export JIRA_USERNAME=your.email@company.com    # Your Atlassian email
export JIRA_API_TOKEN=<token>                  # From id.atlassian.com
```

**Server/DC — Personal Access Token (recommended):**

```bash
export JIRA_URL=https://jira.yourcompany.com
export JIRA_PERSONAL_TOKEN=<pat>               # From Jira → Profile → Personal Access Tokens
```

**Server/DC — Basic Auth (legacy):**

```bash
export JIRA_URL=https://jira.yourcompany.com
export JIRA_USERNAME=your_username
export JIRA_API_TOKEN=your_password            # Yes, the password goes in API_TOKEN
```

The same pattern applies to Confluence — replace `JIRA_` with `CONFLUENCE_`.

> **Self-signed certs?** Node's native `fetch` doesn't support per-request TLS bypass. If your Server/DC instance uses a self-signed cert, run with `NODE_TLS_REJECT_UNAUTHORIZED=0` set process-wide.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JIRA_URL` | For Jira | Jira instance URL |
| `JIRA_USERNAME` | Cloud | Your email address |
| `JIRA_API_TOKEN` | Cloud | API token from id.atlassian.com |
| `JIRA_PERSONAL_TOKEN` | Server/DC | Personal access token |
| `JIRA_ALLOWED_FIELDS` | No | Comma-separated custom field names/IDs that are visible. See [Field policy](#jira-field-policy) |
| `JIRA_BLOCKED_FIELDS` | No | Comma-separated field names/IDs that are never read or written |
| `CONFLUENCE_URL` | For Confluence | Confluence instance URL |
| `CONFLUENCE_USERNAME` | Cloud | Your email address |
| `CONFLUENCE_API_TOKEN` | Cloud | API token from id.atlassian.com |
| `CONFLUENCE_PERSONAL_TOKEN` | Server/DC | Personal access token |

---

## Jira Custom Fields

Read custom fields by name or ID with `--fields`, and set them with `--field`:

```bash
atl jira get-issue PROJ-1 --fields summary,Sprint,Team
atl jira update-issue PROJ-1 --field "Team=Platform" --field "Sprint=42"
atl jira create-issue -p PROJ -t Task -s "Title" --field "Story Points=3"
atl jira update-issue PROJ-1 --field 'Custom:={"id":"10"}'   # raw JSON escape hatch
```

Values are converted using the field's schema (options, users, numbers, arrays, dates).
Sprint membership is set through the Agile API and takes a numeric sprint ID.
Unknown custom field types fall back to JSON, then plain text.

### Jira field policy

Two optional environment variables restrict which fields `atl` will touch. Entries are
field names or IDs (case-insensitive); prefer IDs like `customfield_10042` because names can be duplicated.

| Variable | Effect |
|----------|--------|
| `JIRA_BLOCKED_FIELDS` | Listed fields (standard or custom) are never requested, returned, or written. |
| `JIRA_ALLOWED_FIELDS` | When set, **only** the listed custom fields are visible. They are also included in `get-issue` and `search` output by default. Standard fields are unaffected. |

The block-list wins if a field is in both. Requesting or writing a restricted field fails with
an error that does not reveal whether the field exists, and JQL that references a restricted field is rejected.

```bash
export JIRA_ALLOWED_FIELDS="Sprint,Team"
export JIRA_BLOCKED_FIELDS="description,customfield_10500"
```

> This is a guardrail enforced inside the CLI, not a security boundary. Anyone who can set the
> environment or read the API token can bypass it, so keep the token out of reach of whoever the policy is for.

---

## AI Agent Integration

Install skill files so AI agents know how to use `atl`:

```bash
atl install --skills    # Install for Claude Code, Cursor, Copilot
atl uninstall --skills  # Remove skill files
```

This installs three modular skill files:

| Skill | Scope | Installed to |
|-------|-------|-------------|
| `atl` | Routing + overview | `~/.claude/skills/atl/SKILL.md` |
| `atl-jira` | All Jira commands | `~/.claude/skills/atl-jira/SKILL.md` |
| `atl-confluence` | All Confluence commands | `~/.claude/skills/atl-confluence/SKILL.md` |

The same files are installed under `~/.cursor/rules/` (if Cursor is set up) and `~/.copilot/skills/`. Run from a git repo root to also append to `.github/copilot-instructions.md`.

Agents load only the relevant skill (Jira or Confluence) on demand, not all commands at once.

### How it works

1. Agent sees a Jira-related request, loads the `atl-jira` skill
2. Agent runs `atl jira search "project = PROJ AND assignee = currentUser()"`
3. CLI returns JSON (auto-detected because stdout is piped)
4. Agent parses the JSON and continues reasoning

This is typically **5-10x cheaper in tokens** than the equivalent MCP flow, because:
- Only the relevant skill schema is loaded (not all 73 tools)
- No MCP protocol overhead (tool registration, JSON-RPC framing)
- The output is the same structured JSON either way

---

## Contributing / Local Development

To build from source, run tests, or contribute new commands, see [`docs/dev/local-development.md`](./docs/dev/local-development.md).

Bug reports and feature requests are welcome at [GitHub Issues](https://github.com/sahajamit/atlassian-cli/issues).

---

## License

MIT — see [LICENSE](./LICENSE).

---

## Credits

Architecture and API patterns informed by the excellent [mcp-atlassian](https://github.com/sooperset/mcp-atlassian) project by [sooperset](https://github.com/sooperset).
