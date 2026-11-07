/**
 * POPIA-inspired STARTER review rules.
 *
 * Editable starter rules inspired by selected themes in South Africa's
 * Protection of Personal Information Act, 2013 (Act 4 of 2013). Not a complete
 * POPIA assessment and not legal advice. They encode a typical organisation's
 * internal privacy review steps for an Information Officer to review, adapt
 * and activate.
 *
 * Section references used:
 *   s1      definition of "personal information" (includes identifying numbers, contact details, location)
 *   s10     minimality
 *   s11     lawfulness of processing (consent, justification and objection)
 *   s13     collection for a specific purpose
 *   s14     retention and restriction of records
 *   s18     notification to data subject when collecting personal information
 *   s19     security measures on integrity and confidentiality
 *   s26-27  special personal information (prohibition and general authorisation)
 *   s34-35  personal information of children
 *   s69     direct marketing by means of unsolicited electronic communications
 *   s72     transfers of personal information outside the Republic
 *
 * Requirement stages: "build" items are answered and approved before work
 * starts (privacy by design); "done" items are evidence that it was built as
 * agreed, checked before the work item is closed.
 *
 * Every rule carries examples that must / must not match. They run in the unit
 * tests and in the admin editor, so trigger edits cannot silently regress.
 */

const approval = (help) => ({
  id: 'io-approval',
  label: 'Information Officer (or delegate) approval',
  type: 'approval',
  stage: 'build',
  help: help || 'An approver confirms the answers above match the internal privacy policy before work starts.',
});

const LAWFUL_BASIS = [
  'Consent of the data subject',
  'Necessary to conclude or perform a contract with the data subject',
  'Required to comply with an obligation imposed by law',
  'Protects a legitimate interest of the data subject',
  'Necessary for a public body to perform a public law duty',
  'Legitimate interests of the organisation or a third party',
];

/** A retention answer must say when the data goes: a period or the event that ends it. */
const ENDS = {
  mustMention: ['day', 'week', 'month', 'year', 'hour', 'closure', 'closed', 'close', 'delete', 'deletion', 'until', 'after', 'end', 'expire', 'expiry', 'cancel', 'terminat', 'withdraw', 'opt out', 'unsubscribe', 'leave', 'resign', 'stop', 'no longer', 'once'],
  mustMentionHint: 'Say when it is deleted: a period (e.g. 5 years) or the event that ends it (e.g. account closure)',
};

const ACTIONS = ['store', 'save', 'capture', 'collect', 'add', 'record', 'track', 'log', 'upload', 'import', 'export', 'sync', 'share', 'send', 'keep', 'process', 'field', 'form', 'database', 'profile'];

export const POPIA_PACK_ID = 'popia-starter-v3';
export const DECLARATION_RULE_ID = 'popia-personal-info';

export const POPIA_RULES = [
  {
    id: 'popia-identifiers',
    title: 'Identifying numbers',
    clause: 'POPIA s1, s10, s11, s13, s14, s18',
    policyRef: 'Privacy Policy 4.1 – Collecting identifiers',
    severity: 'high',
    summary:
      'This work may collect or store an identifier (ID, passport or similar number). Record your review: why it is needed, why less data will not do, the lawful basis and how long it is kept, then show how people are told.',
    triggers: {
      keywords: [
        'id number', 'id no', 'identity number', 'identification number', 'sa id', 'rsa id', 'national id',
        'passport number', 'identity document', 'id document', '13 digit id', 'tax number', 'tax reference number',
        'employee number', 'student number', 'fica document', 'kyc document', 'proof of address', 'proof of residence', 'driver licence number', 'drivers licence number', 'driving licence number',
        'card number', 'card no', 'acc no', 'account no', 'vehicle reg', 'vehicle registration', 'registration number', 'number plate', 'licence plate', 'license plate',
        'id photo', 'photo id', 'id scan', 'id copy', 'copy of id', 'copy of their id', 'id book', 'smart id card', 'refugee number', 'asylum number',
      ],
      contextual: [
        { terms: ['passport'], with: ACTIONS },
        { terms: ['account number', 'bank account'], with: ['customer', 'client', 'user', 'member', 'employee', 'staff', 'debit order', 'payout', 'refund', 'onboarding', 'field', 'form'] },
        { terms: ['selfie', 'selfies'], with: ['store', 'save', 'upload', 'verification', 'verify', 'kyc', 'rica', 'capture', 'id', 'liveness', 'onboarding', 'bucket'] },
        { terms: ['rica'], with: ['verification', 'verify', 'id', 'passport', 'proof', 'store', 'capture', 'upload', 'selfie', 'photo'] },
      ],
      exclude: ['account number format', 'id number format'],
      labels: ['pii', 'personal-data'],
    },
    requirements: [
      { id: 'purpose', label: 'Specific purpose for collecting it', type: 'answer', stage: 'build', clause: 's13', minWords: 6, help: 'What exactly will the identifier be used for?' },
      { id: 'minimality', label: 'Why less data will not do', type: 'answer', stage: 'build', clause: 's10', help: 'E.g. why date of birth or a verification token is not enough.' },
      { id: 'lawful-basis', label: 'Lawful basis for processing', type: 'choice', stage: 'build', clause: 's11(1)', options: LAWFUL_BASIS },
      { id: 'retention', label: 'Retention period and deletion trigger', type: 'answer', stage: 'build', clause: 's14', help: 'E.g. "Deleted 5 years after account closure, as FICA requires".', ...ENDS },
      approval(),
      { id: 'notification', label: 'Privacy notice updated (link)', type: 'link', stage: 'done', clause: 's18', help: 'Link to the notice or screen that tells people about the new field.' },
    ],
    examples: {
      match: [
        'Add SA ID number field to customer signup',
        'Store customer ID numbers on signup',
        'Collect identity numbers for KYC',
        'Save users ID no. in profile',
        'Add field for 13-digit ID',
        'Capture passport details for visa letters',
        'Store customer bank account numbers for refunds',
      ],
      ignore: [
        'Passport-style photo upload for staff badges',
        'Update the account number format validation for invoices',
        'Show the order number on the receipt',
        'Log the request ID for tracing',
      ],
    },
  },
  {
    id: 'popia-personal-info',
    title: 'Contact details and location',
    clause: 'POPIA s1, s10, s11, s13, s14',
    policyRef: 'Privacy Policy 4.2 – Collecting personal information',
    severity: 'medium',
    summary:
      'This work may collect, store or share contact details, location or online identifiers. Record why they are needed, the lawful basis and how long they are kept.',
    triggers: {
      keywords: [
        'email address', 'e mail address', 'phone number', 'mobile number', 'cellphone number', 'cell number',
        'home address', 'physical address', 'residential address', 'postal address', 'date of birth',
        'geolocation', 'location tracking', 'live location', 'ip address', 'device id', 'device fingerprint', 'customer name',
        'full name', 'next of kin', 'emergency contact', 'monthly income', 'income detail', 'credit score', 'bank detail', 'bank statement',
        'delivery address', 'shipping address', 'billing address', 'gate code', 'purchase history', 'order history', 'browsing history',
        'lookalike audience', 'custom audience', 'claims history', 'claim history', 'claimant', 'policyholder', 'grant recipient', 'indigent',
        'beneficiary detail', 'repayment behaviour', 'repayment behavior', 'repayment history', 'payment history',
        'credit scoring', 'credit bureau', 'transunion', 'experian', 'compuscan', 'xds', 'affordability check', 'affordability assessment', 'loan eligibility',
        'telematics', 'pay as you drive', 'tracking data', 'driving behaviour', 'driving behavior',
        'cv', 'cvs', 'curriculum vitae', 'job applicant', 'rejected applicant', 'talent pool', 'background check', 'reference check',
        'personal information', 'personal data', 'pii', 'popi', 'sensitive data', 'customer record', 'employee record', 'hr record',
        'staff record', 'patient record', 'cctv', 'camera footage', 'credit bureau', 'credit check', 'tracking pixel', 'facebook pixel',
        'meta pixel', 'cookie consent', 'third party cookie', 'data subject access', 'subject access request', 'download all their data',
        'download their personal data', 'right to be forgotten', 'delete my account',
      ],
      contextual: [
        { terms: ['footage', 'recording'], with: ['visitor', 'cctv', 'camera', 'retain', 'retention', 'store', 'customer', 'call'] },
        { terms: ['location'], with: ['track', 'tracking', 'employee', 'driver', 'user', 'customer', 'live', 'real time', 'history'] },
        { terms: ['contact', 'contacts', 'customer list', 'user list', 'mailing list'], with: ['import', 'export', 'sync', 'upload', 'crm', 'hubspot', 'salesforce', 'share'] },
        { terms: ['gps'], with: ['track', 'tracking', 'location', 'driver', 'employee', 'staff', 'user', 'customer', 'vehicle', 'fleet', 'store', 'log', 'history', 'live', 'real time', 'outside'] },
        { terms: ['salary', 'salaries', 'payslip', 'payslips', 'income'], with: ['employee', 'staff', 'store', 'share', 'export', 'manager', 'dashboard', 'profile', 'record', 'data', 'detail', 'bureau', 'loan', 'history', 'import', 'sync', 'upload', 'send', 'applicant', 'customer'] },
        { terms: ['email', 'emails', 'cellphone', 'cell phone', 'phone', 'phones', 'whatsapp number'], with: ['lead', 'form', 'field', 'capture', 'collect', 'store', 'save', 'profile', 'share', 'agency', 'export', 'import', 'list', 'database', 'crm', 'address', 'reorder', 'resident', 'shopper', 'parent'] },
        { terms: ['customer data', 'user data', 'member data', 'client data', 'employee data', 'staff data', 'student data', 'learner data', 'patient data',
          'customer database', 'user database', 'customer db', 'borrower', 'subscriber data'],
        with: ['share', 'sell', 'sold', 'send', 'partner', 'agency', 'third party', 'vendor', 'export', 'migrate', 'sync', 'transfer', 'disclose', 'pass', 'give', 'publish', 'combine', 'merge', 'enrich', 'collection'] },
        { terms: ['debt collection', 'debt collector', 'debtor', 'debtors'], with: ['share', 'send', 'agency', 'partner', 'export', 'data', 'borrower', 'customer', 'detail', 'list', 'hand over'] },
        { terms: ['indefinitely', 'forever', 'retention period', 'retention policy', 'data retention', 'keep for longer', 'purge'],
          with: ['record', 'account', 'customer', 'user', 'data', 'log', 'member', 'employee', 'applicant', 'patient', 'call recording', 'personal'] },
        { terms: ['address', 'addresses'], with: ['name', 'holder', 'customer', 'resident', 'member', 'employee', 'parent', 'recipient', 'billing system'] },
        { terms: ['recipient', 'recipients', 'beneficiary', 'beneficiaries', 'resident', 'residents'], with: ['list', 'publish', 'export', 'share', 'name', 'address', 'id', 'detail', 'cell', 'phone', 'grant'] },
      ],
      exclude: ['offer letter template', 'gps icon', 'phone number format', 'phone number formatting', 'phone number validation library', 'phone number input', 'ip address allowlist', 'email address validation regex'],
      labels: ['personal-info'],
    },
    requirements: [
      { id: 'purpose', label: 'Specific purpose', type: 'answer', stage: 'build', clause: 's13', minWords: 6, help: 'What exactly will it be used for, and by whom?' },
      { id: 'lawful-basis', label: 'Lawful basis for processing', type: 'choice', stage: 'build', clause: 's11(1)', options: LAWFUL_BASIS },
      { id: 'retention', label: 'Retention period and deletion trigger', type: 'answer', stage: 'build', clause: 's14', help: 'E.g. "Deleted 2 years after the last order".', ...ENDS },
      approval(),
    ],
    examples: {
      match: [
        'Track employee location via GPS',
        'Log users email addresses and home addresses',
        'Import CRM contacts from HubSpot',
        'Add date of birth to the member profile',
        "Save shopper's delivery address and phone for one-click reorder",
        'Show staff salaries on the manager dashboard',
        'Share borrower repayment behaviour with a debt collection agency',
      ],
      ignore: [
        'Fix the contact us page layout', 'Move the office location on the map', 'Update the support email template wording',
        'Fix GPS icon alignment on map', 'Update payslip PDF template font', 'Fix salary range slider on job ad form', 'Email receipt after sale',
      ],
    },
  },
  {
    id: 'popia-special',
    title: 'Special personal information',
    clause: 'POPIA s26, s27',
    policyRef: 'Privacy Policy 5 – Special personal information',
    severity: 'high',
    summary:
      'This work may involve special personal information (health, biometric, religion, race or ethnic origin, trade union, political persuasion, sex life or criminal behaviour). Record which section 27 authorisation your organisation relies on and the security review.',
    triggers: {
      keywords: [
        'health data', 'health record', 'health information', 'allergy', 'allergies', 'medical record', 'medical history', 'medical condition',
        'medical note', 'medical information', 'medical detail', 'medical underwriting', 'medication', 'prescription', 'chronic condition', 'hiv',
        'tb status', 'pregnancy', 'pregnant', 'discharge summary', 'discharge note', 'lab result', 'blood test', 'hiv test', 'sick leave', 'mental health', 'therapy note',
        'biometric', 'fingerprint', 'face recognition', 'facial recognition', 'face id', 'voice print', 'voiceprint', 'religion',
        'religious', 'racial', 'race or ethnic', 'ethnicity', 'ethnic origin', 'trade union', 'union membership',
        'criminal record', 'criminal behaviour', 'sex life', 'sexual orientation', 'hiv status', 'employment equity', 'sick note', 'medical certificate',
      ],
      contextual: [
        { terms: ['political'], with: ['opinion', 'affiliation', 'persuasion', 'views', 'membership', 'voter', 'belief'] },
        { terms: ['race', 'gender'], with: ['employee', 'staff', 'field', 'report', 'b bbee', 'bbbee', 'demographic', 'equity', 'applicant', 'customer'] },
        { terms: ['diagnosis', 'diagnose'], with: ['patient', 'employee', 'staff', 'member', 'customer', 'leave', 'record', 'learner'] },
        { terms: ['patient', 'patients', 'hospital', 'clinic', 'clinical', 'doctor', 'nurse', 'gp'],
          with: ['record', 'history', 'note', 'detail', 'information', 'file', 'list', 'result', 'summary', 'view', 'see', 'share', 'store', 'save', 'upload', 'attach', 'remind', 'reminder', 'message', 'whatsapp', 'sms', 'email', 'export', 'data', 'condition', 'medication', 'chronic', 'appointment', 'lookup', 'look up', 'search', 'partner', 'pharmacy', 'pharmacies', 'endpoint', 'api'] },
        { terms: ['medical'], with: ['note', 'record', 'history', 'certificate', 'condition', 'information', 'data', 'detail', 'underwriting', 'answer', 'member', 'dependant', 'dependent', 'file', 'report', 'store', 'capture', 'share', 'claim'] },
        { terms: ['disability', 'disabilities', 'disabled'], with: ['employee', 'staff', 'learner', 'student', 'record', 'accommodation', 'status', 'declare', 'grant', 'customer', 'applicant', 'member', 'field', 'data', 'detail'] },
        { terms: ['health check', 'health screening', 'wellness check', 'medical check'], with: ['employee', 'staff', 'patient', 'member', 'learner', 'worker', 'applicant'] },
      ],
      exclude: ['diagnosis log', 'diagnosis logs', 'race to', 'gender neutral wording', 'device fingerprint', 'browser fingerprint', 'fingerprint of the file', 'file fingerprint', 'disability accessibility', 'accessibility', 'test results page', 'unit test result', 'test result dashboard'],
      labels: ['special-pi'],
    },
    requirements: [
      {
        id: 'basis',
        label: 'Section 27 authorisation relied on',
        type: 'choice',
        stage: 'build',
        clause: 's27',
        options: [
          'Consent of the data subject',
          'Establishment, exercise or defence of a right or obligation in law',
          'Obligation of international public law',
          'Historical, statistical or research purposes',
          'Information deliberately made public by the data subject',
          'Authorisation from the Information Regulator',
          'A specific authorisation in sections 28 to 33 (for example s32 health, s33 criminal behaviour)',
        ],
      },
      approval('Special personal information always needs approver sign-off.'),
      { id: 'safeguards', label: 'Security review or DPIA (link)', type: 'link', stage: 'done', clause: 's19', help: 'Link to the Confluence page with the security review.' },
    ],
    examples: {
      match: [
        'Store patients medical records', 'Store learner allergy and medical notes', 'Add Face ID login', 'Record staff trade union membership for payroll',
        "Allow GP receptionists to see patient's chronic medication list", 'Remind patients of HIV clinic appointments via WhatsApp',
        "Attach claimant's hospital discharge summary to the claim file",
      ],
      ignore: [
        'Political party colours on the map legend', 'Add /health check endpoint', 'Fix race condition in the queue', 'Add dark mode to the clinic booking widget',
        'Update medical aid product page copy', 'Disability accessibility audit (WCAG)', 'Log device fingerprints for fraud scoring',
      ],
    },
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
      // Avoids bare "child" and "minor": in Jira they usually mean child issues or minor versions.
      keywords: ['pupil', 'under 18', 'under 13', "children's data", 'child data', 'parental consent', 'parent consent', 'school learner', "minor's data"],
      contextual: [
        { terms: ['child', 'children', 'minor'], with: ['age', 'parent', 'school', 'profile', 'data', 'account', 'photo', 'consent'] },
        { terms: ['guardian'], with: ['parent', 'child', 'consent', 'learner', 'minor', 'school', 'kid'] },
        { terms: ['learner'], with: ['school', 'age', 'aged', 'parent', 'grade', 'registration', 'teacher', 'class', 'progress', 'allergy', 'medical', 'photo', 'disability', 'trip'] },
        { terms: ['kid'], with: ['profile', 'account', 'data', 'photo', 'app', 'age', 'parent', 'register'] },
      ],
      labels: ['children'],
    },
    requirements: [
      { id: 'consent-mechanism', label: 'How a parent or guardian gives consent', type: 'answer', stage: 'build', clause: 's35(1)(a)' },
      { id: 'age-check', label: 'How age is determined', type: 'answer', stage: 'build', clause: 's34' },
      approval(),
    ],
    examples: {
      match: ['Store learner allergy and medical notes for school trip bookings', 'Let parents create accounts for their children', 'Kids profile with photo'],
      ignore: ['Create child issues for the epic', 'Minor version bump of the SDK', 'Fix the parent-child page hierarchy'],
    },
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
      keywords: ['pre tick', 'pre ticked', 'consent box', 'opt in box', 'third party offer', 'marketing consent', 'marketing email', 'marketing sms', 'marketing message', 'newsletter', 'bulk sms', 'sms blast', 'whatsapp broadcast', 'mailing list', 'drip campaign', 'cold email', 'direct marketing', 'upsell email', 'email blast'],
      contextual: [
        { terms: ['promo', 'promotional', 'campaign', 'offer'], with: ['sms', 'email', 'whatsapp', 'send', 'blast', 'broadcast', 'message', 'push notification', 'customers', 'subscriber'] },
        { terms: ['whatsapp', 'sms', 'email'], with: ['marketing', 'promo', 'promotional', 'campaign', 'opted in', 'opt in', 'broadcast', 'newsletter', 'win back', 'specials'] },
      ],
      exclude: ['offer letter'],
      labels: ['marketing'],
    },
    requirements: [
      { id: 'basis', label: 'Basis for contacting recipients', type: 'choice', stage: 'build', clause: 's69(1)', options: ['Recipient gave prior consent', 'Existing customer, similar products, opt-out offered at collection'] },
      { id: 'opt-out', label: 'How each message offers an opt-out', type: 'answer', stage: 'build', clause: 's69(4)', help: 'E.g. "Reply STOP" or an unsubscribe link in every message.' },
      approval(),
    ],
    examples: {
      match: ['Send festive season promo SMS to everyone on the mailing list', 'Weekly newsletter signup flow', 'Promotional email to all customers'],
      ignore: ['Promo code bug on checkout page', 'Fix the campaign dashboard filter', 'Rename the offer letter template', 'Email the offer letter to candidates', 'Email receipt after sale'],
    },
  },
  {
    id: 'popia-cross-border',
    title: 'Transfer outside South Africa',
    clause: 'POPIA s72',
    policyRef: 'Privacy Policy 8 – Vendors and hosting',
    severity: 'high',
    summary: 'This work may send personal information to a recipient outside South Africa. Record the destination and which section 72 ground your organisation relies on.',
    triggers: {
      keywords: ['transfer abroad', 'outside south africa', 'international vendor', 'us based', 'us hosted', 'eu hosted', 'uk hosted', 'hosted in the us', 'hosted overseas', 'hosted abroad', 'sync to hubspot', 'sync to salesforce', 'sync to mailchimp', 'offshore vendor', 'offshore team'],
      contextual: [
        { terms: ['offshore', 'overseas', 'us region', 'eu region', 'us east', 'eu west', 'eu central', 'af south'], with: ['customer', 'user', 'personal', 'data', 'record', 'backup', 'database', 'hr', 'patient', 'employee', 'member', 'learner', 'pii'] },
        { terms: ['workday', 'successfactors', 'bamboohr', 'freshdesk'], with: ['migrate', 'move', 'sync', 'export', 'eu', 'europe', 'us', 'record'] },
        { terms: ['hubspot', 'salesforce', 'mailchimp', 'zendesk', 'intercom', 'google analytics', 'mixpanel'],
          with: ['sync', 'import', 'export', 'push', 'send', 'integrate', 'integration', 'lead', 'contact', 'customer', 'user', 'migrate', 'move', 'backup'] },
        { terms: ['vendor', 'third party', 'crm'], with: ['usa', 'united states', 'europe', 'uk', 'india', 'abroad', 'international', 'foreign', 'cloud region', 'us based', 'us hosted'] },
        { terms: [
          'ireland', 'germany', 'netherlands', 'france', 'united kingdom', 'in the uk', 'to the uk', 'uk based', 'uk hosted', 'uk south', 'uk west',
          'usa', 'united states', 'in the us', 'to the us', 'us hosted', 'india', 'singapore', 'australia', 'canada', 'brazil', 'japan', 'nigeria', 'kenya',
          'mauritius', 'europe', 'west europe', 'north europe', 'east us', 'west us', 'europe west', 'eu north', 'ap south', 'ap southeast', 'abroad', 'overseas',
          'foreign', 'another country', 'hosted outside'],
        // Only data words, not "users in India": the trigger is personal information going to a recipient there.
        with: ['personal', 'data', 'record', 'backup', 'database', 'db', 'claim', 'hr', 'pii', 'vendor', 'crm', 'replicate', 'outsource', 'call centre', 'support team', 'recruiter', 'file'] },
        { terms: ['twilio', 'sendgrid', 'mailgun', 'clevertap', 'braze', 'segment'], with: ['whatsapp', 'sms', 'customer', 'phone', 'message', 'email', 'user', 'notification', 'contact'] },
        { terms: ['meta ads', 'facebook ads', 'google ads', 'tiktok ads', 'lookalike audience', 'custom audience', 'meta business'],
          with: ['customer', 'purchase', 'email', 'phone', 'list', 'upload', 'sync', 'audience', 'history'] },
      ],
      exclude: ['salesforce style', 'hubspot style'],
      labels: ['cross-border'],
    },
    requirements: [
      { id: 'destination', label: 'Destination country and recipient', type: 'answer', stage: 'build', clause: 's72', minWords: 2 },
      {
        id: 'ground',
        label: 'Section 72 ground relied on',
        type: 'choice',
        stage: 'build',
        clause: 's72(1)',
        options: [
          'Recipient bound by law, rules or agreement giving adequate protection',
          'Data subject consented to the transfer',
          'Necessary to perform a contract with the data subject',
          'Necessary for a contract in the data subject\'s interest between the organisation and a third party',
          'For the benefit of the data subject and consent not reasonably obtainable',
        ],
      },
      approval(),
      { id: 'agreement', label: 'Data processing agreement (link)', type: 'link', stage: 'done', clause: 's72(1)(a)' },
    ],
    examples: {
      match: [
        'Sync customer list to our US-based CRM vendor', 'Move backups to the eu-west region', 'Send applicant files to our recruiter in the UK via a third party',
        'Migrate customer database to vendor hosted in Ireland', 'Build lookalike audience from customer purchase history for Meta ads',
      ],
      ignore: ['Update the US English spelling in the UI', 'Change the vendor invoice template', 'Translate the settings page into Afrikaans'],
    },
  },
  {
    id: 'popia-bulk-export',
    title: 'Bulk export or sharing',
    clause: 'POPIA s14, s19',
    policyRef: 'Privacy Policy 9 – Security safeguards',
    severity: 'medium',
    summary: 'This work may create an export, dump or shared copy of personal information. Record the safeguards for the copy and when it is deleted.',
    triggers: {
      keywords: ['csv dump', 'dump of all', 'csv export', 'data export', 'export customer', 'export user', 'export parent', 'export patient', 'export employee', 'export staff', 'data dump', 'database dump', 'share with vendor', 'spreadsheet of customer', 'download all user', 'export all user', 'publish list of'],
      contextual: [
        { terms: ['customer list', 'user list', 'member list', 'client list', 'contact detail', 'mailing list'],
          with: ['export', 'csv', 'download', 'dump', 'share', 'send', 'sync', 'push', 'copy', 'extract', 'spreadsheet', 'vendor', 'agency', 'publish'] },
      ],
      labels: ['export'],
    },
    requirements: [
      { id: 'safeguards', label: 'Safeguards for the copy (access, encryption)', type: 'answer', stage: 'build', clause: 's19' },
      { id: 'deletion', label: 'When and how the copy is deleted', type: 'answer', stage: 'build', clause: 's14', ...ENDS },
      approval(),
    ],
    examples: {
      match: ['CSV export of customers for the finance team', 'Nightly database dump to the analytics bucket', 'Export parent contact details for the bus route planner'],
      ignore: ['Export the dashboard chart as PNG', 'Fix the dump truck icon', 'Fix customer list pagination'],
    },
  },
];

/** Demo work items created by the "Load demo" button. */
export const DEMO_ISSUES = [
  {
    summary: 'Add SA ID number field to customer signup',
    description:
      'Compliance asked us to capture the customer SA ID number during signup so support can verify callers. Add a required field to the signup form and save it with the new account.',
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
