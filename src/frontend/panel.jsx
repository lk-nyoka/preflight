/**
 * Preflight issue panel (UI Kit).
 *
 * Built around one question a developer has when Preflight blocks them:
 * "what do I do next, and who approves?" The top box always answers it.
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, ButtonGroup, Em, Heading, Inline, Label, Lozenge, SectionMessage, Select, Spinner, Stack, Strong, Tag,
  Text, TextArea, Textfield, User,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STAGE_LOZENGE = {
  'not-applicable': { appearance: 'default', text: 'No rule matched' },
  blocked: { appearance: 'removed', text: 'Blocked' },
  clear: { appearance: 'success', text: 'Clear' },
  exception: { appearance: 'moved', text: 'Exception' },
};

function Approvers({ state }) {
  if (state.approverMode === 'small-team' || !state.approvers.length) {
    return <Text>any Jira admin <Em>(small-team mode: no named approvers yet)</Em></Text>;
  }
  return (
    <Inline space="space.100" alignBlock="center" shouldWrap>
      {state.approvers.map((id) => <User key={id} accountId={id} />)}
    </Inline>
  );
}

/** The single most important element: what happens next. */
function NextStep({ state, act, busy }) {
  const { result } = state;
  const build = result.stages.build;
  const done = result.stages.done;
  if (build.needsDeclaration) {
    return (
      <SectionMessage appearance="warning" title="Before work starts: does this change affect personal information?">
        <Text>Your team asks for a quick declaration on every work item. Pick one; Unsure is fine and starts a light review.</Text>
        <ButtonGroup>
          <Button isDisabled={busy} onClick={() => act('declare', { value: 'yes' })}>Yes</Button>
          <Button isDisabled={busy} onClick={() => act('declare', { value: 'unsure' })}>Unsure</Button>
          <Button isDisabled={busy} onClick={() => act('declare', { value: 'no' })}>No</Button>
        </ButtonGroup>
      </SectionMessage>
    );
  }
  if (result.status === 'exception') {
    return <SectionMessage appearance="discovery" title="An approver recorded a time-limited exception"><Text>Work can proceed. See the exception below.</Text></SectionMessage>;
  }
  if (build.status === 'blocked') {
    if (build.declarationRuleMissing) {
      return <SectionMessage appearance="warning" title="A rule is missing"><Text>{build.summary}</Text></SectionMessage>;
    }
    const inputs = build.open.filter((o) => o.type !== 'approval');
    const needsApproval = build.open.some((o) => o.type === 'approval');
    if (inputs.length) {
      return (
        <SectionMessage appearance="warning" title={`Next: answer ${plural(inputs.length, 'question')} before work starts`}>
          <Text>Fill them in below and click Save.{needsApproval ? ' Then this is approved by:' : ' No approval is needed for these rules.'}</Text>
          {needsApproval && <Approvers state={state} />}
        </SectionMessage>
      );
    }
    return (
      <SectionMessage appearance="information" title="Next: waiting for approval">
        <Text>Your answers are complete. Approval from:</Text>
        <Approvers state={state} />
        <Inline><Button isDisabled={busy} onClick={() => act('requestApproval', {})}>Request approval</Button></Inline>
      </SectionMessage>
    );
  }
  if (done.status === 'blocked') {
    const items = done.open.map((o) => o.label);
    const approved = result.applicable.some((m) => m.requirements.some((r) => r.type === 'approval' && r.satisfied));
    const title = build.status === 'exception'
      ? 'Work can start under an approver\'s exception'
      : approved ? 'Approved: work can start' : 'Review complete: work can start';
    return (
      <SectionMessage appearance="information" title={title}>
        <Text>Before moving to Done, add: {items.join('; ')}.</Text>
      </SectionMessage>
    );
  }
  if (result.status === 'clear') {
    return <SectionMessage appearance="success" title="Privacy review complete"><Text>All review steps for this work item are recorded. This is your organisation's review, not a legal compliance decision.</Text></SectionMessage>;
  }
  return null;
}

/** One readable sentence for why a rule applies. */
export function whyText(why) {
  const parts = [];
  if (why.keywords.length) parts.push(`mentions "${why.keywords.join('", "')}"`);
  if (why.labels.length) parts.push(`has the label ${why.labels.join(', ')}`);
  if (why.declared) parts.push('someone declared this work affects personal information');
  else if (why.manual) parts.push('flagged by a teammate');
  if (why.sticky) parts.push(`matched earlier ("${(why.firstMatched?.phrases || []).join('", "')}"), and it stays until an approver dismisses it`);
  let text = parts.join('; ') || 'matched earlier';
  if (why.reopened?.length) text += `. Re-opened: it was dismissed earlier, but now also mentions "${why.reopened.join('", "')}"`;
  return text;
}

function RequirementInput({ requirement, value, onChange }) {
  if (requirement.type === 'choice') {
    const options = (requirement.options || []).map((o) => ({ label: o, value: o }));
    return (
      <Select inputId={requirement.id} options={options} value={options.find((o) => o.value === value) || null}
        onChange={(option) => onChange(option ? option.value : '')} placeholder="Choose one" />
    );
  }
  if (requirement.type === 'link') {
    return <Textfield id={requirement.id} value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />;
  }
  return <TextArea id={requirement.id} value={value} placeholder={requirement.help || ''} minimumRows={2} onChange={(e) => onChange(e.target.value)} />;
}

function RuleCard({ match, state, act, busy }) {
  const savedAnswers = state.answers[match.ruleId] || {};
  const drafts = state.drafts[match.ruleId] || {};
  const inputs = match.requirements.filter((r) => r.type !== 'approval');
  const approvalReq = match.requirements.find((r) => r.type === 'approval');
  const [draft, setDraft] = useState(() => Object.fromEntries(inputs.map((r) => [r.id, savedAnswers[r.id]?.value || ''])));
  const [showDismiss, setShowDismiss] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const dirty = inputs.some((r) => (draft[r.id] || '') !== (savedAnswers[r.id]?.value || ''));
  const buildInputsDone = inputs.filter((r) => r.stage === 'build').every((r) => r.satisfied);
  const why = match.why;

  const section = (stage, title) => {
    const reqs = inputs.filter((r) => r.stage === stage);
    if (!reqs.length) return null;
    return (
      <Stack space="space.100">
        <Text><Strong>{title}</Strong></Text>
        {reqs.map((req) => (
          <Stack key={req.id} space="space.050">
            <Label labelFor={req.id}>{req.label}{req.clause ? ` (${req.clause})` : ''}{req.satisfied ? ' ✓' : ''}</Label>
            <RequirementInput requirement={req} value={draft[req.id] || ''} onChange={(v) => setDraft({ ...draft, [req.id]: v })} />
            {drafts[req.id] && (
              <Box padding="space.100" backgroundColor="color.background.discovery">
                <Stack space="space.050">
                  <Text><Strong>Rovo draft (not saved yet):</Strong> {drafts[req.id].value}</Text>
                  <ButtonGroup>
                    <Button appearance="discovery" onClick={() => setDraft({ ...draft, [req.id]: drafts[req.id].value })}>Use draft</Button>
                    <Button appearance="subtle" isDisabled={busy} onClick={() => act('discardDraft', { ruleId: match.ruleId, requirementId: req.id })}>Discard</Button>
                  </ButtonGroup>
                </Stack>
              </Box>
            )}
            {!req.satisfied && req.reason && req.reason !== 'Not answered yet' && <Text><Em>{req.reason}</Em></Text>}
          </Stack>
        ))}
      </Stack>
    );
  };

  return (
    <Box padding="space.150" backgroundColor={match.satisfied ? 'color.background.success' : 'color.background.neutral'}>
      <Stack space="space.150">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Heading size="small">{match.title}</Heading>
          <Tag text={match.clause} />
          <Lozenge appearance={match.satisfied ? 'success' : match.buildSatisfied ? 'inprogress' : 'removed'}>
            {match.satisfied ? 'Done' : match.buildSatisfied ? 'Approved, evidence due' : 'Review needed'}
          </Lozenge>
        </Inline>
        <Text>{match.summary}</Text>
        <Text><Strong>Why: </Strong>{whyText(why)}</Text>
        {why.snippet && <Text><Em>{why.snippet}</Em></Text>}

        {section('build', 'Before work starts')}
        {approvalReq && (
          <Stack space="space.050">
            <Text><Strong>{approvalReq.label}</Strong></Text>
            {approvalReq.satisfied ? (
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Text>Approved by</Text><User accountId={approvalReq.by} /><Text>{when(approvalReq.at)}</Text>
                {state.canApprove && <Button appearance="subtle" isDisabled={busy} onClick={() => act('revokeApproval', { ruleId: match.ruleId })}>Revoke</Button>}
              </Inline>
            ) : (
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Text><Em>{approvalReq.reason}</Em></Text>
                {state.canApprove && !state.separation?.[match.ruleId] && (
                  <Button appearance="primary" isDisabled={!buildInputsDone || dirty || busy} onClick={() => act('approve', { ruleId: match.ruleId })}>Approve</Button>
                )}
              </Inline>
            )}
            {state.canApprove && !buildInputsDone && <Text><Em>Approve unlocks once the answers above are saved.</Em></Text>}
            {state.canApprove && state.separation?.[match.ruleId] && <Text><Em>Separation of duties: {state.separation[match.ruleId]}, so another approver must approve.</Em></Text>}
          </Stack>
        )}
        {section('done', 'Before Done')}

        {inputs.length > 0 && (
          <Inline>
            <Button appearance="primary" isDisabled={!dirty || busy} onClick={() => act('saveAnswers', { ruleId: match.ruleId, answers: draft })}>Save answers</Button>
          </Inline>
        )}

        {state.canApprove && (!showDismiss ? (
          <Inline><Button appearance="subtle" onClick={() => setShowDismiss(true)}>This rule does not apply…</Button></Inline>
        ) : (
          <Stack space="space.050">
            <Label labelFor={`dismiss-${match.ruleId}`}>Why it does not apply (kept in the audit history; do not include anyone's personal details)</Label>
            <Textfield id={`dismiss-${match.ruleId}`} value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} />
            <ButtonGroup>
              <Button isDisabled={dismissReason.trim().length < 10 || busy} onClick={() => act('dismissRule', { ruleId: match.ruleId, reason: dismissReason })}>Dismiss rule</Button>
              <Button appearance="subtle" onClick={() => setShowDismiss(false)}>Cancel</Button>
            </ButtonGroup>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

const App = () => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [flagChoice, setFlagChoice] = useState(null);
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionDays, setExceptionDays] = useState('30');
  const [showAllAudit, setShowAllAudit] = useState(false);
  const [version, setVersion] = useState(0);

  const apply = (next) => {
    if (next?.ok === false) setError(next.error);
    else {
      setState(next);
      setError(null);
      setNotice(next?.notice || null);
      setVersion((v) => v + 1);
    }
  };
  const act = async (name, payload = {}) => {
    setBusy(true);
    try {
      apply(await invoke(name, payload));
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    invoke('getState').then(apply).catch((e) => setError(e.message || String(e)));
  }, []);

  if (!state && !error) return <Spinner label="Running Preflight" />;
  if (!state) return <SectionMessage appearance="error" title="Preflight could not load"><Text>{error}</Text></SectionMessage>;

  const { result } = state;
  const build = STAGE_LOZENGE[result.stages.build.status];
  const done = STAGE_LOZENGE[result.stages.done.status];
  const audit = showAllAudit ? state.audit : state.audit.slice(0, 5);

  return (
    <Stack space="space.200">
      <Inline space="space.150" alignBlock="center" shouldWrap>
        <Inline space="space.050" alignBlock="center"><Text>Start work</Text><Lozenge appearance={build.appearance} isBold>{build.text}</Lozenge></Inline>
        <Inline space="space.050" alignBlock="center"><Text>Close</Text><Lozenge appearance={done.appearance} isBold>{done.text}</Lozenge></Inline>
        <Button appearance="subtle" isDisabled={busy} onClick={() => act('getState')}>Re-check</Button>
      </Inline>

      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {notice && <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage>}

      <NextStep state={state} act={act} busy={busy} />

      {state.bypass && !state.bypass.resolvedAt && (
        <SectionMessage appearance="error" title={`This work item is in "${state.bypass.status}" with its privacy review still open`}>
          <Text>It got past a Preflight gate without the review being complete (moved from another space, changed work type, a workflow without the gate, or the review went stale afterwards). The approvers have been told. Finish the steps below.</Text>
        </SectionMessage>
      )}

      {state.pendingReset && state.canApprove && state.approverMode === 'named-approvers' && (
        <SectionMessage appearance="warning" title="A Jira admin asked to remove the named approvers">
          <Text>Reason: {state.pendingReset.reason}. {state.pendingReset.confirmedBy ? 'A second admin confirmed it.' : 'It still needs a second admin to confirm.'} It takes effect {when(state.pendingReset.effectiveAt)} unless an approver cancels it in Apps → Preflight reviews.</Text>
        </SectionMessage>
      )}

      {state.declaration && state.declaration.value !== 'no' && (
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Text>Declared "{state.declaration.value === 'yes' ? 'Yes' : 'Unsure'}" by</Text><User accountId={state.declaration.by} />
          <Text><Em>Only an approver can lower another person's declaration.</Em></Text>
        </Inline>
      )}

      {state.hasActiveRules && !state.gate && (
        <SectionMessage appearance="information" title="No Preflight gate has run in this space yet">
          <Text>The gates report here the first time someone moves a work item. If moving work is not being held, a Jira admin needs to attach them: Jira settings → Apps → Preflight → Setup.</Text>
        </SectionMessage>
      )}

      {!state.hasActiveRules && (
        <SectionMessage appearance="information" title="No Preflight rules are active yet">
          <Text>A Jira admin can review and activate the POPIA starter rules under Jira settings → Apps → Preflight.</Text>
        </SectionMessage>
      )}

      {result.applicable.map((match) => <RuleCard key={`${match.ruleId}-${version}`} match={match} state={state} act={act} busy={busy} />)}

      {result.status === 'not-applicable' && state.hasActiveRules && !result.stages.build.needsDeclaration && (
        <Stack space="space.050">
          <Text>
            No configured rule matched. That does not prove the work has no privacy impact. Does it change how personal
            information is collected, used, stored or shared?
          </Text>
          <ButtonGroup>
            <Button isSelected={state.declaration?.value === 'yes'} isDisabled={busy} onClick={() => act('declare', { value: 'yes' })}>Yes</Button>
            <Button isSelected={state.declaration?.value === 'unsure'} isDisabled={busy} onClick={() => act('declare', { value: 'unsure' })}>Unsure</Button>
            <Button isSelected={state.declaration?.value === 'no'} isDisabled={busy} onClick={() => act('declare', { value: 'no' })}>No</Button>
          </ButtonGroup>
        </Stack>
      )}

      {result.dismissed.length > 0 && (
        <Stack space="space.050">
          <Text><Strong>Dismissed rules</Strong></Text>
          {result.dismissed.map((d) => (
            <Inline key={d.ruleId} space="space.100" alignBlock="center" shouldWrap>
              <Text>{d.title}: {d.dismissal.reason}</Text><User accountId={d.dismissal.by} />
              {state.canApprove && <Button appearance="subtle" isDisabled={busy} onClick={() => act('restoreRule', { ruleId: d.ruleId })}>Restore</Button>}
            </Inline>
          ))}
        </Stack>
      )}

      {state.exception && (
        <SectionMessage appearance="discovery" title={result.exceptionExpired ? 'Exception expired' : 'Exception'}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <User accountId={state.exception.by} />
            <Text>{state.exception.reason}. Granted {when(state.exception.at)}, expires {when(state.exception.expiresAt)}.</Text>
          </Inline>
          <Text><Em>Covers only the rules that were open when it was granted, and only the wording they matched then. New rules or new wording are not waived.</Em></Text>
          {state.canApprove && <Inline><Button appearance="subtle" isDisabled={busy} onClick={() => act('clearException')}>Withdraw exception</Button></Inline>}
        </SectionMessage>
      )}

      {state.flaggableRules.length > 0 && (
        <Stack space="space.050">
          <Label labelFor="flag-rule">Preflight missed something? Add a rule to this work item</Label>
          <Inline space="space.100" alignBlock="center">
            <Select inputId="flag-rule" options={state.flaggableRules.map((r) => ({ label: `${r.title} (${r.clause})`, value: r.id }))} value={flagChoice} onChange={setFlagChoice} />
            <Button isDisabled={!flagChoice || busy} onClick={() => { act('flagRule', { ruleId: flagChoice.value }); setFlagChoice(null); }}>Add</Button>
          </Inline>
        </Stack>
      )}

      {state.canApprove && result.status === 'blocked' && (
        <Stack space="space.050">
          <Label labelFor="exception">Approver only: the rules apply, but accept a time-limited deviation (the reason is kept in the audit history; do not include anyone's personal details)</Label>
          <Textfield id="exception" value={exceptionReason} placeholder="Reason (at least 10 characters)" onChange={(e) => setExceptionReason(e.target.value)} />
          <Inline space="space.100" alignBlock="center">
            <Label labelFor="exception-days">Days (max 90)</Label>
            <Textfield id="exception-days" type="number" width={80} value={exceptionDays} onChange={(e) => setExceptionDays(e.target.value)} />
            <Button isDisabled={exceptionReason.trim().length < 10 || busy} onClick={() => act('setException', { reason: exceptionReason, days: Number(exceptionDays) })}>Grant exception</Button>
          </Inline>
        </Stack>
      )}

      {state.audit.length > 0 && (
        <Stack space="space.050">
          <Text><Strong>Audit history</Strong> <Em>(write-once)</Em></Text>
          {audit.map((entry) => (
            <Inline key={`${entry.at}-${entry.event}`} space="space.100" alignBlock="center" shouldWrap>
              <Text>{when(entry.at)}</Text>
              {entry.by && !['app', 'unknown-user'].includes(entry.by) ? <User accountId={entry.by} /> : <Text>Preflight</Text>}
              {entry.via === 'agent' && <Lozenge appearance="discovery">via Rovo</Lozenge>}
              <Text>{entry.event}</Text>
            </Inline>
          ))}
          {state.audit.length > 5 && <Inline><Button appearance="subtle" onClick={() => setShowAllAudit(!showAllAudit)}>{showAllAudit ? 'Show less' : `Show all ${state.audit.length}`}</Button></Inline>}
        </Stack>
      )}

      <Text><Em>Starter review rules, not legal advice. Your Information Officer decides which rules are active, and only an approver can sign off. AI can draft answers; it cannot approve.</Em></Text>
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
