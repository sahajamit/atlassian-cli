---
name: atl-jira
description: Jira CLI commands — search issues, get issue details, create/update issues, add comments, transition issues. Use for any Jira task.
allowed-tools: Bash(atl:*)
---

# atl — Jira Commands

## Quick start

```bash
# Search issues
atl jira search "project = PROJ AND status != Done ORDER BY updated DESC"

# Read an issue
atl jira get-issue PROJ-123

# Create an issue
atl jira create-issue --project PROJ --type Bug --summary "Login broken"

# Transition an issue
atl jira transition-issue PROJ-123 --transition "In Progress"

# Add a comment
atl jira add-comment PROJ-123 "Investigating this now"
```

---

## `atl jira search <jql>`

Search Jira issues using JQL.

```bash
atl jira search "<jql>" [--limit N] [--offset N] [--fields field1,field2] [--json]
```

**Options:**
- `--limit N` (default: 20) — max results
- `--offset N` (default: 0) — skip N results
- `--fields` — comma-separated field names or IDs, including custom fields (e.g. `Sprint,Team`)
- `--json` — force JSON output

**Examples:**
```bash
atl jira search "project = PROJ AND type = Bug AND status != Done"
atl jira search "assignee = currentUser() ORDER BY updated DESC"
atl jira search "project = PROJ AND updated >= -7d" --limit 50
```

**JSON output:**
```json
{
  "issues": [
    {
      "key": "PROJ-123",
      "id": "10001",
      "summary": "Issue title",
      "status": "In Progress",
      "statusCategory": "indeterminate",
      "issueType": "Bug",
      "priority": "High",
      "assignee": "John Doe",
      "reporter": "Jane Smith",
      "created": "2024-01-15T10:30:00.000+0000",
      "updated": "2024-01-16T14:20:00.000+0000",
      "description": "Issue description in markdown",
      "labels": ["backend", "urgent"],
      "components": ["API"],
      "comments": [],
      "url": "https://company.atlassian.net/browse/PROJ-123"
    }
  ],
  "total": 42,
  "hasMore": true
}
```

---

## `atl jira get-issue <key>`

Get full details of a Jira issue including description and comments.

```bash
atl jira get-issue <ISSUE-KEY> [--comments N] [--fields field1,field2] [--json]
```

**Options:**
- `--comments N` (default: 10) — max comments to include
- `--fields` — comma-separated field names or IDs, including custom fields (e.g. `Sprint,Team`)
- `--json` — force JSON output

**Examples:**
```bash
atl jira get-issue PROJ-123
atl jira get-issue PROJ-123 --comments 5
atl jira get-issue PROJ-123 --fields summary,status,description
```

**JSON output:**

```json
{
  "key": "PROJ-123",
  "id": "10001",
  "summary": "Issue title",
  "status": "In Progress",
  "statusCategory": "indeterminate",
  "issueType": "Story",
  "priority": "Medium",
  "assignee": "John Doe",
  "reporter": "Jane Smith",
  "created": "2024-01-15T10:30:00.000+0000",
  "updated": "2024-01-16T14:20:00.000+0000",
  "description": "Description in markdown with ![image.png](url) references",
  "labels": ["feature"],
  "components": ["Frontend"],
  "comments": [],
  "images": [
    {
      "filename": "screenshot.png",
      "url": "https://company.atlassian.net/rest/api/3/attachment/content/10001",
      "mediaType": "image/png",
      "fileSize": 245760
    }
  ],
  "attachments": [
    {
      "id": "10001",
      "filename": "screenshot.png",
      "mimeType": "image/png",
      "size": 245760,
      "downloadUrl": "https://company.atlassian.net/rest/api/3/attachment/content/10001",
      "created": "2024-01-15T10:30:00.000+0000",
      "author": "Jane Smith"
    }
  ],
  "url": "https://company.atlassian.net/browse/PROJ-123"
}
```

- `images` — Image files found in the description or attached to the issue. Use these for visual analysis.
- `attachments` — All attachments (images + documents). Full metadata including download URLs.

---

## `atl jira download-attachments`

Download attachments from a Jira issue to a local directory.

```bash
atl jira download-attachments --issue-key <ISSUE-KEY> [--output-dir <dir>] [--filter <type>] [--json]
```

**Options:**
- `--issue-key <key>` — **(required)** Jira issue key
- `--output-dir <dir>` — output directory (default: `/tmp/jira-attachments/{issueKey}/`)
- `--filter <type>` — `images`, `documents`, or `all` (default: `all`)
- `--json` — force JSON output

**Examples:**
```bash
atl jira download-attachments --issue-key PROJ-123 --filter images
atl jira download-attachments --issue-key PROJ-123 --output-dir ./assets --json
```

**JSON output:**
```json
{
  "issueKey": "PROJ-123",
  "outputDir": "/tmp/jira-attachments/PROJ-123",
  "downloaded": [
    {
      "filename": "screenshot.png",
      "path": "/tmp/jira-attachments/PROJ-123/screenshot.png",
      "mimeType": "image/png",
      "size": 245760
    }
  ]
}
```

---

## `atl jira create-issue`

Create a new Jira issue.

```bash
atl jira create-issue --project <KEY> --type <type> --summary <text> [options] [--json]
```

**Required options:**
- `-p, --project <key>` — project key (e.g. PROJ)
- `-t, --type <type>` — issue type (e.g. Bug, Task, Story)
- `-s, --summary <text>` — issue summary

**Optional:**
- `-d, --description <text>` — issue description
- `--assignee <user>` — assignee (accountId for Cloud, username for Server)
- `--priority <name>` — priority (e.g. High, Medium, Low)
- `--labels <labels>` — comma-separated labels
- `--field <name=value>` — set any field by name or ID, repeatable (`Name:=<json>` for raw JSON). May be restricted by `JIRA_ALLOWED_FIELDS` / `JIRA_BLOCKED_FIELDS`
- `--components <components>` — comma-separated component names
- `--parent <key>` — parent issue key (for sub-tasks)

**Examples:**
```bash
atl jira create-issue --project PROJ --type Bug --summary "Login page 500 error"
atl jira create-issue -p PROJ -t Story -s "Add dark mode" -d "Users want a dark theme" --labels ui,frontend --priority Medium
atl jira create-issue -p PROJ -t Sub-task -s "Write tests" --parent PROJ-100
```

**JSON output:**
```json
{
  "key": "PROJ-124",
  "id": "10042",
  "url": "https://company.atlassian.net/browse/PROJ-124"
}
```

---

## `atl jira update-issue <key>`

Update fields on an existing issue.

```bash
atl jira update-issue <ISSUE-KEY> [options] [--json]
```

**Options:**
- `-s, --summary <text>` — new summary
- `-d, --description <text>` — new description
- `--assignee <user>` — new assignee
- `--priority <name>` — new priority
- `--labels <labels>` — replace all labels (comma-separated)
- `--field <name=value>` — set any field by name or ID, repeatable (`Name:=<json>` for raw JSON). May be restricted by `JIRA_ALLOWED_FIELDS` / `JIRA_BLOCKED_FIELDS`
- `--add-labels <labels>` — add labels
- `--remove-labels <labels>` — remove labels
- `--components <components>` — replace all components

**Examples:**
```bash
atl jira update-issue PROJ-123 --priority High
atl jira update-issue PROJ-123 --add-labels urgent,backend
atl jira update-issue PROJ-123 --assignee john.doe --summary "Updated title"
```

**JSON output:** Returns the full updated issue (same schema as `get-issue`).

---

## `atl jira add-comment <key> <body>`

Add a comment to an issue. Use `-` as body to read from stdin.

```bash
atl jira add-comment <ISSUE-KEY> <body> [--json]
```

**Examples:**
```bash
atl jira add-comment PROJ-123 "Investigating the root cause"
echo "Long analysis..." | atl jira add-comment PROJ-123 -
```

**JSON output:**
```json
{
  "id": "10050",
  "body": "Investigating the root cause",
  "author": "John Doe",
  "created": "2024-01-16T14:20:00.000+0000"
}
```

---

## `atl jira get-transitions <key>`

Get available workflow transitions for an issue.

```bash
atl jira get-transitions <ISSUE-KEY> [--json]
```

**JSON output:**
```json
[
  {
    "id": "21",
    "name": "In Progress",
    "to": { "id": "3", "name": "In Progress", "statusCategory": "indeterminate" }
  },
  {
    "id": "31",
    "name": "Done",
    "to": { "id": "10001", "name": "Done", "statusCategory": "done" }
  }
]
```

---

## `atl jira transition-issue <key>`

Transition an issue to a new status. Accepts transition name (fuzzy matched) or ID.

```bash
atl jira transition-issue <ISSUE-KEY> --transition <nameOrId> [--comment <text>] [--resolution <name>] [--json]
```

**Options:**
- `--transition <nameOrId>` — **(required)** transition name or ID
- `--comment <text>` — add a comment with the transition
- `--resolution <name>` — set resolution (e.g. Done, Fixed)

**Examples:**
```bash
atl jira transition-issue PROJ-123 --transition "In Progress"
atl jira transition-issue PROJ-123 --transition Done --resolution Fixed --comment "Deployed to prod"
atl jira transition-issue PROJ-123 --transition 31
```

**JSON output:**
```json
{
  "key": "PROJ-123",
  "transition": "Done",
  "status": "Done",
  "url": "https://company.atlassian.net/browse/PROJ-123"
}
```

---

## Workflow: Create and manage an issue

```bash
# 1. Create
atl jira create-issue -p PROJ -t Bug -s "API timeout on /search" --priority High --json

# 2. Assign and start
atl jira update-issue PROJ-124 --assignee john.doe
atl jira transition-issue PROJ-124 --transition "In Progress"

# 3. Comment with findings
atl jira add-comment PROJ-124 "Root cause: missing index on search_logs table"

# 4. Resolve
atl jira transition-issue PROJ-124 --transition Done --resolution Fixed --comment "Deployed in v2.3.1"
```

---

## Workflow: Analyze an issue with images

```bash
# 1. Get issue content (includes images and attachments metadata)
atl jira get-issue PROJ-123 --json

# 2. If images[] is non-empty, download them for analysis
atl jira download-attachments --issue-key PROJ-123 --filter images --json

# 3. Read each downloaded image file to analyze visual content
# 4. Synthesize text content + image analysis into a comprehensive summary
```
