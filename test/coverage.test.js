/**
 * Workflow coverage parser, run against fixtures shaped like Jira's
 * /rest/api/3/workflows/search and /rest/api/3/workflow/rule/config responses.
 * (Field names follow Jira's published response schema; verify on a real site.)
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const searchFixture = {
  isLast: true,
  statuses: [
    { statusReference: 's-todo', name: 'To Do', statusCategory: 'TODO' },
    { statusReference: 's-prog', name: 'In Progress', statusCategory: 'IN_PROGRESS' },
    { statusReference: 's-done', name: 'Done', statusCategory: 'DONE' },
  ],
  values: [
    {
      id: { name: 'Software workflow', entityId: 'w1' },
      name: 'Software workflow',
      transitions: [
        { id: '11', name: 'Start work', toStatusReference: 's-prog', validators: [] },
        { id: '31', name: 'Finish', toStatusReference: 's-done', validators: [{ ruleKey: 'forge:app:preflight-done-gate', parameters: {} }] },
      ],
    },
    {
      id: { name: 'Bug workflow', entityId: 'w2' },
      name: 'Bug workflow',
      transitions: [{ id: '41', name: 'Resolve', toStatusReference: 's-done', validators: [] }],
    },
  ],
};
const ruleConfigFixture = {
  isLast: true,
  values: [{ workflowId: { name: 'Software workflow' }, validators: [{ key: 'preflight-build-gate', transition: { id: 11, name: 'Start work' } }] }],
};

mock.module('@forge/api', {
  defaultExport: {
    asApp: () => ({
      requestJira: async (path) => ({
        ok: true,
        status: 200,
        json: async () => (String(path).includes('workflows/search') ? searchFixture : ruleConfigFixture),
        text: async () => '',
      }),
    }),
    asUser: () => ({}),
  },
  namedExports: { route: (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(values[i]) : ''), '') },
});

const { getWorkflowCoverage } = await import('../src/jira.js');

test('coverage finds unprotected Done transitions and recognises both detection paths', async () => {
  const rows = await getWorkflowCoverage({ buildKey: 'preflight-build-gate', doneKey: 'preflight-done-gate' });
  const byKey = Object.fromEntries(rows.map((r) => [`${r.workflow}|${r.transition}`, r]));
  assert.equal(rows.length, 3);
  assert.equal(byKey['Software workflow|Start work'].protected, true, 'found via rule/config');
  assert.equal(byKey['Software workflow|Finish'].protected, true, 'found inline on the transition');
  assert.equal(byKey['Bug workflow|Resolve'].protected, false);
  assert.equal(byKey['Bug workflow|Resolve'].stage, 'done');
});

test('coverage: a workflow\'s own status list (no categories) does not blank the top-level categories', async () => {
  searchFixture.values[0].statuses = [{ statusReference: 's-prog' }, { statusReference: 's-done' }];
  const rows = await getWorkflowCoverage({ buildKey: 'preflight-build-gate', doneKey: 'preflight-done-gate' });
  assert.equal(rows.length, 3, 'categories survive the per-workflow status list');
  delete searchFixture.values[0].statuses;
});

test('coverage: global "Any status" transitions and name fallback', async () => {
  const saved = searchFixture.statuses;
  searchFixture.statuses = [{ statusReference: 's-prog', name: 'In Progress' }, { statusReference: 's-done', name: 'Done' }];
  searchFixture.values[0].transitions.push({ id: '51', name: 'Done', type: 'GLOBAL', toStatusReference: 's-done', links: [], validators: [] });
  const rows = await getWorkflowCoverage({ buildKey: 'preflight-build-gate', doneKey: 'preflight-done-gate' });
  assert.ok(rows.some((r) => r.transition === 'Done' && r.stage === 'done'), 'global transition into Done is listed');
  searchFixture.statuses = saved;
  searchFixture.values[0].transitions.pop();
});
