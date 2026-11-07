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
          { key: 'o', content: <Lozenge appearance={i.buildStatus === 'blocked' ? 'removed' : 'inprogress'}>{i.buildStatus === 'blocked' ? `${i.openBuild} before build` : `${i.openTotal} before Done`}</Lozenge> },
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
  const diffText = (d) => !d ? null : [
    d.phrasesAdded?.length ? `adds phrases: ${d.phrasesAdded.join(', ')}` : null,
    d.phrasesRemoved?.length ? `REMOVES phrases: ${d.phrasesRemoved.join(', ')}` : null,
    d.requirementsAdded?.length ? `adds: ${d.requirementsAdded.join('; ')}` : null,
    d.requirementsRemoved?.length ? `REMOVES: ${d.requirementsRemoved.join('; ')}` : null,
    d.requirementsChanged?.length ? `changes: ${d.requirementsChanged.join('; ')}` : null,
    d.textChanged?.length ? `text: ${d.textChanged.join(', ')}` : null,
  ].filter(Boolean);

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
          <Text>Requested by an admin: {data.pendingReset.reason}. It takes effect {when(data.pendingReset.effectiveAt)} unless an approver cancels it.</Text>
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
                  {(diffText(c.diff) || []).map((line) => <Text key={line}>{line}</Text>)}
                  {c.reason && <Text><Em>{c.reason}</Em></Text>}
                </Stack> },
                { key: 'b', content: <Stack space="space.025"><User accountId={c.by} /><Text>{when(c.at)}</Text></Stack> },
                { key: 'a', content: <Inline space="space.050"><Button appearance="primary" isDisabled={busy} onClick={() => decide(c, 'apply')}>Apply</Button><Button isDisabled={busy} onClick={() => decide(c, 'reject')}>Reject</Button></Inline> },
              ],
            }))}
          />
        </Stack>
      )}
      {!data.awaitingApproval.length && !data.waitingOnTeam.length ? (
        <EmptyState header="Nothing waiting" description="No work item has an open privacy review." />
      ) : (
        <>
          <Heading size="medium">{`Waiting for approval (${data.awaitingApproval.length})`}</Heading>
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
