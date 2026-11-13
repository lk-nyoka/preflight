/**
 * Preflight admin page (UI Kit): Jira settings > Apps > Preflight.
 *
 * Tabs: Setup (demo, gates, coverage) · Rules · Test a rule · Settings · Audit log
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, Code, DynamicTable, Em, Heading, Inline, Label, List, ListItem, Lozenge, SectionMessage,
  Select, Spinner, Stack, Strong, Tab, TabList, TabPanel, Tabs, Tag, TagGroup, Text, TextArea, Textfield, Toggle,
  User, UserPicker,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const TYPE_OPTIONS = [
  { label: 'Written answer', value: 'answer' },
  { label: 'Pick from options', value: 'choice' },
  { label: 'Link (evidence)', value: 'link' },
  { label: 'Approver sign-off', value: 'approval' },
];
const STAGE_OPTIONS = [
  { label: 'Before work starts', value: 'build' },
  { label: 'Before Done', value: 'done' },
];
const lines = (arr) => (arr || []).join('\n');
const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');

function toForm(rule) {
  return {
    id: rule?.id || '',
    title: rule?.title || '',
    clause: rule?.clause || '',
    policyRef: rule?.policyRef || '',
    summary: rule?.summary || '',
    severity: rule?.severity || 'high',
    keywords: lines(rule?.triggers?.keywords),
    labels: (rule?.triggers?.labels || []).join(', '),
    exclude: lines(rule?.triggers?.exclude),
    contextual: (rule?.triggers?.contextual || []).map((g) => ({ terms: g.terms.join(', '), with: g.with.join(', ') })),
    requirements: (rule?.requirements || [
      { id: 'purpose', label: 'Why this data is needed', type: 'answer', stage: 'build' },
      { id: 'io-approval', label: 'Information Officer approval', type: 'approval', stage: 'build' },
    ]).map((r) => ({ ...r, options: (r.options || []).join(' | ') })),
    examplesMatch: lines(rule?.examples?.match),
    examplesIgnore: lines(rule?.examples?.ignore),
  };
}

function fromForm(form) {
  return {
    ...form,
    contextual: form.contextual.map((g) => ({ terms: g.terms, with: g.with })),
    requirements: form.requirements.map((r) => ({ ...r, options: String(r.options || '').split('|').map((s) => s.trim()).filter(Boolean) })),
  };
}

function RuleEditor({ rule, onSave, onCancel, onDelete, busy }) {
  const [form, setForm] = useState(() => toForm(rule));
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const setReq = (i, patch) => setForm({ ...form, requirements: form.requirements.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setCtx = (i, patch) => setForm({ ...form, contextual: form.contextual.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

  return (
    <Stack space="space.150">
      <Heading size="small">{rule ? `Edit: ${rule.title}` : 'New rule'}</Heading>
      {rule?.warnings?.length > 0 && (
        <SectionMessage appearance="warning" title="Examples failing">
          {rule.warnings.map((w) => <Text key={w}>{w}</Text>)}
        </SectionMessage>
      )}
      {!rule && (<><Label labelFor="r-id">Rule id (lowercase, dashes)</Label><Textfield id="r-id" value={form.id} onChange={set('id')} /></>)}
      <Label labelFor="r-title">Title</Label>
      <Textfield id="r-title" value={form.title} onChange={set('title')} />
      <Inline space="space.200" shouldWrap>
        <Stack space="space.050"><Label labelFor="r-clause">Clause shown to users</Label><Textfield id="r-clause" value={form.clause} onChange={set('clause')} /></Stack>
        <Stack space="space.050"><Label labelFor="r-policy">Internal policy reference</Label><Textfield id="r-policy" value={form.policyRef} onChange={set('policyRef')} /></Stack>
      </Inline>
      <Label labelFor="r-summary">What the review step requires (plain language)</Label>
      <TextArea id="r-summary" value={form.summary} onChange={set('summary')} />

      <Text><Strong>When does this rule apply?</Strong> Phrases match whole words, ignore case and plurals.</Text>
      <Label labelFor="r-kw">Trigger phrases (one per line)</Label>
      <TextArea id="r-kw" value={form.keywords} onChange={set('keywords')} />
      <Text>Context triggers: a word that only counts when another word is present too (e.g. "promo" only with "sms").</Text>
      {form.contextual.map((g, i) => (
        <Inline key={`ctx-${i}`} space="space.100" alignBlock="end" shouldWrap>
          <Stack space="space.050"><Label labelFor={`ctx-t-${i}`}>Words</Label><Textfield id={`ctx-t-${i}`} value={g.terms} onChange={(e) => setCtx(i, { terms: e.target.value })} /></Stack>
          <Stack space="space.050"><Label labelFor={`ctx-w-${i}`}>Only when one of</Label><Textfield id={`ctx-w-${i}`} value={g.with} onChange={(e) => setCtx(i, { with: e.target.value })} /></Stack>
          <Button appearance="subtle" onClick={() => setForm({ ...form, contextual: form.contextual.filter((_, j) => j !== i) })}>Remove</Button>
        </Inline>
      ))}
      <Inline><Button appearance="subtle" onClick={() => setForm({ ...form, contextual: [...form.contextual, { terms: '', with: '' }] })}>Add context trigger</Button></Inline>
      <Label labelFor="r-ex">Never match these phrases (one per line)</Label>
      <TextArea id="r-ex" value={form.exclude} onChange={set('exclude')} />
      <Label labelFor="r-labels">Trigger labels (comma separated)</Label>
      <Textfield id="r-labels" value={form.labels} onChange={set('labels')} />

      <Text><Strong>What must be recorded?</Strong></Text>
      {form.requirements.map((r, i) => (
        <Box key={`req-${i}`} padding="space.100" backgroundColor="color.background.neutral">
          <Stack space="space.050">
            <Inline space="space.100" alignBlock="end" shouldWrap>
              <Stack space="space.050"><Label labelFor={`q-l-${i}`}>Question or evidence</Label><Textfield id={`q-l-${i}`} value={r.label} onChange={(e) => setReq(i, { label: e.target.value })} /></Stack>
              <Stack space="space.050"><Label labelFor={`q-t-${i}`}>Type</Label>
                <Select inputId={`q-t-${i}`} options={TYPE_OPTIONS} value={TYPE_OPTIONS.find((o) => o.value === r.type)} onChange={(o) => setReq(i, { type: o.value })} /></Stack>
              {r.type !== 'approval' && (
                <Stack space="space.050"><Label labelFor={`q-s-${i}`}>When</Label>
                  <Select inputId={`q-s-${i}`} options={STAGE_OPTIONS} value={STAGE_OPTIONS.find((o) => o.value === (r.stage || 'build'))} onChange={(o) => setReq(i, { stage: o.value })} /></Stack>
              )}
              <Stack space="space.050"><Label labelFor={`q-c-${i}`}>Clause</Label><Textfield id={`q-c-${i}`} width={100} value={r.clause || ''} onChange={(e) => setReq(i, { clause: e.target.value })} /></Stack>
              <Button appearance="subtle" onClick={() => setForm({ ...form, requirements: form.requirements.filter((_, j) => j !== i) })}>Remove</Button>
            </Inline>
            {r.type === 'choice' && (
              <><Label labelFor={`q-o-${i}`}>Options (separate with |)</Label><Textfield id={`q-o-${i}`} value={r.options || ''} onChange={(e) => setReq(i, { options: e.target.value })} /></>
            )}
          </Stack>
        </Box>
      ))}
      <Inline><Button appearance="subtle" onClick={() => setForm({ ...form, requirements: [...form.requirements, { id: '', label: '', type: 'answer', stage: 'build' }] })}>Add requirement</Button></Inline>

      <Text><Strong>Examples</Strong> (checked every time you save, so edits can't silently break matching)</Text>
      <Inline space="space.200" shouldWrap>
        <Stack space="space.050"><Label labelFor="r-em">Should match (one per line)</Label><TextArea id="r-em" value={form.examplesMatch} onChange={set('examplesMatch')} /></Stack>
        <Stack space="space.050"><Label labelFor="r-ei">Should NOT match</Label><TextArea id="r-ei" value={form.examplesIgnore} onChange={set('examplesIgnore')} /></Stack>
      </Inline>

      <ButtonGroup>
        <Button appearance="primary" isDisabled={busy} onClick={() => onSave(rule?.id || null, fromForm(form))}>Save rule</Button>
        <Button appearance="subtle" onClick={onCancel}>Cancel</Button>
        {rule && rule.status !== 'active' && <Button appearance="danger" isDisabled={busy} onClick={() => onDelete(rule.id)}>Delete draft</Button>}
      </ButtonGroup>
      {rule?.status === 'active' && <Text><Em>Editing an active rule makes existing approvals for it stale. Active rules must be deactivated before they can be deleted.</Em></Text>}
    </Stack>
  );
}

const App = () => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(null); // { rule } (rule null = new)
  const [deactivating, setDeactivating] = useState(null);
  const [reason, setReason] = useState('');
  const [sample, setSample] = useState('Add a field for the customer SA ID number and sync it to our CRM vendor in the US region.');
  const [testResult, setTestResult] = useState(null);
  const [projectKey, setProjectKey] = useState('');
  const [packKey, setPackKey] = useState('popia');
  const [coverage, setCoverage] = useState(null);
  const [resetReason, setResetReason] = useState('');
  const [approverDraft, setApproverDraft] = useState(null);

  const call = async (name, payload = {}) => {
    setBusy(true);
    try {
      const next = await invoke(name, payload);
      if (next?.ok === false) { setError(next.error); return null; }
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

  useEffect(() => { call('getState'); }, []);

  if (!state && !error) return <Spinner label="Loading Preflight" />;
  if (!state) return <SectionMessage appearance="error" title="Preflight settings could not load"><Text>{error}</Text></SectionMessage>;

  const approverLocked = state.settings.approverAccountIds.length > 0 && !state.settings.approverAccountIds.includes(state.me);
  const unprotected = coverage?.coverage?.filter((r) => !r.protected) || [];

  // Active rules first, then grouped by pack, so the POPIA and GDPR versions of a rule never sit side by side unlabelled.
  const packOf = (rule) => (/^gdpr-/.test(rule.id) ? 'GDPR' : /^popia-/.test(rule.id) ? 'POPIA' : 'Custom');
  const ordered = [...state.rules].sort((a, b) =>
    Number(b.status === 'active') - Number(a.status === 'active') || packOf(a).localeCompare(packOf(b)));
  const rows = ordered.map((rule) => ({
    key: rule.id,
    cells: [
      { key: 't', content: <Stack space="space.025"><Inline space="space.075" alignBlock="center"><Lozenge appearance={packOf(rule) === 'Custom' ? 'new' : 'default'}>{packOf(rule)}</Lozenge><Text><Strong>{rule.title}</Strong></Text></Inline>{rule.source?.kind === 'rovo-draft' && <Lozenge appearance="discovery">drafted by Rovo</Lozenge>}</Stack> },
      { key: 'c', content: <Tag text={rule.clause} /> },
      { key: 's', content: <Stack space="space.025"><Lozenge appearance={rule.status === 'active' ? 'success' : 'default'}>{rule.status}</Lozenge>{rule.pending && <Lozenge appearance="inprogress">{`${rule.pending.kind} pending`}</Lozenge>}</Stack> },
      { key: 'e', content: rule.warnings.length ? <Lozenge appearance="removed">{`${rule.warnings.length} example(s) fail`}</Lozenge> : <Lozenge appearance="success">examples pass</Lozenge> },
      {
        key: 'a',
        content: (
          <ButtonGroup>
            {rule.status === 'active'
              ? <Button isDisabled={busy} onClick={() => { setDeactivating(rule.id); setReason(''); }}>Deactivate…</Button>
              : <Button isDisabled={busy} onClick={() => call('setRuleStatus', { id: rule.id, status: 'active' })}>Activate</Button>}
            <Button appearance="subtle" onClick={() => setEditing({ rule })}>Edit</Button>
          </ButtonGroup>
        ),
      },
    ],
  }));

  return (
    <Stack space="space.200">
      <Text>
        Preflight puts your privacy review in front of the work, before it is built, and makes Jira hold it until the
        review is done. The POPIA and GDPR packs are editable starter sets of review rules, not complete legal assessments
        and not legal advice: have your Information Officer, DPO or privacy counsel review each rule before activating it.
      </Text>
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {notice && <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage>}

      <Tabs id="preflight-admin">
        <TabList>
          <Tab>Setup</Tab>
          <Tab>Rules</Tab>
          <Tab>Test a rule</Tab>
          <Tab>Settings</Tab>
          <Tab>Audit log</Tab>
        </TabList>

        <TabPanel>
          <Stack space="space.200">
            <SetupChecklist state={state} />

            <Heading size="small">1. Choose your law and load the demo</Heading>
            <Text>Activates that starter pack's rules and creates five sample work items in a company-managed space (four that touch personal information, one that does not).</Text>
            <ButtonGroup>
              {(state.packs || []).map((p) => (
                <Button key={p.key} appearance={packKey === p.key ? 'primary' : 'default'} onClick={() => setPackKey(p.key)}>
                  {`${p.name}${p.active ? ` · ${p.active} active` : ''}`}
                </Button>
              ))}
            </ButtonGroup>
            <Inline space="space.100" alignBlock="center">
              <Label labelFor="project">Space key</Label>
              <Textfield id="project" value={projectKey} placeholder="PRIV" width={120} onChange={(e) => setProjectKey(e.target.value)} />
              <Button appearance="primary" isDisabled={!projectKey.trim() || busy} onClick={() => call('loadDemo', { projectKey, pack: packKey })}>Load demo</Button>
            </Inline>

            <Heading size="small">2. Attach the two gates</Heading>
            <List type="ordered">
              <ListItem><Text>Open the space's workflow (company-managed: Space settings → Workflows, or Jira settings → Work items → Workflows; team-managed: Space settings → Work types → Edit workflow).</Text></ListItem>
              <ListItem><Text>On the transition into <Strong>In Progress</Strong>, add the rule <Strong>Preflight: privacy review before build</Strong>.</Text></ListItem>
              <ListItem><Text>On the transition into <Strong>Done</Strong>, add <Strong>Preflight: privacy evidence before Done</Strong>. Publish.</Text></ListItem>
            </List>

            <Heading size="small">3. Check coverage</Heading>
            <Text>Lists every transition into an In Progress or Done status and whether the matching gate is attached.</Text>
            <Inline><Button isDisabled={busy} onClick={async () => setCoverage(await call('checkCoverage'))}>Check workflow coverage</Button></Inline>
            {coverage?.coverageError && <SectionMessage appearance="warning"><Text>{coverage.coverageError}</Text></SectionMessage>}
            {coverage?.noGates && (
              <SectionMessage appearance="warning" title="No Preflight gate is attached to any workflow yet">
                <Text>{`Preflight checked ${coverage.otherWorkflows.length} workflow(s) and found neither gate. Add "Preflight: privacy review before build" to the transition into In Progress and "Preflight: privacy evidence before Done" to the transition into Done, click Update workflow, then check again.`}</Text>
              </SectionMessage>
            )}
            {coverage?.coverage && (
              <Stack space="space.100">
                {unprotected.length
                  ? <SectionMessage appearance="warning" title={`${unprotected.length} transition(s) in your gated workflow(s) are not protected`}><Text>Work can reach these In Progress or Done statuses without a Preflight check. Add the matching gate, or accept the gap knowingly.</Text></SectionMessage>
                  : <SectionMessage appearance="success" title={`All ${coverage.coverage.length} In Progress and Done transitions in ${coverage.workflows} workflow(s) have their gate`} />}
                {coverage.otherWorkflows?.length > 0 && (
                  <SectionMessage appearance="information" title={`${coverage.otherWorkflows.length} other workflow(s) have no Preflight gate`}>
                    <Text>{`${coverage.otherWorkflows.slice(0, 5).join(', ')}${coverage.otherWorkflows.length > 5 ? ` and ${coverage.otherWorkflows.length - 5} more` : ''}. That is fine if no space you want reviewed uses them; otherwise attach the gates there too.`}</Text>
                  </SectionMessage>
                )}
                <DynamicTable
                  head={{ cells: ['Workflow', 'Transition', 'Gate', 'Status'].map((c, i) => ({ key: `h${i}`, content: c })) }}
                  rows={coverage.coverage.map((r, i) => ({
                    key: `cov-${i}`,
                    cells: [
                      { key: 'w', content: r.workflow },
                      { key: 't', content: r.transition },
                      { key: 'g', content: r.stage === 'done' ? 'Evidence before Done' : 'Review before build' },
                      { key: 's', content: <Lozenge appearance={r.protected ? 'success' : 'removed'}>{r.protected ? 'protected' : 'unprotected'}</Lozenge> },
                    ],
                  }))}
                  rowsPerPage={20}
                />
              </Stack>
            )}
            <Text><Strong>Gate activity</Strong></Text>
            {Object.keys(state.gates || {}).length === 0
              ? <Text><Em>No gate has run yet. Attach them, then try moving a work item.</Em></Text>
              : Object.entries(state.gates).map(([key, g]) => (
                <Text key={key}>{key}: {Object.entries(g.stages || {}).map(([s, t]) => `${s === 'done' ? 'Done gate' : 'Build gate'} ran ${when(t)}`).join(' · ')}</Text>
              ))}
            <Text>Approvers see everything waiting on them under <Strong>Apps → Preflight reviews</Strong>. JQL: <Code>preflightStatus = blocked</Code>.</Text>
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.150">
            {state.pending.length > 0 && (
              <SectionMessage appearance="information" title={`${state.pending.length} change(s) waiting for an approver`}>
                {state.pending.map((p) => (
                  <Inline key={p.ruleId} space="space.100" alignBlock="center" shouldWrap>
                    <Text>{p.title}: {p.kind}{p.diff ? ` (${p.diff.summary})` : ''}, proposed {when(p.at)}</Text>
                    {(p.diff?.weakening || []).map((w) => <Text key={w}><Em>{`Weakens: ${w}`}</Em></Text>)}
                    {p.by === state.me && <Button appearance="subtle" isDisabled={busy} onClick={() => call('withdrawProposal', { id: p.ruleId })}>Withdraw</Button>}
                  </Inline>
                ))}
                <Text><Em>Approvers decide these under Apps → Preflight reviews. The current version keeps enforcing until then.</Em></Text>
              </SectionMessage>
            )}
            {deactivating && (
              <SectionMessage appearance="warning" title="Deactivate rule">
                <Label labelFor="deact">Reason (kept in the audit log)</Label>
                <Textfield id="deact" value={reason} onChange={(e) => setReason(e.target.value)} />
                <ButtonGroup>
                  <Button appearance="warning" isDisabled={reason.trim().length < 10 || busy}
                    onClick={async () => { if (await call('setRuleStatus', { id: deactivating, status: 'draft', reason })) setDeactivating(null); }}>Deactivate</Button>
                  <Button appearance="subtle" onClick={() => setDeactivating(null)}>Cancel</Button>
                </ButtonGroup>
              </SectionMessage>
            )}
            {editing ? (
              <RuleEditor
                key={editing.rule?.id || 'new'}
                rule={editing.rule}
                busy={busy}
                onCancel={() => setEditing(null)}
                onDelete={async (id) => { if (await call('deleteRule', { id })) setEditing(null); }}
                onSave={async (originalId, rule) => { if (await call('saveRule', { originalId, rule })) setEditing(null); }}
              />
            ) : (
              <>
                <DynamicTable
                  head={{ cells: ['Rule', 'Clause', 'Status', 'Examples', ''].map((c, i) => ({ key: `h${i}`, content: c })) }}
                  rows={rows}
                  emptyView="No rules yet. Use Setup → Load demo, or restore a starter pack below."
                />
                <ButtonGroup>
                  <Button onClick={() => setEditing({ rule: null })}>New rule</Button>
                  {(state.packs || []).map((p) => (
                    <Button key={p.key} appearance="subtle" isDisabled={busy} onClick={() => call('resetPack', { pack: p.key })}>{`Restore ${p.name} pack as drafts`}</Button>
                  ))}
                </ButtonGroup>
                <Text><Em>Tip: ask the Preflight agent in Rovo to "draft Preflight rules from our privacy policy page". Drafts appear here and are never enforced until you activate them.</Em></Text>
              </>
            )}
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.100">
            <Label labelFor="sample">Paste a ticket summary and description</Label>
            <TextArea id="sample" value={sample} onChange={(e) => setSample(e.target.value)} />
            <Inline><Button appearance="primary" isDisabled={busy} onClick={async () => setTestResult(await call('testText', { text: sample }))}>Test against all rules</Button></Inline>
            {testResult && testResult.matches.length === 0 && <Text>No rules match this text.</Text>}
            {testResult?.matches.map((m) => (
              <Stack key={m.ruleId} space="space.050">
                <Inline space="space.100" alignBlock="center" shouldWrap>
                  <Text><Strong>{m.title}</Strong></Text><Tag text={m.clause} />
                  <Lozenge appearance={m.enforced ? 'success' : 'default'}>{m.enforced ? 'active: would hold the work' : 'draft: would not'}</Lozenge>
                </Inline>
                <TagGroup>{m.keywords.map((k) => <Tag key={k} text={k} />)}</TagGroup>
                {m.snippet && <Text><Em>{m.snippet}</Em></Text>}
                <Text>Requires: {m.requirements.join('; ')}</Text>
              </Stack>
            ))}
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.200">
            <Stack space="space.050">
              <Label labelFor="approvers">Approvers (your Information Officer and deputies)</Label>
              <Text>
                Once you name approvers, only they can approve, and only they can change this list. With none named,
                Preflight runs in small-team mode and Jira admins approve.
              </Text>
              {approverLocked ? (
                <Inline space="space.100" shouldWrap>{state.settings.approverAccountIds.map((id) => <User key={id} accountId={id} />)}</Inline>
              ) : (
                <Stack space="space.100">
                  <UserPicker name="approvers" label="Approvers" isMulti defaultValue={state.settings.approverAccountIds}
                    onChange={(users) => setApproverDraft((Array.isArray(users) ? users : users ? [users] : []).map((u) => u.id).filter(Boolean))} />
                  <Inline><Button appearance="primary" isDisabled={!approverDraft || busy} onClick={() => call('saveSettings', { approverAccountIds: approverDraft })}>Save approvers</Button></Inline>
                  <Text><Em>Tip: name your Information Officer, not yourself. Once saved, only an approver can change this list.</Em></Text>
                </Stack>
              )}
              {approverLocked && (
                <Stack space="space.050">
                  <Text><Em>Only a current approver can change this list, or the settings that weaken a control (they can do it under Apps → Preflight reviews).</Em></Text>
                  {state.settings.pendingReset ? (
                    <SectionMessage appearance="warning" title="Reset pending">
                      <Text>Reason: {state.settings.pendingReset.reason}. Takes effect {when(state.settings.pendingReset.effectiveAt)} if a second Jira admin has confirmed it, unless an approver cancels it.</Text>
                      {state.settings.pendingReset.confirmedBy ? (
                        <Text><Em>Confirmed by a second admin.</Em></Text>
                      ) : state.settings.pendingReset.by !== state.me ? (
                        <Inline><Button appearance="warning" isDisabled={busy} onClick={() => call('confirmReset')}>Confirm as second admin</Button></Inline>
                      ) : (
                        <Text><Em>Waiting for another Jira admin to confirm.</Em></Text>
                      )}
                    </SectionMessage>
                  ) : (
                    <Stack space="space.050">
                      <Text>If your approver has left, request a break-glass reset. A second Jira admin must confirm it, it takes effect 72 hours after your request, any approver can cancel it, and for 30 days afterwards you cannot approve work, weaken a control or name the new approvers.</Text>
                      <Inline space="space.100" alignBlock="center">
                        <Textfield id="reset-reason" value={resetReason} placeholder="Reason" onChange={(e) => setResetReason(e.target.value)} />
                        <Button appearance="warning" isDisabled={resetReason.trim().length < 10 || busy} onClick={() => call('requestReset', { reason: resetReason })}>Request reset</Button>
                      </Inline>
                    </Stack>
                  )}
                </Stack>
              )}
            </Stack>
            {[
              ['requireDeclaration', 'Ask for a Yes / No / Unsure declaration before work starts on items no rule matched'],
              ['separationOfDuties', 'Separation of duties: reporters, assignees and answer authors cannot approve'],
              ['failClosed', 'Fail closed (recommended): if Preflight cannot evaluate, hold the transition with a clear message'],
            ].map(([key, text]) => (
              <Inline key={key} space="space.100" alignBlock="center">
                <Toggle id={key} isChecked={Boolean(state.settings[key])} isDisabled={busy} onChange={() => call('saveSettings', { [key]: !state.settings[key] })} />
                <Label labelFor={key}>{text}</Label>
              </Inline>
            ))}
          </Stack>
        </TabPanel>

        <TabPanel>
          <Stack space="space.100">
            <Text>Rule, setting and demo changes. Events are write-once: nobody can edit or delete them. The one exception is Atlassian’s privacy rule: when an account is closed, its ID is replaced with “closed-account”.</Text>
            <DynamicTable
              head={{ cells: ['When', 'Who', 'What'].map((c, i) => ({ key: `h${i}`, content: c })) }}
              rows={state.audit.map((e, i) => ({
                key: `a-${i}`,
                cells: [
                  { key: 'w', content: when(e.at) },
                  { key: 'b', content: e.by && e.by !== 'app' ? <User accountId={e.by} /> : <Text>Preflight</Text> },
                  { key: 'e', content: <Inline space="space.050" shouldWrap>{e.via === 'agent' && <Lozenge appearance="discovery">via Rovo</Lozenge>}<Text>{e.event}</Text></Inline> },
                ],
              }))}
              rowsPerPage={20}
              emptyView="No admin events yet."
            />
          </Stack>
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

/** Where setup stands, so an admin (or a judge) sees the next step at a glance. */
function SetupChecklist({ state }) {
  const active = (state.rules || []).filter((r) => r.status === 'active').length;
  const approvers = state.settings?.approverAccountIds?.length || 0;
  const spaces = Object.values(state.gates || {});
  const built = spaces.some((g) => g.stages?.build);
  const done = spaces.some((g) => g.stages?.done);
  const steps = [
    [active > 0, active ? `${active} rules active` : 'No rules active yet: load the demo (step 1) or activate rules'],
    [approvers > 0, approvers ? `${approvers} approver(s) named` : 'No approver named: any Jira admin can approve until you name one (Settings tab)'],
    [built, built ? 'Build gate has run' : 'Build gate has not run yet: attach it (step 2), then move a work item to In Progress'],
    [done, done ? 'Done gate has run' : 'Done gate has not run yet: attach it (step 2), then move a work item to Done'],
  ];
  const left = steps.filter(([ok]) => !ok).length;
  return (
    <SectionMessage appearance={left ? 'information' : 'success'} title={left ? `Setup: ${4 - left} of 4 done` : 'Setup complete'}>
      <Stack space="space.050">
        {steps.map(([ok, text]) => <Text key={text}>{`${ok ? '✓' : '○'}  ${text}`}</Text>)}
      </Stack>
    </SectionMessage>
  );
}

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
