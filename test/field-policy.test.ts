import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiraClient } from '../src/clients/jira.js';
import type { HttpClient, RequestOptions } from '../src/http.js';
import { findRestrictedJqlReference, parseFieldPolicy } from '../src/field-policy.js';
import type { JiraFieldDef } from '../src/types/jira.js';

const CATALOG = [
  { id: 'summary', name: 'Summary', custom: false, clauseNames: ['summary'], schema: { type: 'string' } },
  { id: 'description', name: 'Description', custom: false, clauseNames: ['description'], schema: { type: 'string' } },
  { id: 'customfield_10020', name: 'Sprint', custom: true, clauseNames: ['cf[10020]', 'Sprint'],
    schema: { type: 'array', items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
  { id: 'customfield_10001', name: 'Team', custom: true, clauseNames: ['cf[10001]', 'Team'], schema: { type: 'option' } },
  { id: 'customfield_10500', name: 'Salary', custom: true, clauseNames: ['cf[10500]', 'Salary'], schema: { type: 'number' } },
];

function mockHttp(calls: RequestOptions[]): HttpClient {
  return {
    async request(opts: RequestOptions) {
      calls.push(opts);
      if (opts.path.endsWith('/field')) return CATALOG;
      if (opts.path.includes('/issue/') && opts.method === 'GET') {
        return {
          id: '1', key: 'P-1', self: '',
          fields: {
            summary: 'S',
            customfield_10020: ['com.atlassian.greenhopper.service.sprint.Sprint@ab[id=7,state=ACTIVE,name=Sprint, 7,startDate=<null>]'],
            customfield_10001: { value: 'Platform' },
            customfield_10500: 123456,
          },
        };
      }
      if (opts.path.endsWith('/issue') && opts.method === 'POST') return { id: '2', key: 'P-2', self: '' };
      return undefined;
    },
  } as unknown as HttpClient;
}

function client(policy: ReturnType<typeof parseFieldPolicy>, calls: RequestOptions[] = []) {
  return createJiraClient(mockHttp(calls), 'https://jira.example.com', 'server', policy);
}

test('allow-list exposes only listed custom fields by default', async () => {
  const issue = await client(parseFieldPolicy('Sprint,Team')).getIssue('P-1');
  assert.deepEqual(Object.keys(issue.customFields).sort(), ['Sprint', 'Team']);
  assert.deepEqual(issue.customFields.Sprint, [{ id: 7, name: 'Sprint, 7', state: 'ACTIVE', startDate: null }]);
  assert.equal(issue.customFields.Team, 'Platform');
});

test('blocked fields are never requested from Jira', async () => {
  const calls: RequestOptions[] = [];
  const issue = await client(parseFieldPolicy(undefined, 'customfield_10500,Description'), calls).getIssue('P-1', {
    fields: ['summary', 'Team'],
  });
  const fields = String(calls.find(c => c.method === 'GET' && c.path.includes('/issue/'))?.query?.fields);
  assert.ok(!fields.includes('customfield_10500'));
  assert.ok(!fields.includes('description'));
  assert.deepEqual(Object.keys(issue.customFields), ['Team']);
});

test('requesting a blocked or unlisted field fails', async () => {
  await assert.rejects(client(parseFieldPolicy(undefined, 'Salary')).getIssue('P-1', { fields: ['Salary'] }), /not permitted/);
  await assert.rejects(client(parseFieldPolicy('Sprint')).getIssue('P-1', { fields: ['customfield_10500'] }), /not permitted/);
});

test('block-list wins over allow-list', async () => {
  await assert.rejects(client(parseFieldPolicy('Salary', 'Salary')).getIssue('P-1', { fields: ['Salary'] }), /not permitted/);
});

test('search rejects JQL that references a restricted field', async () => {
  const c = client(parseFieldPolicy('Sprint'));
  for (const jql of ['cf[10500] > 5', 'Salary > 5', '"Salary" > 5', 'project = P ORDER BY Salary']) {
    await assert.rejects(c.search(jql), /restricted/, jql);
  }
});

test('JQL guard ignores string values and permitted fields', () => {
  const restricted = CATALOG.filter(f => f.id === 'customfield_10500') as JiraFieldDef[];
  assert.equal(findRestrictedJqlReference('summary ~ "hello" AND sprint in openSprints()', restricted), undefined);
});

test('writes to restricted fields are rejected, allowed ones converted', async () => {
  const calls: RequestOptions[] = [];
  const c = client(parseFieldPolicy('Sprint,Team'), calls);
  await assert.rejects(
    c.updateIssue('P-1', { customFields: [{ field: 'Salary', value: '1' }] }),
    /not permitted/,
  );
  await c.updateIssue('P-1', { customFields: [{ field: 'Team', value: 'Platform' }, { field: 'Sprint', value: '9' }] });
  const put = calls.find(x => x.method === 'PUT');
  assert.deepEqual(put?.body, { fields: { customfield_10001: { value: 'Platform' } } });
  const sprint = calls.find(x => x.path === '/rest/agile/1.0/sprint/9/issue');
  assert.deepEqual(sprint?.body, { issues: ['P-1'] });
});

test('blocked standard fields cannot be written', async () => {
  await assert.rejects(
    client(parseFieldPolicy(undefined, 'description')).createIssue({
      projectKey: 'P', issueType: 'Task', summary: 's', description: 'secret',
    }),
    /not permitted/,
  );
});

test('no policy keeps default behaviour without fetching the catalog', async () => {
  const calls: RequestOptions[] = [];
  const issue = await client(undefined, calls).getIssue('P-1');
  assert.deepEqual(issue.customFields, {});
  assert.ok(!calls.some(c => c.path.endsWith('/field')));
});
