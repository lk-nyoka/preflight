/**
 * "Preflight reviews": the approver's inbox (Jira global page, UI Kit).
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, DynamicTable, EmptyState, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Tag, TagGroup, Text, User, Em,
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
  const decide = async (ruleId, decision) => {
    setBusy(true);
    const out = await invoke('decideRuleChange', { ruleId, decision }).catch((e) => ({ ok: false, error: e.message }));
    setBusy(false);
    if (out.ok === false) setError(out.error);
    else load();
  };
  const load = () => invoke('getInbox').then((d) => (d.ok === false ? setError(d.error) : setData(d))).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error) return <SectionMessage appearance="error" title="Could not load reviews"><Text>{error}</Text></SectionMessage>;
  if (!data) return <Spinner label="Loading reviews" />;

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
                { key: 'c', content: <Text>{c.kind}{c.change ? `: ${c.change}` : ''}</Text> },
                { key: 'b', content: <Stack space="space.025"><User accountId={c.by} /><Text>{when(c.at)}</Text></Stack> },
                { key: 'a', content: <Inline space="space.050"><Button appearance="primary" isDisabled={busy} onClick={() => decide(c.ruleId, 'apply')}>Apply</Button><Button isDisabled={busy} onClick={() => decide(c.ruleId, 'reject')}>Reject</Button></Inline> },
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
      <Text><Em>Only work items you can see in Jira are listed. Preflight records your organisation's review; it is not legal advice.</Em></Text>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
