/**
 * Preflight admin page (UI Kit): Jira settings > Apps > Preflight.
 *
 * Tabs:
 *   Rules      review, edit, activate or deactivate rules (drafts are never enforced)
 *   Test       paste sample ticket text and see which rules would match
 *   Demo setup one click to activate the POPIA pack and create sample work items
 *   Settings   approvers, fail-closed behaviour, separation of duties
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, DynamicTable, Heading, Inline, Label, List, ListItem, Lozenge, SectionMessage, Select, Spinner, Stack,
  Strong, Tab, TabList, TabPanel, Tabs, Tag, TagGroup, Text, TextArea, Textfield, Toggle, UserPicker, Em, Code,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const BLANK = {
  id: '', title: '', clause: '', policyRef: '', summary: '', severity: 'high',
  keywords: '', labels: '',
  requirements: JSON.stringify(
    [
      { id: 'purpose', label: 'Why this data is needed', type: 'answer' },
      { id: 'io-approval', label: 'Information Officer approval', type: 'approval' },
    ],
    null,
    2,
  ),
};

function toForm(rule) {
  return {
    id: rule.id,
    title: rule.title,
    clause: rule.clause || '',
    policyRef: rule.policyRef || '',
    summary: rule.summary || '',
    severity: rule.severity || 'high',
    keywords: (rule.triggers?.keywords || []).join('\n'),
    labels: (rule.triggers?.labels || []).join(', '),
    requirements: JSON.stringify(rule.requirements || [], null, 2),
  };
}

function RuleEditor({ initial, originalId, onSave, onCancel, onDelete, busy }) {
  const [form, setForm] = useState(initial);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const severities = [{ label: 'High', value: 'high' }, { label: 'Medium', value: 'medium' }];
  return (
    <Stack space="space.100">
      <Heading size="small">{originalId ? `Edit: ${initial.title}` : 'New rule'}</Heading>
      {!originalId && (
        <>
          <Label labelFor="r-id">Rule id (lowercase, dashes)</Label>
          <Textfield id="r-id" value={form.id} onChange={set('id')} />
        </>
      )}
      <Label labelFor="r-title">Title</Label>
      <Textfield id="r-title" value={form.title} onChange={set('title')} />
      <Label labelFor="r-clause">Legal or policy clause shown to users</Label>
      <Textfield id="r-clause" value={form.clause} onChange={set('clause')} />
      <Label labelFor="r-policy">Internal policy reference (optional)</Label>
      <Textfield id="r-policy" value={form.policyRef} onChange={set('policyRef')} />
      <Label labelFor="r-summary">Plain-language summary</Label>
      <TextArea id="r-summary" value={form.summary} onChange={set('summary')} />
      <Label labelFor="r-sev">Severity</Label>
      <Select inputId="r-sev" options={severities} value={severities.find((s) => s.value === form.severity)} onChange={(o) => setForm({ ...form, severity: o.value })} />
      <Label labelFor="r-kw">Trigger phrases (one per line; matched on whole words, case-insensitive)</Label>
      <TextArea id="r-kw" value={form.keywords} onChange={set('keywords')} />
      <Label labelFor="r-labels">Trigger labels (comma separated)</Label>
      <Textfield id="r-labels" value={form.labels} onChange={set('labels')} />
      <Label labelFor="r-req">Requirements (JSON). Types: answer, choice (with options), link, approval</Label>
      <TextArea id="r-req" value={form.requirements} onChange={set('requirements')} />
      <Inline space="space.100">
        <Button appearance="primary" isDisabled={busy} onClick={() => onSave(originalId, form)}>Save rule</Button>
        <Button appearance="subtle" onClick={onCancel}>Cancel</Button>
        {originalId && <Button appearance="danger" isDisabled={busy} onClick={() => onDelete(originalId)}>Delete</Button>}
      </Inline>
    </Stack>
  );
}

const App = () => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // { originalId, form }
  const [sample, setSample] = useState('Add a field for the customer SA ID number and sync it to our CRM vendor in the US region.');
  const [testResult, setTestResult] = useState(null);
  const [projectKey, setProjectKey] = useState('');

  const call = async (name, payload = {}) => {
    setBusy(true);
    try {
      const next = await invoke(name, payload);
      if (next?.ok === false) {
        setError(next.error);
        return null;
      }
      setError(null);
      if (next.rules) setState(next);
      setNotice(next.notice || null);
      return next;
    } catch (e) {
      setError(e.message || String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    call('getState');
  }, []);

  if (!state && !error) return <Spinner label="Loading Preflight settings" />;
  if (!state) return <SectionMessage appearance="error" title="Preflight settings could not load"><Text>{error}</Text></SectionMessage>;

  const rows = state.rules.map((rule) => ({
    key: rule.id,
    cells: [
      { key: 'title', content: <Text><Strong>{rule.title}</Strong></Text> },
      { key: 'clause', content: <Tag text={rule.clause} /> },
      { key: 'status', content: <Lozenge appearance={rule.status === 'active' ? 'success' : 'default'}>{rule.status}</Lozenge> },
      { key: 'reqs', content: <Text>{(rule.requirements || []).length}</Text> },
      {
        key: 'actions',
        content: (
          <Inline space="space.050">
            <Button isDisabled={busy} onClick={() => call('setRuleStatus', { id: rule.id, status: rule.status === 'active' ? 'draft' : 'active' })}>
              {rule.status === 'active' ? 'Deactivate' : 'Activate'}
            </Button>
            <Button appearance="subtle" onClick={() => setEditing({ originalId: rule.id, form: toForm(rule) })}>Edit</Button>
          </Inline>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Heading size="medium">Preflight</Heading>
      <Text>
        Preflight turns your privacy policy into review steps that Jira enforces before work is closed. Rules start as
        drafts; only active rules are enforced. The POPIA pack is an editable starter set of review rules, not a complete
        POPIA assessment and not legal advice: have your Information Officer or privacy counsel review each rule before
        activating it.
      </Text>
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {notice && <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage>}

      <Tabs id="preflight-admin">
        <TabList>
          <Tab>Rules</Tab>
          <Tab>Test a rule</Tab>
          <Tab>Demo setup</Tab>
          <Tab>Settings</Tab>
        </TabList>

        <TabPanel>
          <Stack space="space.150">
            {editing ? (
              <RuleEditor
                key={editing.originalId || 'new'}
                initial={editing.form}
                originalId={editing.originalId}
                busy={busy}
                onCancel={() => setEditing(null)}
                onDelete={async (id) => { if (await call('deleteRule', { id })) setEditing(null); }}
                onSave={async (originalId, form) => {
                  if (await call('saveRule', { originalId, rule: form })) setEditing(null);
                }}
              />
            ) : (
              <>
                <DynamicTable
                  head={{ cells: ['Rule', 'Clause', 'Status', 'Requirements', ''].map((c, i) => ({ key: `h${i}`, content: c })) }}
                  rows={rows}
                  emptyView="No rules yet. Use Demo setup or restore the POPIA starter pack."
                />
                <Inline space="space.100">
                  <Button onClick={() => setEditing({ originalId: null, form: BLANK })}>New rule</Button>
                  <Button appearance="subtle" isDisabled={busy} onClick={() => call('resetPack')}>Restore POPIA starter pack (as drafts)</Button>
                </Inline>
              </>
            )}
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.100">
            <Label labelFor="sample">Paste a ticket summary and description</Label>
            <TextArea id="sample" value={sample} onChange={(e) => setSample(e.target.value)} />
            <Inline>
              <Button appearance="primary" isDisabled={busy} onClick={async () => setTestResult(await call('testText', { text: sample }))}>
                Test against all rules
              </Button>
            </Inline>
            {testResult && testResult.matches.length === 0 && <Text>No rules match this text.</Text>}
            {testResult?.matches.map((m) => (
              <Stack key={m.ruleId} space="space.050">
                <Inline space="space.100" alignBlock="center" shouldWrap>
                  <Text><Strong>{m.title}</Strong></Text>
                  <Tag text={m.clause} />
                  <Lozenge appearance={m.enforced ? 'success' : 'default'}>{m.enforced ? 'active: would block' : 'draft: would not block'}</Lozenge>
                </Inline>
                <TagGroup>{m.keywords.map((k) => <Tag key={k} text={k} />)}</TagGroup>
                {m.snippet && <Text><Em>{m.snippet}</Em></Text>}
                <Text>Requires: {m.requirements.join('; ')}</Text>
              </Stack>
            ))}
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.150">
            <Text>
              This activates the POPIA starter pack and creates five sample work items (four that touch personal
              information and one control item that does not) in the project you choose.
            </Text>
            <Label labelFor="project">Project key</Label>
            <Inline space="space.100" alignBlock="center">
              <Textfield id="project" value={projectKey} placeholder="PRIV" onChange={(e) => setProjectKey(e.target.value)} />
              <Button appearance="primary" isDisabled={!projectKey.trim() || busy} onClick={() => call('loadDemo', { projectKey })}>
                Load demo
              </Button>
            </Inline>
            <SectionMessage appearance="information" title="Then attach the gate to your workflow (one time)">
              <List type="ordered">
                <ListItem><Text>Open the project → Project settings → Workflows (company-managed) or the board's workflow editor (team-managed).</Text></ListItem>
                <ListItem><Text>Select the transition into Done (or "Any status → Done") → Rules / Validators → Add rule.</Text></ListItem>
                <ListItem><Text>Choose <Strong>Preflight privacy review gate</Strong> and publish the workflow.</Text></ListItem>
                <ListItem><Text>Repeat for every workflow whose transitions lead to Done. The status list below shows each project where the gate has run.</Text></ListItem>
                <ListItem><Text>Try moving a sample work item to Done. It is blocked until the Preflight panel is complete.</Text></ListItem>
              </List>
            </SectionMessage>
            <Text><Strong>Gate status by project</Strong> (updated when the gate runs)</Text>
            {Object.keys(state.gates || {}).length === 0 ? (
              <Text><Em>The gate has not run in any project yet. Attach it, then try a transition.</Em></Text>
            ) : (
              Object.entries(state.gates).map(([key, g]) => (
                <Text key={key}>{key}: gate active, last ran {new Date(g.lastRunAt).toLocaleString()} on {g.lastIssueKey}</Text>
              ))
            )}
            <Text>Tip: search for blocked work with JQL <Code>preflightStatus = blocked</Code>.</Text>
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.150">
            <Label labelFor="approvers">
              Approvers (Information Officer and deputies). Once you name approvers, only they can approve. With none, Jira
              admins approve (small-team mode).
            </Label>
            <UserPicker
              name="approvers"
              label="Approvers"
              isMulti
              defaultValue={state.settings.approverAccountIds}
              onChange={(users) => {
                const list = (Array.isArray(users) ? users : users ? [users] : []).map((u) => u.id || u.accountId).filter(Boolean);
                call('saveSettings', { approverAccountIds: list });
              }}
            />
            <Inline space="space.100" alignBlock="center">
              <Toggle id="sod" isChecked={Boolean(state.settings.separationOfDuties)} onChange={() => call('saveSettings', { separationOfDuties: !state.settings.separationOfDuties })} />
              <Label labelFor="sod">Separation of duties: the reporter of a work item cannot approve it</Label>
            </Inline>
            <Inline space="space.100" alignBlock="center">
              <Toggle id="fail" isChecked={Boolean(state.settings.failClosed)} onChange={() => call('saveSettings', { failClosed: !state.settings.failClosed })} />
              <Label labelFor="fail">
                Fail closed (recommended, on by default): if Preflight cannot evaluate a work item, the transition is held with
                a clear message. Turn off to let work through and log the error instead.
              </Label>
            </Inline>
          </Stack>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
