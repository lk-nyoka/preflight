/**
 * POPIA starter rule pack.
 *
 * Editable STARTER review rules inspired by selected POPIA themes. They are
 * not a complete POPIA assessment. They encode a typical organisation's INTERNAL privacy review steps,
 * each anchored to the section of the Protection of Personal Information Act,
 * 2013 (Act 4 of 2013) that motivates it. They are a starting template for an
 * Information Officer to review, edit and activate. They are not legal advice
 * and Preflight never states that work is "POPIA compliant".
 *
 * Section references used:
 *   s1      definition of "personal information" (includes identifying numbers)
 *   s10     minimality
 *   s11     lawfulness of processing (consent, justification and objection)
 *   s13     collection for a specific purpose
 *   s18     notification to data subject when collecting personal information
 *   s14     retention and restriction of records
 *   s19     security measures on integrity and confidentiality
 *   s26-27  special personal information (prohibition and general authorisation)
 *   s34-35  personal information of children
 *   s69     direct marketing by means of unsolicited electronic communications
 *   s72     transfers of personal information outside the Republic
 */

const approval = (help) => ({
  id: 'io-approval',
  label: 'Information Officer (or delegate) approval',
  type: 'approval',
  help: help || 'An approver confirms the answers above match the internal privacy policy.',
});

export const POPIA_PACK_ID = 'popia-starter-v1';

export const POPIA_RULES = [
  {
    id: 'popia-identifiers',
    title: 'Identifying numbers',
    clause: 'POPIA s1, s10, s11, s13, s14, s18',
    policyRef: 'Privacy Policy 4.1 – Collecting identifiers',
    severity: 'high',
    summary:
      'This work may collect or store an identifier (ID, passport or similar number). Record your review: why it is needed, why less data will not do, the lawful basis, how people are told, and how long it is kept.',
    triggers: {
      keywords: [
        'id number', 'identity number', 'sa id', 'rsa id', 'national id', 'passport number', 'passport',
        'identity document', 'tax number', 'employee number', 'student number', 'account number',
      ],
      labels: ['pii', 'personal-data'],
    },
    requirements: [
      { id: 'purpose', label: 'Specific purpose for collecting it', type: 'answer', clause: 's13', help: 'What exactly will the identifier be used for?' },
      { id: 'minimality', label: 'Why less data will not do', type: 'answer', clause: 's10', help: 'E.g. why date of birth or a verification token is not enough.' },
      {
        id: 'lawful-basis',
        label: 'Lawful basis for processing',
        type: 'choice',
        clause: 's11(1)',
        options: [
          'Consent of the data subject',
          'Necessary to conclude or perform a contract with the data subject',
          'Required to comply with an obligation imposed by law',
          'Protects a legitimate interest of the data subject',
          'Necessary for a public body to perform a public law duty',
          'Legitimate interests of the organisation or a third party',
        ],
      },
      { id: 'notification', label: 'How people are told at collection', type: 'answer', clause: 's18', help: 'E.g. "Signup screen links to the privacy notice, which lists the ID number and why".' },
      { id: 'retention', label: 'Retention period and deletion trigger', type: 'answer', clause: 's14', help: 'E.g. "Deleted 5 years after account closure (FICA)".' },
      approval(),
    ],
  },
  {
    id: 'popia-special',
    title: 'Special personal information',
    clause: 'POPIA s26, s27',
    policyRef: 'Privacy Policy 5 – Special personal information',
    severity: 'high',
    summary:
      'This work may involve special personal information (health, biometric, religion, race or ethnic origin, trade union, political, sex life or criminal behaviour). Record which section 27 authorisation your organisation relies on and the security review.',
    triggers: {
      keywords: [
        'medical', 'health data', 'health record', 'health information', 'diagnosis', 'allergy', 'allergies', 'disability', 'biometric', 'fingerprint',
        'face recognition', 'facial recognition', 'religion', 'religious', 'racial', 'race or ethnic', 'ethnicity', 'ethnic origin',
        'trade union', 'union membership', 'political', 'criminal record', 'criminal behaviour', 'sex life',
      ],
      labels: ['special-pi'],
    },
    requirements: [
      {
        id: 'basis',
        label: 'Section 27 authorisation relied on',
        type: 'choice',
        clause: 's27',
        options: [
          'Consent of the data subject',
          'Establishment, exercise or defence of a right or obligation in law',
          'Obligation of international public law',
          'Historical, statistical or research purposes',
          'Information deliberately made public by the data subject',
          'Authorisation from the Information Regulator',
        ],
      },
      { id: 'safeguards', label: 'Security review or DPIA link', type: 'link', clause: 's19', help: 'Link to the Confluence page with the security review.' },
      approval('Special personal information always needs approver sign-off.'),
    ],
  },
  {
    id: 'popia-children',
    title: "Children's personal information",
    clause: 'POPIA s34, s35',
    policyRef: 'Privacy Policy 6 – Children',
    severity: 'high',
    summary:
      'This work may involve personal information of children (under 18). Record how consent from a parent or guardian (or another section 35 authorisation) is obtained and how age is determined.',
    triggers: {
      // Deliberately avoids "child", "children" and "minor": in Jira those usually mean child issues or minor versions.
      keywords: ['learner', 'learners', 'pupil', 'pupils', 'under 18', 'kids', 'children s data', 'child data', 'parental consent', 'parent consent', 'guardian', 'school learners'],
      labels: ['children'],
    },
    requirements: [
      { id: 'consent-mechanism', label: 'How a parent or guardian gives consent', type: 'answer', clause: 's35(1)(a)' },
      { id: 'age-check', label: 'How age is determined', type: 'answer', clause: 's34' },
      approval(),
    ],
  },
  {
    id: 'popia-direct-marketing',
    title: 'Electronic direct marketing',
    clause: 'POPIA s69',
    policyRef: 'Privacy Policy 7 – Marketing',
    severity: 'medium',
    summary:
      'This work may send electronic direct marketing (email, SMS, WhatsApp, automated calls). Record the basis for contacting each recipient and how every message offers an opt-out.',
    triggers: {
      keywords: [
        'marketing email', 'newsletter', 'promo', 'promotional', 'campaign', 'sms blast', 'bulk sms', 'whatsapp broadcast',
        'mailing list', 'drip campaign', 'cold email', 'upsell email',
      ],
      labels: ['marketing'],
    },
    requirements: [
      {
        id: 'basis',
        label: 'Basis for contacting recipients',
        type: 'choice',
        clause: 's69(1)',
        options: ['Recipient gave prior consent', 'Existing customer, similar products, opt-out offered at collection'],
      },
      { id: 'opt-out', label: 'How each message offers an opt-out', type: 'answer', clause: 's69(4)' },
    ],
  },
  {
    id: 'popia-cross-border',
    title: 'Transfer outside South Africa',
    clause: 'POPIA s72',
    policyRef: 'Privacy Policy 8 – Vendors and hosting',
    severity: 'high',
    summary:
      'This work may send personal information to a recipient outside South Africa. Record the destination and which section 72 ground your organisation relies on.',
    triggers: {
      keywords: [
        'offshore', 'overseas', 'us region', 'eu region', 'us-east', 'eu-west', 'third party vendor', 'third-party vendor',
        'crm vendor', 'export to', 'transfer abroad', 'outside south africa', 'international vendor', 'sync to hubspot',
        'sync to salesforce',
      ],
      labels: ['cross-border'],
    },
    requirements: [
      { id: 'destination', label: 'Destination country and recipient', type: 'answer', clause: 's72' },
      {
        id: 'ground',
        label: 'Section 72 ground relied on',
        type: 'choice',
        clause: 's72(1)',
        options: [
          'Recipient bound by law, rules or agreement giving adequate protection',
          'Data subject consented to the transfer',
          'Necessary to perform a contract with the data subject',
          'For the benefit of the data subject and consent not reasonably obtainable',
        ],
      },
      approval(),
    ],
  },
  {
    id: 'popia-bulk-export',
    title: 'Bulk export or sharing',
    clause: 'POPIA s14, s19',
    policyRef: 'Privacy Policy 9 – Security safeguards',
    severity: 'medium',
    summary:
      'This work may create an export, dump or shared copy of personal information. Record the safeguards for the copy and when it is deleted.',
    triggers: {
      keywords: ['csv export', 'data export', 'export customers', 'customer list', 'data dump', 'database dump', 'share with vendor', 'spreadsheet of customers', 'download all users'],
      labels: ['export'],
    },
    requirements: [
      { id: 'safeguards', label: 'Safeguards for the copy (access, encryption)', type: 'answer', clause: 's19' },
      { id: 'deletion', label: 'When and how the copy is deleted', type: 'answer', clause: 's14' },
    ],
  },
];

/** Demo work items created by the "Load demo project" button. */
export const DEMO_ISSUES = [
  {
    summary: 'Add SA ID number field to customer signup',
    description:
      'Compliance asked us to capture the customer SA ID number during signup so support can verify callers. Add a required field to the signup form and store it on the customer record.',
  },
  {
    summary: 'Store learner allergy and medical notes for school trip bookings',
    description:
      'Schools want to upload learner medical notes and allergies when they book a trip, so our guides know what to prepare for. Learners are aged 9 to 14.',
  },
  {
    summary: 'Send festive season promo SMS to everyone on the mailing list',
    description: 'Marketing wants a bulk SMS campaign to every phone number we hold, including people who only requested a quote.',
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
