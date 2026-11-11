/**
 * GDPR-inspired STARTER review rules (EU General Data Protection Regulation, 2016/679).
 *
 * Same idea as the POPIA pack: editable starter rules that encode a typical
 * internal privacy review for a Data Protection Officer to adapt and activate.
 * Not a complete GDPR assessment and not legal advice.
 *
 * Detection reuses the POPIA pack's vocabulary (people describe the same work
 * the same way in Jira), with EU identifiers added and one real difference:
 * under GDPR a "transfer" means personal data leaving the EEA, so hosting in
 * Ireland or Frankfurt is NOT a transfer, while hosting in the US, India or
 * South Africa is.
 *
 * Articles used:
 *   Art 5     principles (purpose limitation, data minimisation, storage limitation, security)
 *   Art 6     lawfulness of processing
 *   Art 8     conditions for a child's consent (information society services)
 *   Art 9-10  special categories; criminal convictions and offences
 *   Art 13    information to be provided to the data subject
 *   Art 21    right to object (direct marketing)
 *   Art 28    processors
 *   Art 32    security of processing
 *   Art 35    data protection impact assessment
 *   Art 44-49 transfers to third countries
 *   Art 87    national identification numbers
 *   ePrivacy Directive Art 13 (unsolicited electronic marketing)
 */
import { POPIA_RULES } from './popia.js';

export const GDPR_PACK_ID = 'gdpr-starter-v1';
export const GDPR_DECLARATION_RULE_ID = 'gdpr-personal-info';

const approval = (help) => ({
  id: 'dpo-approval',
  label: 'Data Protection Officer (or delegate) approval',
  type: 'approval',
  stage: 'build',
  help: help || 'An approver confirms the answers above match the internal privacy policy before work starts.',
});

const LAWFUL_BASIS = [
  'Consent (Art 6(1)(a))',
  'Performance of a contract with the data subject (Art 6(1)(b))',
  'Legal obligation (Art 6(1)(c))',
  'Vital interests (Art 6(1)(d))',
  'Public task (Art 6(1)(e))',
  'Legitimate interests, with a balancing test on file (Art 6(1)(f))',
];

const base = (id) => {
  const rule = POPIA_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`POPIA rule ${id} not found`);
  return structuredClone(rule);
};
const req = (rule, id) => rule.requirements.find((r) => r.id === id);
const RETENTION = (r) => ({ ...req(r, 'retention') });

/** Places inside the EEA: hosting there is not a GDPR transfer. */
const EEA_TERMS = new Set([
  'ireland', 'germany', 'netherlands', 'france', 'europe', 'west europe', 'north europe', 'europe west', 'eu north',
  'eu region', 'eu west', 'eu central', 'eu hosted',
]);

function gdprIdentifiers() {
  const r = base('popia-identifiers');
  r.triggers.keywords.push(
    'social security number', 'ssn', 'national insurance number', 'ni number', 'nino', 'tax identification number', 'tin number',
    'bsn', 'burgerservicenummer', 'steuer id', 'steueridentifikationsnummer', 'personnummer', 'pesel', 'nir number', 'codice fiscale',
    'dni', 'nie number', 'ppsn', 'pps number', 'iban',
  );
  return {
    ...r,
    id: 'gdpr-identifiers',
    clause: 'GDPR Art 5(1)(b)(c)(e), Art 6, Art 13, Art 87',
    policyRef: 'Privacy Policy 4.1 – Collecting identifiers',
    summary: 'This work may collect or store an identifier (national ID, passport, social security or similar number). Record why it is needed, why less data will not do, the lawful basis and how long it is kept, then show how people are told.',
    requirements: [
      { ...req(r, 'purpose'), clause: 'Art 5(1)(b)' },
      { ...req(r, 'minimality'), clause: 'Art 5(1)(c)' },
      { ...req(r, 'lawful-basis'), clause: 'Art 6(1)', options: LAWFUL_BASIS },
      { ...RETENTION(r), clause: 'Art 5(1)(e)', help: 'E.g. "Deleted 10 years after account closure, as anti-money-laundering law requires".' },
      approval(),
      { ...req(r, 'notification'), clause: 'Art 13' },
    ],
    examples: {
      match: ['Add national insurance number to the payroll form', 'Store customer passport number for KYC', 'Capture social security number at onboarding'],
      ignore: r.examples.ignore,
    },
  };
}

function gdprPersonalInfo() {
  const r = base('popia-personal-info');
  return {
    ...r,
    id: 'gdpr-personal-info',
    clause: 'GDPR Art 5, Art 6, Art 13',
    summary: 'This work may collect, use or share personal data (contact details, location, online identifiers, financial or employment details). Record the purpose, lawful basis and retention.',
    requirements: r.requirements.map((q) => {
      if (q.id === 'purpose') return { ...q, clause: 'Art 5(1)(b)' };
      if (q.id === 'lawful-basis') return { ...q, clause: 'Art 6(1)', options: LAWFUL_BASIS };
      if (q.id === 'retention') return { ...q, clause: 'Art 5(1)(e)' };
      if (q.type === 'approval') return approval();
      return { ...q, clause: q.clause ? 'Art 13' : q.clause };
    }),
  };
}

function gdprSpecial() {
  const r = base('popia-special');
  return {
    ...r,
    id: 'gdpr-special',
    title: 'Special category data',
    clause: 'GDPR Art 9, Art 10, Art 35',
    policyRef: 'Privacy Policy 5 – Special category data',
    summary: 'This work may involve special category data (health, biometric, genetic, racial or ethnic origin, religion, trade union, political opinions, sex life or orientation) or criminal offence data. Record the Article 9 condition and the DPIA.',
    requirements: [
      {
        id: 'basis',
        label: 'Article 9(2) condition relied on',
        type: 'choice',
        stage: 'build',
        clause: 'Art 9(2)',
        options: [
          'Explicit consent (Art 9(2)(a))',
          'Employment and social security obligations (Art 9(2)(b))',
          'Vital interests where consent cannot be given (Art 9(2)(c))',
          'Data manifestly made public by the data subject (Art 9(2)(e))',
          'Legal claims (Art 9(2)(f))',
          'Substantial public interest under member state law (Art 9(2)(g))',
          'Health or social care by a professional under confidentiality (Art 9(2)(h))',
          'Public health (Art 9(2)(i))',
          'Archiving, research or statistics with safeguards (Art 9(2)(j))',
          'Criminal offence data processed under Art 10 authority',
        ],
      },
      approval('Special category data always needs approver sign-off.'),
      { id: 'safeguards', label: 'Data protection impact assessment (link)', type: 'link', stage: 'done', clause: 'Art 35', help: 'Link to the DPIA or the Confluence page explaining why one is not required.' },
    ],
  };
}

function gdprChildren() {
  const r = base('popia-children');
  return {
    ...r,
    id: 'gdpr-children',
    title: "Children's personal data",
    clause: 'GDPR Art 8, Recital 38',
    policyRef: 'Privacy Policy 6 – Children',
    summary: 'This work may process personal data of children. Online services relying on consent need a parent or guardian to consent below the member state age (13 to 16). Record how consent and age are handled.',
    requirements: r.requirements.map((q) => {
      if (q.id === 'consent-mechanism') return { ...q, clause: 'Art 8(1)', help: 'E.g. a parent confirms by e-mail before the account is active.' };
      if (q.id === 'age-check') return { ...q, clause: 'Art 8(2)', help: 'Which member state age applies, and how age is checked.' };
      if (q.type === 'approval') return approval();
      return q;
    }),
  };
}

function gdprMarketing() {
  const r = base('popia-direct-marketing');
  return {
    ...r,
    id: 'gdpr-direct-marketing',
    clause: 'GDPR Art 6, Art 21(2)-(3); ePrivacy Directive Art 13',
    summary: 'This work may send electronic direct marketing. Under the ePrivacy rules this needs prior consent, or an existing customer relationship with an easy opt-out. Every message must offer a way to object.',
    requirements: r.requirements.map((q) => {
      if (q.id === 'basis') return { ...q, clause: 'ePrivacy Art 13', options: ['Recipient gave prior consent (ePrivacy Art 13(1))', 'Existing customer, similar products, opt-out offered at collection (Art 13(2))'] };
      if (q.id === 'opt-out') return { ...q, clause: 'Art 21(2)-(3)' };
      if (q.type === 'approval') return approval();
      return q;
    }),
  };
}

function gdprCrossBorder() {
  const r = base('popia-cross-border');
  const notEea = (xs) => xs.filter((x) => !EEA_TERMS.has(x));
  const t = r.triggers;
  t.keywords = [
    ...t.keywords.filter((k) => !['outside south africa', 'eu hosted'].includes(k)),
    'outside the eea', 'outside the eu', 'third country', 'transfer to the us', 'hosted in south africa', 'hosted in india',
  ];
  t.contextual = t.contextual.map((g) => ({ ...g, terms: notEea(g.terms), with: notEea(g.with) })).filter((g) => g.terms.length);
  // South Africa is a third country for an EU controller (POPIA's pack, written from South Africa, never needed it).
  const countries = t.contextual.find((g) => g.terms.includes('singapore'));
  countries.terms.push('south africa', 'johannesburg', 'cape town');
  return {
    ...r,
    id: 'gdpr-cross-border',
    title: 'Transfer outside the EEA',
    clause: 'GDPR Art 44-49',
    policyRef: 'Privacy Policy 8 – Vendors and hosting',
    summary: 'This work may send personal data to a recipient outside the European Economic Area. Record the destination and the Chapter V transfer mechanism.',
    triggers: t,
    requirements: [
      { ...req(r, 'destination'), clause: 'Art 44' },
      {
        id: 'ground',
        label: 'Transfer mechanism relied on',
        type: 'choice',
        stage: 'build',
        clause: 'Art 45-49',
        options: [
          'Adequacy decision for the destination (Art 45), e.g. EU-US Data Privacy Framework certified recipient',
          'Standard contractual clauses (Art 46(2)(c)) with a transfer impact assessment',
          'Binding corporate rules (Art 47)',
          'Explicit consent after being told the risks (Art 49(1)(a))',
          'Necessary to perform a contract with the data subject (Art 49(1)(b))',
        ],
      },
      approval(),
      { ...req(r, 'agreement'), clause: 'Art 28, Art 46' },
    ],
    examples: {
      match: ['Sync customer list to our US-based CRM vendor', 'Move backups to the AWS af-south region', 'Send applicant files to our recruiter in India via a third party'],
      ignore: ['Move backups to the eu-west region', 'Migrate customer database to vendor hosted in Ireland', 'Update the US English spelling in the UI'],
    },
  };
}

function gdprBulkExport() {
  const r = base('popia-bulk-export');
  return {
    ...r,
    id: 'gdpr-bulk-export',
    clause: 'GDPR Art 5(1)(e)(f), Art 28, Art 32',
    requirements: r.requirements.map((q) => {
      if (q.id === 'safeguards') return { ...q, clause: 'Art 32' };
      if (q.id === 'deletion') return { ...q, clause: 'Art 5(1)(e)' };
      if (q.type === 'approval') return approval();
      return q;
    }),
  };
}

export const GDPR_RULES = [
  gdprIdentifiers(), gdprPersonalInfo(), gdprSpecial(), gdprChildren(), gdprMarketing(), gdprCrossBorder(), gdprBulkExport(),
].map((r) => ({ ...r, declaration: r.id === GDPR_DECLARATION_RULE_ID || undefined }));

/** Demo work items for the GDPR pack. */
export const GDPR_DEMO_ISSUES = [
  {
    summary: 'Add national ID number field to customer onboarding',
    description: 'Compliance asked us to capture the customer national ID number during onboarding so support can verify callers. Add a required field to the onboarding form and save it with the new account.',
  },
  {
    summary: 'Store pupil allergy and medical notes for school trip bookings',
    description: 'Schools want to upload pupil medical notes and allergies when they book a trip, so our guides know what to prepare for. Pupils are aged 9 to 14.',
  },
  {
    summary: 'Send Black Friday promo emails to everyone on the mailing list',
    description: 'Marketing wants a bulk email campaign to every address we hold, including people who only requested a quote.',
  },
  {
    summary: 'Sync customer list to our US-based CRM vendor',
    description: 'Nightly job that pushes the full customer list (names, emails, phone numbers) to the CRM vendor hosted in the us-east region.',
  },
  {
    summary: 'Update footer copyright year',
    description: 'Change the footer to show the current year. No data changes.',
  },
];
