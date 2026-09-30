import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiraClient } from '../src/clients/jira.js';
import { flattenFieldValue, toFieldWrite } from '../src/clients/jira-fields.js';
import { parseFieldSpecs } from '../src/commands/jira/field-option.js';
import type { HttpClient, RequestOptions } from '../src/http.js';
import type { JiraFieldDef } from '../src/types/jira.js';

function def(type: string, extra: Partial<NonNullable<JiraFieldDef['schema']>> = {}): JiraFieldDef {
  return { id: 'customfield_1', name: 'F', custom: true, clauseNames: [], schema: { type, ...extra } };
}

test('toFieldWrite converts by schema type', () => {
  assert.deepEqual(toFieldWrite(def('string'), 'x', 'server').value, 'x');
  assert.deepEqual(toFieldWrite(def('number'), '3.5', 'server').value, 3.5);
  assert.deepEqual(toFieldWrite(def('date'), '2026-01-31', 'server').value, '2026-01-31');
  assert.deepEqual(toFieldWrite(def('option'), 'Red', 'server').value, { value: 'Red' });
  assert.deepEqual(toFieldWrite(def('option-with-child'), 'A / B', 'server').value, { value: 'A', child: { value: 'B' } });
  assert.deepEqual(toFieldWrite(def('option-with-child'), 'A', 'server').value, { value: 'A' });
  assert.deepEqual(toFieldWrite(def('project'), 'PROJ', 'server').value, { key: 'PROJ' });
  assert.deepEqual(toFieldWrite(def('array', { items: 'string' }), 'a, b', 'server').value, ['a', 'b']);
  assert.deepEqual(toFieldWrite(def('array', { items: 'option' }), 'a,b', 'server').value, [{ value: 'a' }, { value: 'b' }]);
  assert.deepEqual(toFieldWrite(def('array', { items: 'version' }), 'v1', 'server').value, [{ name: 'v1' }]);
});

test('toFieldWrite uses the deployment-specific user shape', () => {
  assert.deepEqual(toFieldWrite(def('user'), 'abc', 'cloud').value, { accountId: 'abc' });
  assert.deepEqual(toFieldWrite(def('user'), 'jdoe', 'server').value, { name: 'jdoe' });
  assert.deepEqual(toFieldWrite(def('array', { items: 'user' }), 'a,b', 'server').value, [{ name: 'a' }, { name: 'b' }]);
});

test('toFieldWrite rejects bad numbers and bad JSON', () => {
  assert.throws(() => toFieldWrite(def('number'), 'abc', 'server'), /expects a number/);
  assert.throws(() => toFieldWrite(def('number'), '', 'server'), /expects a number/);
  assert.throws(() => toFieldWrite(def('string'), '{oops', 'server', true), /not valid JSON/);
});

test('toFieldWrite raw JSON and unknown types', () => {
  assert.deepEqual(toFieldWrite(def('string'), '{"id":"10"}', 'server', true).value, { id: '10' });
  assert.deepEqual(toFieldWrite(def('any'), '42', 'server').value, 42);
  assert.deepEqual(toFieldWrite(def('any'), 'Platform', 'server').value, 'Platform');
});

test('toFieldWrite sprint takes a numeric id only', () => {
  const sprint = def('array', { items: 'json', custom: 'com.pyxis.greenhopper.jira:gh-sprint' });
  assert.deepEqual(toFieldWrite(sprint, ' 12 ', 'server'), { sprintId: 12 });
  assert.throws(() => toFieldWrite(sprint, 'Sprint 12', 'server'), /numeric sprint ID/);
});

test('toFieldWrite textarea is ADF on Cloud only', () => {
  const textarea = def('string', { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' });
  const cloud = toFieldWrite(textarea, 'hello', 'cloud').value as { type: string };
  assert.equal(cloud.type, 'doc');
  assert.equal(toFieldWrite(textarea, 'hello', 'server').value, 'hello');
});

test('flattenFieldValue handles common shapes', () => {
  const plain = def('string');
  assert.equal(flattenFieldValue(null, plain), null);
  assert.equal(flattenFieldValue(undefined, plain), null);
  assert.equal(flattenFieldValue(5, plain), 5);
  assert.equal(flattenFieldValue({ value: 'Red' }, plain), 'Red');
  assert.equal(flattenFieldValue({ displayName: 'Jane' }, plain), 'Jane');
  assert.equal(flattenFieldValue({ value: 'A', child: { value: 'B' } }, plain), 'A / B');
  assert.deepEqual(flattenFieldValue([{ name: 'x' }, { name: 'y' }], plain), ['x', 'y']);
  assert.deepEqual(flattenFieldValue({ weird: 1 }, plain), { weird: 1 });
});

test('flattenFieldValue converts ADF to text and Cloud sprint objects', () => {
  const adf = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi there' }] }] };
  assert.match(String(flattenFieldValue(adf, def('string'))), /hi there/);

  const sprint = def('array', { custom: 'com.pyxis.greenhopper.jira:gh-sprint' });
  assert.deepEqual(flattenFieldValue([{ id: 3, name: 'S3', state: 'closed', boardId: 9 }], sprint), [
    { id: 3, name: 'S3', state: 'closed', startDate: undefined, endDate: undefined, goal: undefined },
  ]);
});

test('parseFieldSpecs splits name, value and JSON marker', () => {
  assert.deepEqual(parseFieldSpecs(['Team=Platform', 'Note=a=b', 'Raw:={"a":1}']), [
    { field: 'Team', value: 'Platform', json: false },
    { field: 'Note', value: 'a=b', json: false },
    { field: 'Raw', value: '{"a":1}', json: true },
  ]);
  assert.deepEqual(parseFieldSpecs(undefined), []);
  assert.throws(() => parseFieldSpecs(['novalue']), /Expected name=value/);
  assert.throws(() => parseFieldSpecs(['=x']), /Expected name=value/);
  assert.throws(() => parseFieldSpecs([':=x']), /Field name is empty/);
});

test('Cloud client uses the v3 API and accountId for custom writes', async () => {
  const calls: RequestOptions[] = [];
  const http = {
    async request(opts: RequestOptions) {
      calls.push(opts);
      if (opts.path.endsWith('/field')) {
        return [{ id: 'customfield_2', name: 'Owner', custom: true, clauseNames: [], schema: { type: 'user' } }];
      }
      return undefined;
    },
  } as unknown as HttpClient;

  await createJiraClient(http, 'https://x.atlassian.net', 'cloud').updateIssue('P-1', {
    customFields: [{ field: 'owner', value: 'acc-1' }],
  });

  assert.equal(calls[0]?.path, '/rest/api/3/field');
  const put = calls.find(c => c.method === 'PUT');
  assert.equal(put?.path, '/rest/api/3/issue/P-1');
  assert.deepEqual(put?.body, { fields: { customfield_2: { accountId: 'acc-1' } } });
});

test('ambiguous field names ask for an ID', async () => {
  const http = {
    async request(opts: RequestOptions) {
      if (opts.path.endsWith('/field')) {
        return [
          { id: 'customfield_1', name: 'Team', custom: true, clauseNames: [], schema: { type: 'option' } },
          { id: 'customfield_2', name: 'Team', custom: true, clauseNames: [], schema: { type: 'option' } },
        ];
      }
      return undefined;
    },
  } as unknown as HttpClient;
  await assert.rejects(
    createJiraClient(http, 'https://j', 'server').updateIssue('P-1', { customFields: [{ field: 'Team', value: 'x' }] }),
    /ambiguous.*customfield_1, customfield_2/,
  );
});
