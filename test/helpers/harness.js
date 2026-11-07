/**
 * Shared in-memory harness (copied from flow.test.js) for the exploit tests.
 * End-to-end flows with Jira and Forge storage replaced by in-memory fakes.
 * The KVS fake implements FAIL_IF_EXISTS and prefix queries, so write-once
 * audit and locking are exercised for real.
 */
import { mock } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
const comments = [];
const properties = new Map();
const created = [];
let admins = new Set(['admin-1']);
let currentUser = 'dev-1';
let coverageRows = [];
const issues = {};
const addIssue = (n, summary, extra = {}) => {
  issues[`PRIV-${n}`] = { id: String(10000 + n), key: `PRIV-${n}`, summary, projectKey: 'PRIV', reporterAccountId: 'dev-1', labels: [], text: summary, ...extra };
};
addIssue(1, 'Add SA ID number field to customer signup');
addIssue(5, 'Update footer copyright year');
const byIdOrKey = (k) => issues[k] || Object.values(issues).find((i) => i.id === String(k));

mock.module('@forge/kvs', {
  namedExports: {
    WhereConditions: { beginsWith: (v) => ({ beginsWith: v }) },
    kvs: {
      get: async (k) => (store.has(k) ? structuredClone(store.get(k)) : undefined),
      set: async (k, v, opts) => {
        if (opts?.keyPolicy === 'FAIL_IF_EXISTS' && store.has(k)) {
          const e = new Error('KEY_ALREADY_EXISTS');
          e.code = 'KEY_ALREADY_EXISTS';
          throw e;
        }
        store.set(k, structuredClone(v));
      },
      delete: async (k) => void store.delete(k),
      query: () => {
        let prefix = '';
        const q = {
          where: (_f, c) => { prefix = c.beginsWith; return q; },
          limit: () => q,
          cursor: () => q,
          getMany: async () => ({ results: [...store.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value: structuredClone(value) })) }),
        };
        return q;
      },
    },
  },
});

mock.module(new URL('../../src/jira.js', import.meta.url).href, {
  namedExports: {
    getWorkItem: async (k) => {
      const i = byIdOrKey(k);
      if (!i) throw new Error(`Reading ${k} failed (404)`);
      return structuredClone(i);
    },
    currentUserIsJiraAdmin: async () => admins.has(currentUser),
    setPreflightProperty: async (id, v) => void properties.set(id, v),
    getPreflightProperty: async (id) => properties.get(id) || null,
    addComment: async (key, body) => void comments.push({ key, body }),
    getCreatableIssueTypes: async () => [{ id: '1', name: 'Task' }],
    createIssue: async (projectKey, typeId, summary) => {
      const n = 100 + created.length;
      addIssue(n, summary);
      created.push(`PRIV-${n}`);
      return { key: `PRIV-${n}` };
    },
    getWorkflowCoverage: async () => coverageRows,
    adfToText: (n) => (typeof n === 'string' ? n : JSON.stringify(n || '')),
    getDisplayName: async (id) => ({ 'io-1': 'Thandi M.' }[id] || null),
  },
});

mock.module('@forge/api', {
  defaultExport: { asUser: () => ({ requestJira: async () => ({ ok: true, json: async () => ({ issues: Object.values(issues).map((i) => ({ key: i.key })) }) }) }) },
  namedExports: { route: (strings, ...vals) => strings.reduce((a, s, i) => a + s + (vals[i] ?? ''), '') },
});

mock.module('@forge/resolver', {
  defaultExport: class {
    constructor() { this.defs = {}; }
    define(name, fn) { this.defs[name] = fn; }
    getDefinitions() { return this.defs; }
  },
});

const backend = await import('../../src/backend.js');
const service = await import('../../src/service.js');
const governance = await import('../../src/governance.js');
const store_ = await import('../../src/store.js');
const { adminHandler } = await import('../../src/resolvers/admin.js');
const { panelHandler } = await import('../../src/resolvers/panel.js');
const { inboxHandler } = await import('../../src/resolvers/inbox.js');

const as = (user) => { currentUser = user; };
const panel = (name, issueKey, payload = {}) =>
  panelHandler[name]({ payload, context: { accountId: currentUser, extension: { issue: { id: byIdOrKey(issueKey).id } } } });
const admin = (name, payload = {}) => adminHandler[name]({ payload, context: { accountId: currentUser } });
const inbox = (name, payload = {}) => inboxHandler[name]({ payload, context: { accountId: currentUser } });
const getUser = () => currentUser;
const setAdmins = (list) => { admins = new Set(list); };
export { store, comments, properties, created, issues, addIssue, byIdOrKey, backend, service, governance, store_, as, panel, admin, inbox, getUser, setAdmins, adminHandler };
