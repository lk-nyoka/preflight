/**
 * Preflight issue panel (UI Kit).
 *
 * Shows, for the work item being viewed:
 *   - whether closing it is blocked, and why (matched phrases, cited clause)
 *   - each requirement, with a place to answer it
 *   - approval controls, visible only to approvers
 *   - an audit trail of who did what
 */
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, Heading, Inline, Lozenge, SectionMessage, Select, Spinner, Stack, Strong, Tag,
  Text, Textfield, TextArea, User, Em, Label,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const STATUS = {
  'not-applicable': { appearance: 'default', label: 'No configured rule matched' },
  blocked: { appearance: 'removed', label: 'Blocked' },
  clear: { appearance: 'success', label: 'Clear to close' },
  exception: { appearance: 'moved', label: 'Exception recorded' },
};

const when = (ms) => (ms ? new Date(ms).toLocaleString() : '');

function RequirementInput({ requirement, value, onChange }) {
  if (requirement.type === 'choice') {
    const options = (requirement.options || []).map((o) => ({ label: o, value: o }));
    return (
      <Select
        inputId={requirement.id}
        options={options}
        value={options.find((o) => o.value === value) || null}
        onChange={(option) => onChange(option ? option.value : '')}
        placeholder="Choose one"
      />
    );
  }
  if (requirement.type === 'link') {
    return <Textfield id={requirement.id} value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value)} />;
  }
  return <TextArea id={requirement.id} value={value} placeholder={requirement.help || ''} onChange={(e) => onChange(e.target.value)} />;
}

function RuleCard({ match, savedAnswers, canApprove, selfApprovalBlocked, act, busy }) {
  const inputs = match.requirements.filter((r) => r.type !== 'approval');
  const approvalReq = match.requirements.find((r) => r.type === 'approval');
  const [draft, setDraft] = useState(() =>
    Object.fromEntries(inputs.map((r) => [r.id, savedAnswers?.[r.id]?.value || ''])),
  );
  const [dismissReason, setDismissReason] = useState('');
  const [showDismiss, setShowDismiss] = useState(false);
  const dirty = inputs.some((r) => (draft[r.id] || '') !== (savedAnswers?.[r.id]?.value || ''));
  const inputsDone = inputs.every((r) => r.satisfied);

  return (
    <Box padding="space.150" backgroundColor={match.satisfied ? 'color.background.success' : 'color.background.neutral'}>
      <Stack space="space.100">
        <Inline space="space.100" alignBlock="center" shouldWrap>
          <Heading size="small">{match.title}</Heading>
          <Lozenge appearance={match.satisfied ? 'success' : 'removed'}>{match.satisfied ? 'Done' : 'Open'}</Lozenge>
          <Tag text={match.clause} />
        </Inline>
        <Text>{match.summary}</Text>
        {match.policyRef && <Text><Em>Internal policy: {match.policyRef}</Em></Text>}
        <Text>
          <Strong>Why this matched: </Strong>
          {match.why.manual ? 'flagged manually' : ''}
          {match.why.sticky
            ? `matched earlier ("${(match.why.firstMatched?.phrases || []).join('", "')}"). It stays open after rewording until an approver dismisses it`
            : ''}
          {match.why.keywords.length ? `phrases "${match.why.keywords.join('", "')}"` : ''}
          {match.why.labels.length ? ` labels ${match.why.labels.join(', ')}` : ''}
        </Text>
        {match.why.snippet && <Text><Em>{match.why.snippet}</Em></Text>}

        {inputs.map((req) => (
          <Stack key={req.id} space="space.050">
            <Label labelFor={req.id}>
              {req.label}
              {req.clause ? ` (${req.clause})` : ''}
              {req.satisfied ? ' ✓' : ''}
            </Label>
            <RequirementInput requirement={req} value={draft[req.id] || ''} onChange={(v) => setDraft({ ...draft, [req.id]: v })} />
            {!req.satisfied && req.reason && <Text><Em>{req.reason}</Em></Text>}
          </Stack>
        ))}
        {inputs.length > 0 && (
          <Inline>
            <Button appearance="primary" isDisabled={!dirty || busy} onClick={() => act('saveAnswers', { ruleId: match.ruleId, answers: draft })}>
              Save answers
            </Button>
          </Inline>
        )}

        {approvalReq && (
          <Stack space="space.050">
            <Text><Strong>{approvalReq.label}</Strong></Text>
            {approvalReq.satisfied ? (
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Text>Approved by</Text>
                <User accountId={approvalReq.by} />
                <Text>{when(approvalReq.at)}</Text>
                {canApprove && (
                  <Button appearance="subtle" isDisabled={busy} onClick={() => act('revokeApproval', { ruleId: match.ruleId })}>
                    Revoke
                  </Button>
                )}
              </Inline>
            ) : (
              <Inline space="space.100" alignBlock="center" shouldWrap>
                <Text><Em>{approvalReq.reason}</Em></Text>
                {canApprove && !selfApprovalBlocked && (
                  <Button appearance="primary" isDisabled={!inputsDone || dirty || busy} onClick={() => act('approve', { ruleId: match.ruleId })}>
                    Approve
                  </Button>
                )}
              </Inline>
            )}
            {canApprove && !inputsDone && <Text><Em>Approval unlocks once the answers above are saved.</Em></Text>}
          </Stack>
        )}

        {canApprove && !match.why.manual && (
          <Stack space="space.050">
            {!showDismiss ? (
              <Inline>
                <Button appearance="subtle" onClick={() => setShowDismiss(true)}>Not relevant…</Button>
              </Inline>
            ) : (
              <Stack space="space.050">
                <Label labelFor={`dismiss-${match.ruleId}`}>Why this rule does not apply (kept in the audit trail)</Label>
                <Textfield id={`dismiss-${match.ruleId}`} value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} />
                <Inline space="space.100">
                  <Button isDisabled={!dismissReason.trim() || busy} onClick={() => act('dismissRule', { ruleId: match.ruleId, reason: dismissReason })}>
                    Dismiss rule
                  </Button>
                  <Button appearance="subtle" onClick={() => setShowDismiss(false)}>Cancel</Button>
                </Inline>
              </Stack>
            )}
          </Stack>
        )}
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

  const apply = (next) => {
    if (next?.ok === false) setError(next.error);
    else {
      setState(next);
      setError(null);
      setNotice(next?.notice || null);
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
  const status = STATUS[result.status];
  const answers = state.answers || {};

  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Lozenge appearance={status.appearance} isBold>{status.label}</Lozenge>
        <Text>{result.summary}</Text>
        <Button appearance="subtle" isDisabled={busy} onClick={() => act('getState')}>Re-check</Button>
      </Inline>

      <Text>
        <Em>
          Starter review rules, not legal advice. Your Information Officer decides which rules are active, and only a
          named approver can sign off.
        </Em>
      </Text>

      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {notice && <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage>}

      {state.hasActiveRules && !state.gate && (
        <SectionMessage appearance="warning" title="The Preflight gate has not run in this project yet">
          <Text>
            Until a Jira admin adds "Preflight privacy review gate" to the transition into Done, moving work to Done is
            not checked. See Jira settings → Apps → Preflight → Demo setup.
          </Text>
        </SectionMessage>
      )}

      {result.status === 'not-applicable' && state.hasActiveRules && (
        <Text>
          This does not mean the work has no privacy impact. If it changes how personal information is collected, used,
          stored or shared, flag a rule below.
        </Text>
      )}

      {state.canApprove && state.approverMode === 'small-team' && (
        <Text>
          <Em>Small-team mode: no named approvers are set, so Jira admins can approve. Name your Information Officer in Preflight settings.</Em>
        </Text>
      )}

      {!state.hasActiveRules && (
        <SectionMessage appearance="information" title="No rules are active yet">
          <Text>A Jira admin can activate the POPIA starter pack under Jira settings → Apps → Preflight.</Text>
        </SectionMessage>
      )}

      {result.status === 'blocked' && (
        <SectionMessage appearance="warning" title="This work item cannot be closed yet">
          <Text>
            The privacy review steps below must be completed first. Preflight checks your organisation's own review
            process; it does not give legal advice.
          </Text>
          <Inline>
            <Button isDisabled={busy} onClick={() => act('requestApproval', {})}>Request approval</Button>
          </Inline>
        </SectionMessage>
      )}

      {state.exception && (
        <SectionMessage appearance="discovery" title={result.exceptionExpired ? 'Exception expired' : 'Exception recorded'}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <User accountId={state.exception.by} />
            <Text>
              {state.exception.reason} ({when(state.exception.at)}
              {state.exception.expiresAt ? `, expires ${when(state.exception.expiresAt)}` : ''})
            </Text>
          </Inline>
          {state.canApprove && (
            <Inline><Button appearance="subtle" isDisabled={busy} onClick={() => act('clearException')}>Withdraw exception</Button></Inline>
          )}
        </SectionMessage>
      )}

      {result.applicable.map((match) => (
        <RuleCard
          key={`${match.ruleId}-${state.audit[0]?.at || 0}`}
          match={match}
          savedAnswers={answers[match.ruleId] || {}}
          canApprove={state.canApprove}
          selfApprovalBlocked={state.selfApprovalBlocked}
          act={act}
          busy={busy}
        />
      ))}

      {result.dismissed.length > 0 && (
        <Stack space="space.050">
          <Text><Strong>Dismissed rules</Strong></Text>
          {result.dismissed.map((d) => (
            <Inline key={d.ruleId} space="space.100" alignBlock="center" shouldWrap>
              <Text>{d.title}: {d.dismissal.reason}</Text>
              {state.canApprove && <Button appearance="subtle" onClick={() => act('restoreRule', { ruleId: d.ruleId })}>Restore</Button>}
            </Inline>
          ))}
        </Stack>
      )}

      {state.flaggableRules.length > 0 && (
        <Stack space="space.050">
          <Label labelFor="flag-rule">Preflight missed something? Flag a rule for this work item</Label>
          <Inline space="space.100" alignBlock="center">
            <Select
              inputId="flag-rule"
              options={state.flaggableRules.map((r) => ({ label: `${r.title} (${r.clause})`, value: r.id }))}
              value={flagChoice}
              onChange={setFlagChoice}
            />
            <Button isDisabled={!flagChoice || busy} onClick={() => { act('flagRule', { ruleId: flagChoice.value }); setFlagChoice(null); }}>
              Flag
            </Button>
          </Inline>
        </Stack>
      )}

      {state.canApprove && result.status === 'blocked' && (
        <Stack space="space.050">
          <Label labelFor="exception">
            Approver: the rules apply, but accept a time-limited deviation for this work item (reason kept in the audit trail)
          </Label>
          <Textfield id="exception" value={exceptionReason} placeholder="Reason" onChange={(e) => setExceptionReason(e.target.value)} />
          <Inline space="space.100" alignBlock="center">
            <Label labelFor="exception-days">Valid for (days)</Label>
            <Textfield id="exception-days" type="number" width={80} value={exceptionDays} onChange={(e) => setExceptionDays(e.target.value)} />
            <Button isDisabled={!exceptionReason.trim() || busy} onClick={() => act('setException', { reason: exceptionReason, days: Number(exceptionDays) })}>
              Grant exception
            </Button>
          </Inline>
        </Stack>
      )}

      {state.audit.length > 0 && (
        <Stack space="space.050">
          <Text><Strong>Audit trail</Strong></Text>
          {state.audit.map((entry) => (
            <Inline key={`${entry.at}-${entry.event}`} space="space.100" alignBlock="center" shouldWrap>
              <Text>{when(entry.at)}</Text>
              {entry.by && entry.by !== 'app' && entry.by !== 'rovo' ? <User accountId={entry.by} /> : <Text>{entry.by}</Text>}
              <Text>{entry.event}</Text>
            </Inline>
          ))}
        </Stack>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
