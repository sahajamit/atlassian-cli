import type { HttpClient } from '../http.js';
import { adfToMarkdown, adfToMarkdownWithImages } from '../preprocessing/adf-to-text.js';
import { textToAdf } from '../preprocessing/text-to-adf.js';
import { ConfigError } from '../errors.js';
import {
  fieldNotPermitted,
  findRestrictedJqlReference,
  isExplicitlyAllowed,
  isFieldPermitted,
} from '../field-policy.js';
import {
  findFieldDefs,
  flattenFieldValue,
  normalizeFieldDef,
  toFieldWrite,
} from './jira-fields.js';
import type { DeploymentType, FieldPolicy } from '../types/common.js';
import type {
  JiraAddCommentResult,
  JiraAttachment,
  JiraCloudSearchResponse,
  JiraComment,
  JiraFieldDef,
  JiraCreateIssueInput,
  JiraCustomFieldInput,
  JiraCreateIssueResult,
  JiraImageInfo,
  JiraIssue,
  JiraRawAttachment,
  JiraRawIssue,
  JiraSearchResult,
  JiraServerSearchResponse,
  JiraTransition,
  JiraUpdateIssueInput,
} from '../types/jira.js';

const DEFAULT_FIELDS = [
  'summary', 'status', 'assignee', 'reporter', 'priority',
  'issuetype', 'labels', 'components', 'created', 'updated',
  'description', 'comment', 'attachment',
];

interface SearchOptions {
  fields?: string[];
  limit?: number;
  offset?: number;
}

interface GetIssueOptions {
  fields?: string[];
  expand?: string[];
  commentLimit?: number;
}

export interface JiraClient {
  search(jql: string, opts?: SearchOptions): Promise<JiraSearchResult>;
  getIssue(issueKey: string, opts?: GetIssueOptions): Promise<JiraIssue>;
  getAttachments(issueKey: string): Promise<JiraAttachment[]>;
  downloadAttachment(url: string, destPath: string): Promise<void>;
  createIssue(input: JiraCreateIssueInput): Promise<JiraCreateIssueResult>;
  updateIssue(issueKey: string, input: JiraUpdateIssueInput): Promise<void>;
  addComment(issueKey: string, body: string): Promise<JiraAddCommentResult>;
  getTransitions(issueKey: string): Promise<JiraTransition[]>;
  transitionIssue(issueKey: string, transitionId: string, opts?: { comment?: string; resolution?: string }): Promise<void>;
}

function extractString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    return (obj.displayName as string) ?? (obj.name as string) ?? (obj.value as string) ?? null;
  }
  return null;
}

function normalizeAttachments(raw: unknown[]): JiraAttachment[] {
  return (raw as JiraRawAttachment[]).map(a => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    downloadUrl: a.content,
    created: a.created,
    author: a.author?.displayName,
  }));
}

function normalizeIssue(
  raw: JiraRawIssue,
  baseUrl: string,
  deployment: DeploymentType,
  customDefs: JiraFieldDef[] = [],
): JiraIssue {
  const f = raw.fields;

  // Process attachments
  const rawAttachments = (f.attachment as JiraRawAttachment[] | undefined) ?? [];
  const attachments = normalizeAttachments(rawAttachments);

  // Process description (with image extraction for Cloud ADF)
  let description: string | null = null;
  let images: JiraImageInfo[] = [];
  if (f.description) {
    if (deployment === 'cloud' && typeof f.description === 'object') {
      // Cloud: ADF format — resolve media IDs via attachment context
      const result = adfToMarkdownWithImages(f.description, {
        attachments: attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          downloadUrl: a.downloadUrl,
          mimeType: a.mimeType,
        })),
      });
      description = result.markdown;
      images = result.images;
    } else if (typeof f.description === 'string') {
      // Server: plain text or wiki markup
      description = f.description;
    }
  }

  // Add image-type attachments not already discovered by the ADF parser
  const discoveredFilenames = new Set(images.map(img => img.filename));
  for (const att of attachments) {
    if (att.mimeType.startsWith('image/') && !discoveredFilenames.has(att.filename)) {
      images.push({
        filename: att.filename,
        url: att.downloadUrl,
        mediaType: att.mimeType,
        fileSize: att.size,
      });
    }
  }

  // Process comments
  const comments: JiraComment[] = [];
  const commentField = f.comment as { comments?: Array<Record<string, unknown>> } | undefined;
  if (commentField?.comments) {
    for (const c of commentField.comments) {
      let body: string;
      if (deployment === 'cloud' && typeof c.body === 'object') {
        body = adfToMarkdown(c.body);
      } else {
        body = (c.body as string) ?? '';
      }
      comments.push({
        id: String(c.id ?? ''),
        author: extractString(c.author) ?? 'Unknown',
        body,
        created: (c.created as string) ?? '',
        updated: (c.updated as string) ?? '',
      });
    }
  }

  // Status
  const statusObj = f.status as Record<string, unknown> | undefined;
  const statusCategoryObj = statusObj?.statusCategory as Record<string, unknown> | undefined;

  const customFields: Record<string, unknown> = {};
  for (const def of customDefs) {
    const key = def.name in customFields ? `${def.name} (${def.id})` : def.name;
    customFields[key] = flattenFieldValue(f[def.id], def);
  }

  return {
    key: raw.key,
    id: raw.id,
    summary: (f.summary as string) ?? '',
    status: extractString(f.status) ?? 'Unknown',
    statusCategory: (statusCategoryObj?.key as string) ?? 'undefined',
    issueType: extractString(f.issuetype) ?? 'Unknown',
    priority: extractString(f.priority),
    assignee: extractString(f.assignee),
    reporter: extractString(f.reporter),
    created: (f.created as string) ?? '',
    updated: (f.updated as string) ?? '',
    description,
    labels: (f.labels as string[]) ?? [],
    components: ((f.components as Array<Record<string, unknown>>) ?? []).map(
      c => (c.name as string) ?? '',
    ),
    comments,
    images,
    attachments,
    customFields,
    url: `${baseUrl}/browse/${raw.key}`,
  };
}

interface FieldPlan {
  apiFields: string[];
  customDefs: JiraFieldDef[];
}

export function createJiraClient(
  http: HttpClient,
  baseUrl: string,
  deployment: DeploymentType,
  policy?: FieldPolicy,
): JiraClient {
  const apiVersion = deployment === 'cloud' ? '3' : '2';
  let catalogPromise: Promise<JiraFieldDef[]> | undefined;

  function getCatalog(): Promise<JiraFieldDef[]> {
    catalogPromise ??= http
      .request<Array<Record<string, unknown>>>({ method: 'GET', path: `/rest/api/${apiVersion}/field` })
      .then(list => list.map(normalizeFieldDef));
    return catalogPromise;
  }

  function permitted(def: JiraFieldDef): boolean {
    return isFieldPermitted(policy, def);
  }

  function standardDef(id: string, catalog: JiraFieldDef[]): JiraFieldDef {
    return catalog.find(f => f.id === id) ?? { id, name: id, custom: false, clauseNames: [] };
  }

  async function planFields(requested?: string[]): Promise<FieldPlan> {
    if (!policy && !requested?.length) return { apiFields: DEFAULT_FIELDS, customDefs: [] };

    const catalog = await getCatalog();
    const standard: string[] = [];
    const customDefs: JiraFieldDef[] = [];

    for (const ref of requested ?? []) {
      const all = findFieldDefs(catalog, ref);
      if (all.length === 0) {
        // Unknown to the catalog: keep the pass-through behaviour unless the policy names it.
        if (!isFieldPermitted(policy, { id: ref, name: ref, custom: false })) throw fieldNotPermitted(ref);
        standard.push(ref);
        continue;
      }
      const allowed = all.filter(permitted);
      if (allowed.length === 0) throw fieldNotPermitted(ref);
      if (allowed.length > 1) {
        const ids = allowed.map(f => f.id).join(', ');
        throw new ConfigError(`Field name "${ref}" is ambiguous; use one of: ${ids}`);
      }
      const def = allowed[0]!;
      if (def.custom) customDefs.push(def);
      else standard.push(def.id);
    }

    // Allow-listed custom fields are included by default when no fields were requested.
    if (!requested?.length && policy?.allow.length) {
      customDefs.push(...catalog.filter(f => f.custom && isExplicitlyAllowed(policy, f) && permitted(f)));
    }

    const base = (standard.length ? standard : DEFAULT_FIELDS).filter(id => permitted(standardDef(id, catalog)));
    return { apiFields: [...base, ...customDefs.map(d => d.id)], customDefs };
  }

  async function assertJqlPermitted(jql: string): Promise<void> {
    if (!policy) return;
    const restricted = (await getCatalog()).filter(f => !permitted(f));
    if (findRestrictedJqlReference(jql, restricted)) {
      throw new ConfigError('JQL references a field that is restricted by the configured field policy.');
    }
  }

  async function assertFieldsPermitted(fieldIds: string[]): Promise<void> {
    if (!policy || fieldIds.length === 0) return;
    const catalog = await getCatalog();
    for (const id of fieldIds) {
      if (!permitted(standardDef(id, catalog))) throw fieldNotPermitted(id);
    }
  }

  async function resolveCustomWrites(
    inputs: JiraCustomFieldInput[] | undefined,
  ): Promise<{ fields: Record<string, unknown>; sprintId?: number }> {
    const fields: Record<string, unknown> = {};
    let sprintId: number | undefined;
    if (!inputs?.length) return { fields };

    const catalog = await getCatalog();
    for (const input of inputs) {
      const allowed = findFieldDefs(catalog, input.field).filter(permitted);
      if (allowed.length === 0) throw fieldNotPermitted(input.field);
      if (allowed.length > 1) {
        const ids = allowed.map(f => f.id).join(', ');
        throw new ConfigError(`Field name "${input.field}" is ambiguous; use one of: ${ids}`);
      }
      const def = allowed[0]!;
      const write = toFieldWrite(def, input.value, deployment, input.json);
      if (write.sprintId !== undefined) sprintId = write.sprintId;
      else fields[def.id] = write.value;
    }
    return { fields, sprintId };
  }

  async function addToSprint(sprintId: number, issueKey: string): Promise<void> {
    await http.request<void>({
      method: 'POST',
      path: `/rest/agile/1.0/sprint/${sprintId}/issue`,
      body: { issues: [issueKey] },
    });
  }

  return {
    async search(jql: string, opts: SearchOptions = {}): Promise<JiraSearchResult> {
      await assertJqlPermitted(jql);
      const { apiFields: fields, customDefs } = await planFields(opts.fields);
      const limit = opts.limit ?? 20;
      const offset = opts.offset ?? 0;

      if (deployment === 'cloud') {
        // Cloud v3: POST /rest/api/3/search/jql
        const response = await http.request<JiraCloudSearchResponse>({
          method: 'POST',
          path: '/rest/api/3/search/jql',
          body: {
            jql,
            fields,
            maxResults: limit,
            ...(offset > 0 ? { startAt: offset } : {}),
          },
        });

        const issues = response.issues.map(raw => normalizeIssue(raw, baseUrl, deployment, customDefs));
        return {
          issues,
          total: response.total ?? issues.length,
          hasMore: !!response.nextPageToken,
        };
      } else {
        // Server v2: GET /rest/api/2/search
        const response = await http.request<JiraServerSearchResponse>({
          method: 'GET',
          path: '/rest/api/2/search',
          query: {
            jql,
            fields: fields.join(','),
            startAt: offset,
            maxResults: limit,
          },
        });

        const issues = response.issues.map(raw => normalizeIssue(raw, baseUrl, deployment, customDefs));
        return {
          issues,
          total: response.total,
          hasMore: (response.startAt + response.issues.length) < response.total,
        };
      }
    },

    async getIssue(issueKey: string, opts: GetIssueOptions = {}): Promise<JiraIssue> {
      const { apiFields: fields, customDefs } = await planFields(opts.fields);
      const expand = opts.expand ?? [];

      const raw = await http.request<JiraRawIssue>({
        method: 'GET',
        path: `/rest/api/${apiVersion}/issue/${issueKey}`,
        query: {
          fields: fields.join(','),
          ...(expand.length ? { expand: expand.join(',') } : {}),
        },
      });

      const issue = normalizeIssue(raw, baseUrl, deployment, customDefs);

      // Limit comments if requested
      if (opts.commentLimit !== undefined && issue.comments.length > opts.commentLimit) {
        issue.comments = issue.comments.slice(-opts.commentLimit);
      }

      return issue;
    },

    async getAttachments(issueKey: string): Promise<JiraAttachment[]> {
      await assertFieldsPermitted(['attachment']);
      const raw = await http.request<JiraRawIssue>({
        method: 'GET',
        path: `/rest/api/${apiVersion}/issue/${issueKey}`,
        query: { fields: 'attachment' },
      });
      const rawAttachments = (raw.fields.attachment as JiraRawAttachment[] | undefined) ?? [];
      return normalizeAttachments(rawAttachments);
    },

    async downloadAttachment(url: string, destPath: string): Promise<void> {
      const relativePath = url.startsWith(baseUrl) ? url.slice(baseUrl.length) : url;
      await http.downloadToFile(relativePath, destPath);
    },

    async createIssue(input: JiraCreateIssueInput): Promise<JiraCreateIssueResult> {

      const fields: Record<string, unknown> = {
        project: { key: input.projectKey },
        issuetype: { name: input.issueType },
        summary: input.summary,
      };

      if (input.description) {
        fields.description = deployment === 'cloud'
          ? textToAdf(input.description)
          : input.description;
      }

      if (input.assignee) {
        fields.assignee = deployment === 'cloud'
          ? { accountId: input.assignee }
          : { name: input.assignee };
      }

      if (input.priority) {
        fields.priority = { name: input.priority };
      }

      if (input.labels?.length) {
        fields.labels = input.labels;
      }

      if (input.components?.length) {
        fields.components = input.components.map(name => ({ name }));
      }

      if (input.parentKey) {
        fields.parent = { key: input.parentKey };
      }

      const custom = await resolveCustomWrites(input.customFields);
      Object.assign(fields, custom.fields);
      await assertFieldsPermitted(Object.keys(fields));

      const response = await http.request<{ id: string; key: string; self: string }>({
        method: 'POST',
        path: `/rest/api/${apiVersion}/issue`,
        body: { fields },
      });

      if (custom.sprintId !== undefined) await addToSprint(custom.sprintId, response.key);

      return {
        key: response.key,
        id: response.id,
        url: `${baseUrl}/browse/${response.key}`,
      };
    },

    async updateIssue(issueKey: string, input: JiraUpdateIssueInput): Promise<void> {

      const fields: Record<string, unknown> = {};
      const update: Record<string, unknown[]> = {};

      if (input.summary !== undefined) {
        fields.summary = input.summary;
      }

      if (input.description !== undefined) {
        fields.description = deployment === 'cloud'
          ? textToAdf(input.description)
          : input.description;
      }

      if (input.assignee !== undefined) {
        fields.assignee = deployment === 'cloud'
          ? { accountId: input.assignee }
          : { name: input.assignee };
      }

      if (input.priority !== undefined) {
        fields.priority = { name: input.priority };
      }

      if (input.labels !== undefined) {
        fields.labels = input.labels;
      }

      if (input.components !== undefined) {
        fields.components = input.components.map(name => ({ name }));
      }

      // Incremental label operations use the "update" field
      if (input.addLabels?.length) {
        update.labels = [...(update.labels ?? []), ...input.addLabels.map(l => ({ add: l }))];
      }
      if (input.removeLabels?.length) {
        update.labels = [...(update.labels ?? []), ...input.removeLabels.map(l => ({ remove: l }))];
      }

      const custom = await resolveCustomWrites(input.customFields);
      Object.assign(fields, custom.fields);
      await assertFieldsPermitted([...Object.keys(fields), ...Object.keys(update)]);

      const body: Record<string, unknown> = {};
      if (Object.keys(fields).length > 0) body.fields = fields;
      if (Object.keys(update).length > 0) body.update = update;

      if (Object.keys(body).length > 0 || custom.sprintId === undefined) {
        await http.request<void>({
          method: 'PUT',
          path: `/rest/api/${apiVersion}/issue/${issueKey}`,
          body,
        });
      }

      if (custom.sprintId !== undefined) await addToSprint(custom.sprintId, issueKey);
    },

    async addComment(issueKey: string, body: string): Promise<JiraAddCommentResult> {
      await assertFieldsPermitted(['comment']);

      const requestBody = deployment === 'cloud'
        ? { body: textToAdf(body) }
        : { body };

      const response = await http.request<Record<string, unknown>>({
        method: 'POST',
        path: `/rest/api/${apiVersion}/issue/${issueKey}/comment`,
        body: requestBody,
      });

      return {
        id: String(response.id ?? ''),
        body: deployment === 'cloud' && typeof response.body === 'object'
          ? adfToMarkdown(response.body)
          : String(response.body ?? ''),
        author: extractString(response.author) ?? 'Unknown',
        created: String(response.created ?? ''),
      };
    },

    async getTransitions(issueKey: string): Promise<JiraTransition[]> {

      const response = await http.request<{ transitions: Array<Record<string, unknown>> }>({
        method: 'GET',
        path: `/rest/api/${apiVersion}/issue/${issueKey}/transitions`,
      });

      return response.transitions.map(t => {
        const to = t.to as Record<string, unknown> | undefined;
        const statusCategory = to?.statusCategory as Record<string, unknown> | undefined;
        return {
          id: String(t.id ?? ''),
          name: String(t.name ?? ''),
          to: {
            id: String(to?.id ?? ''),
            name: String(to?.name ?? ''),
            statusCategory: String(statusCategory?.key ?? ''),
          },
        };
      });
    },

    async transitionIssue(
      issueKey: string,
      transitionId: string,
      opts: { comment?: string; resolution?: string } = {},
    ): Promise<void> {

      await assertFieldsPermitted([...(opts.resolution ? ['resolution'] : []), ...(opts.comment ? ['comment'] : [])]);

      const body: Record<string, unknown> = {
        transition: { id: transitionId },
      };

      if (opts.resolution) {
        body.fields = { resolution: { name: opts.resolution } };
      }

      if (opts.comment) {
        const commentBody = deployment === 'cloud'
          ? { body: textToAdf(opts.comment) }
          : { body: opts.comment };
        body.update = {
          comment: [{ add: commentBody }],
        };
      }

      await http.request<void>({
        method: 'POST',
        path: `/rest/api/${apiVersion}/issue/${issueKey}/transitions`,
        body,
      });
    },
  };
}
