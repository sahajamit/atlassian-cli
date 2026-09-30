export interface JiraUser {
  accountId?: string;
  key?: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraFieldDef {
  id: string;
  name: string;
  custom: boolean;
  clauseNames: string[];
  schema?: { type?: string; items?: string; custom?: string };
}

export interface JiraCustomFieldInput {
  field: string;
  value: string;
  /** Value is raw JSON sent as-is (`--field "Name:=<json>"`). */
  json?: boolean;
}

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
  updated: string;
}

export interface JiraImageInfo {
  filename: string;
  url: string;
  mediaType?: string;
  fileSize?: number;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  created?: string;
  author?: string;
}

export interface JiraRawAttachment {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  created: string;
  content: string;
  author?: { displayName?: string };
}

export interface JiraIssue {
  key: string;
  id: string;
  summary: string;
  status: string;
  statusCategory: string;
  issueType: string;
  priority: string | null;
  assignee: string | null;
  reporter: string | null;
  created: string;
  updated: string;
  description: string | null;
  labels: string[];
  components: string[];
  comments: JiraComment[];
  images: JiraImageInfo[];
  attachments: JiraAttachment[];
  customFields: Record<string, unknown>;
  url: string;
}

export interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  hasMore: boolean;
}

// Raw API response types (Cloud v3)

export interface JiraCloudSearchResponse {
  issues: JiraRawIssue[];
  total?: number;
  nextPageToken?: string;
}

export interface JiraServerSearchResponse {
  issues: JiraRawIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

export interface JiraRawIssue {
  id: string;
  key: string;
  self: string;
  fields: Record<string, unknown>;
}

// Write operation types

export interface JiraCreateIssueInput {
  projectKey: string;
  issueType: string;
  summary: string;
  description?: string;
  assignee?: string;
  priority?: string;
  labels?: string[];
  components?: string[];
  parentKey?: string;
  customFields?: JiraCustomFieldInput[];
}

export interface JiraCreateIssueResult {
  key: string;
  id: string;
  url: string;
}

export interface JiraUpdateIssueInput {
  summary?: string;
  description?: string;
  assignee?: string;
  priority?: string;
  labels?: string[];
  addLabels?: string[];
  removeLabels?: string[];
  components?: string[];
  customFields?: JiraCustomFieldInput[];
}

export interface JiraTransition {
  id: string;
  name: string;
  to: { id: string; name: string; statusCategory: string };
}

export interface JiraAddCommentResult {
  id: string;
  body: string;
  author: string;
  created: string;
}
