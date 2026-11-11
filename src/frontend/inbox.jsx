/**
 * "Preflight reviews": the approver's inbox (Jira global page, UI Kit).
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, DynamicTable, EmptyState, Heading, Inline, Label, Link, Lozenge, SectionMessage, Spinner, Stack, Tag, TagGroup, Text, Toggle, User, UserPicker, Em, Strong,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');

function table(items, emptyText) {
  if (!items.length) return <Text><Em>{emptyText}</Em></Text>;
  return (
    <DynamicTable
      head={{ cells: ['Work item', 'Rules', 'Open', 'Updated'].map((c, i) => ({ key: `h${i}`, content: c })) }}
      rows={items.map((i) => ({
        key: i.key,
        cells: [
          { key: 'k', content: <Stack space="space.025"><Link href={`/browse/${i.key}`}>{i.key}</Link><Text>{i.summary}</Text></Stack> },
          { key: 'r', content: <TagGroup>{i.rules.map((r) => <Tag key={r} text={r} />)}</TagGroup> },
          { key: 'o', content: <Stack space="space.025">
            <Lozenge appearance={i.buildStatus === 'blocked' ? 'removed' : 'inprogress'}>{i.buildStatus === 'blocked' ? `${i.openBuild} before build` : `${i.openTotal} before Done`}</Lozenge>
            {i.exception?.expiresAt && <Text>{`Exception expires ${when(i.exception.expiresAt)}`}</Text>}
            {i.bypassed && <Text>{`In "${i.bypassed.status}" since ${when(i.bypassed.at)}`}</Text>}
          </Stack> },
          { key: 'u', content: when(i.updatedAt) },
        ],
      }))}
      rowsPerPage={25}
    />
  );
}

const App = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [approverDraft, setApproverDraft] = useState(null);
  const run = async (name, payload) => {
    setBusy(true);
    const out = await invoke(name, payload).catch((e) => ({ ok: false, error: e.message }));
    setBusy(false);
    if (out.ok === false) setError(out.error);
    else { setError(null); load(); }
  };
  const decide = (c, decision) => run('decideRuleChange', { ruleId: c.ruleId, proposalId: c.proposalId, decision });
  const load = () => invoke('getInbox').then((d) => (d.ok === false ? setError(d.error) : setData(d))).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error && !data) return <SectionMessage appearance="error" title="Could not load reviews"><Text>{error}</Text></SectionMessage>;
  if (!data) return <Spinner label="Loading reviews" />;
  // Weakening changes first, in capitals, so they cannot be missed.
  const diffLines = (d) => !d?.changes ? [] : [
    ...d.weakening.map((w) => `WEAKENS: ${w}`),
    ...d.changes.filter((c) => !d.weakening.includes(c)),
    ...(d.newlyCaught?.length ? [`now also matches: ${d.newlyCaught.map((x) => `"${x}"`).join(', ')}`] : []),
  ];
  const ruleLines = (r) => !r ? [] : [
    `Triggers: ${(r.triggers?.keywords || []).join(', ') || '(none)'}`,
    ...((r.triggers?.contextual || []).map((g) => `Context: ${g.terms.join(', ')} with ${g.with.join(', ')}`)),
    ...(r.triggers?.exclude?.length ? [`Ignores: ${r.triggers.exclude.join(', ')}`] : []),
    ...(r.triggers?.labels?.length ? [`Labels: ${r.triggers.labels.join(', ')}`] : []),
    ...(r.requirements || []).map((q) => [
      `• ${q.label} (${q.type === 'approval' ? 'approval' : `${q.type}, ${q.stage || 'build'}`})`,
      q.options ? ` options: ${q.options.join(' | ')}` : '',
      q.type === 'answer' ? ` at least ${q.minWords ?? 4} words` : '',
      q.mustMention?.length ? ` must mention one of: ${q.mustMention.join(', ')}` : '',
    ].join('')),
  ];

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="large">Preflight reviews</Heading>
        <Button appearance="subtle" onClick={load}>Refresh</Button>
      </Inline>
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Text>Approvers:</Text>
        {data.approvers.length ? data.approvers.map((id) => <User key={id} accountId={id} />) : <Text><Em>any Jira admin (small-team mode)</Em></Text>}
        {data.canApprove && <Lozenge appearance="success">you can approve</Lozenge>}
      </Inline>
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {data.pendingReset && (
        <SectionMessage appearance="warning" title="A reset to small-team mode is pending">
          <Text>Requested by an admin: {data.pendingReset.reason}. {data.pendingReset.confirmedBy ? 'A second Jira admin has confirmed it.' : 'It still needs a second Jira admin to confirm.'} It takes effect {when(data.pendingReset.effectiveAt)} unless an approver cancels it.</Text>
          {data.isApprover && <Inline><Button appearance="warning" isDisabled={busy} onClick={() => run('cancelReset', {})}>Cancel the reset</Button></Inline>}
        </SectionMessage>
      )}
      {data.ruleChanges.length > 0 && (
        <Stack space="space.100">
          <Heading size="medium">{`Rule changes to decide (${data.ruleChanges.length})`}</Heading>
          <Text>A Jira admin proposed these changes to active rules. The current version keeps enforcing until you decide. You cannot decide your own proposals.</Text>
          <DynamicTable
            head={{ cells: ['Rule', 'Change', 'Proposed by', ''].map((c, n) => ({ key: `h${n}`, content: c })) }}
            rows={data.ruleChanges.map((c) => ({
              key: c.ruleId,
              cells: [
                { key: 'r', content: <Stack space="space.025"><Text>{c.title}</Text><Tag text={c.clause} /></Stack> },
                { key: 'c', content: <Stack space="space.025">
                  <Inline space="space.050"><Text><Strong>{c.kind}</Strong></Text>{c.diff?.weakens && <Lozenge appearance="removed">weakens the rule</Lozenge>}</Inline>
                  {diffLines(c.diff).map((line) => <Text key={line}>{line}</Text>)}
                  {c.reason && <Text><Em>{c.reason}</Em></Text>}
                  <Text><Strong>{c.kind === 'edit' ? 'Rule after this change:' : 'The rule:'}</Strong></Text>
                  {ruleLines(c.kind === 'edit' ? c.diff?.after : c.rule).map((line) => <Text key={line}>{line}</Text>)}
                </Stack> },
                { key: 'b', content: <Stack space="space.025"><User accountId={c.by} /><Text>{when(c.at)}</Text></Stack> },
                { key: 'a', content: <Inline space="space.050"><Button appearance="primary" isDisabled={busy} onClick={() => decide(c, 'apply')}>Apply</Button><Button isDisabled={busy} onClick={() => decide(c, 'reject')}>Reject</Button></Inline> },
              ],
            }))}
          />
        </Stack>
      )}
      {data.bypassed?.length > 0 && (
        <SectionMessage appearance="error" title={`Past a gate with the review open (${data.bypassed.length})`}>
          <Text>These work items reached In Progress or Done while their privacy review was incomplete: moved from another space, changed work type, a workflow without the Preflight gate, or the review went stale afterwards.</Text>
          {table(data.bypassed, '')}
        </SectionMessage>
      )}
      {!data.awaitingApproval.length && !data.waitingOnTeam.length ? (
        <EmptyState header={data.exceptions?.length || data.bypassed?.length ? 'Nothing else waiting' : 'Nothing waiting'} description="No work item has an open privacy review right now." />
      ) : (
        <>
          <Heading size="medium">{`Waiting for approval (${data.awaitingApproval.length})`}</Heading>
          <Text><Em>Open a work item to read the answers and approve it in its Preflight panel.</Em></Text>
          {table(data.awaitingApproval, 'No answers are waiting for sign-off.')}
          <Heading size="medium">{`Waiting on the team (${data.waitingOnTeam.length})`}</Heading>
          {table(data.waitingOnTeam, 'Nothing is waiting on the team.')}
        </>
      )}
      {data.exceptions?.length > 0 && (
        <>
          <Heading size="medium">{`Under a time-limited exception (${data.exceptions.length})`}</Heading>
          {table(data.exceptions, '')}
        </>
      )}
      {data.isApprover && (
        <Stack space="space.150">
          <Heading size="medium">Approver settings</Heading>
          <Label labelFor="ap">Approvers (only a current approver can change this list)</Label>
          <UserPicker name="ap" label="Approvers" isMulti defaultValue={data.approvers}
            onChange={(users) => setApproverDraft((Array.isArray(users) ? users : users ? [users] : []).map((u) => u.id).filter(Boolean))} />
          <Inline><Button appearance="primary" isDisabled={busy || !approverDraft} onClick={() => run('setApprovers', { approverAccountIds: approverDraft })}>Save approvers</Button></Inline>
          {[
            ['requireDeclaration', 'Ask for a Yes / No / Unsure declaration before work starts'],
            ['separationOfDuties', 'Separation of duties: reporters, assignees and answer authors cannot approve'],
            ['failClosed', 'Fail closed: hold transitions if Preflight cannot evaluate'],
          ].map(([key, text]) => (
            <Inline key={key} space="space.100" alignBlock="center">
              <Toggle id={`in-${key}`} isChecked={Boolean(data.settings[key])} isDisabled={busy} onChange={() => run('setPolicy', { [key]: !data.settings[key] })} />
              <Label labelFor={`in-${key}`}>{text}</Label>
            </Inline>
          ))}
        </Stack>
      )}
      <Text><Em>Only work items you can see in Jira are listed. Preflight records your organisation's review; it is not legal advice.</Em></Text>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
