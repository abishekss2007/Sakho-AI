import type { Question, RuleProvenance, SourceRef } from './types';

/**
 * PMMVY (Pradhan Mantri Matru Vandana Yojana) draft guidance rules.
 *
 * Everything here was transcribed from the official sources listed below on
 * the stated retrieval date. It has NOT been reviewed by the Ministry or a
 * domain expert, so the status is `draft` and the engine only ever returns
 * preliminary guidance. Do not add conditions that are not in a cited source.
 */

export const SOURCES = {
  pmmvy_faq: {
    id: 'pmmvy_faq',
    title: 'PMMVY Frequently Asked Questions (FAQs)',
    publisher: 'Ministry of Women and Child Development (SPNIWCD)',
    url: 'https://www.spniwcd.wcd.gov.in/uploads/pdf/1710098119_HDEXdpWMb1.pdf',
    retrievedOn: '2026-10-01',
  },
  pmmvy_portal: {
    id: 'pmmvy_portal',
    title: 'PMMVY official portal',
    publisher: 'Ministry of Women and Child Development',
    url: 'https://pmmvy.wcd.gov.in/',
    retrievedOn: '2026-10-01',
  },
  wcd_pmmvy: {
    id: 'wcd_pmmvy',
    title: 'Pradhan Mantri Matru Vandana Yojna',
    publisher: 'Ministry of Women and Child Development',
    url: 'https://wcd.gov.in/women/pradhan-mantri-matru-vandana-yojna',
    retrievedOn: '2026-10-01',
  },
  pib_pmmvy_2025: {
    id: 'pib_pmmvy_2025',
    title: 'Pradhan Mantri Matru Vandana Yojana: Empowering mothers, shaping generations (24 August 2025)',
    publisher: 'Press Information Bureau',
    url: 'https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/aug/doc2025825619601.pdf',
    retrievedOn: '2026-10-01',
  },
} as const satisfies Record<string, SourceRef>;

export const PMMVY_PROVENANCE: RuleProvenance = {
  schemeId: 'pmmvy',
  ruleVersion: 'pmmvy-draft-2026-10-01',
  rulesStatus: 'draft',
  reviewStatus: 'not_officially_reviewed',
  lastVerified: null,
  geographicScope:
    'India. The FAQ states the scheme was not being implemented in Telangana and Odisha, which run their own maternity benefit schemes.',
  sources: [SOURCES.pmmvy_faq, SOURCES.pmmvy_portal, SOURCES.wcd_pmmvy, SOURCES.pib_pmmvy_2025],
};

/** Toll-free PMMVY helpline, as stated in the PIB document. Not an emergency number. */
export const PMMVY_HELPLINE = '14408';
export const PMMVY_PORTAL_URL = SOURCES.pmmvy_portal.url;

/**
 * Ordered questions. `askIf` hides a question once an earlier answer already
 * shows the published conditions are not met, or when it cannot apply.
 */
export const PMMVY_QUESTIONS: readonly Question[] = [
  { id: 'pregnant_or_recent_birth', options: ['yes', 'no', 'unsure'] },
  {
    id: 'child_order',
    options: ['first', 'second', 'third_or_later', 'unsure'],
    askIf: (a) => a.pregnant_or_recent_birth !== 'no',
  },
  {
    id: 'second_child_girl',
    options: ['yes', 'no', 'unsure'],
    askIf: (a) => a.pregnant_or_recent_birth !== 'no' && a.child_order === 'second',
  },
  {
    id: 'has_category_proof',
    options: ['yes', 'no', 'unsure'],
    askIf: (a) =>
      a.pregnant_or_recent_birth !== 'no' &&
      a.child_order !== 'third_or_later' &&
      !(a.child_order === 'second' && a.second_child_girl === 'no'),
  },
];

/** Eligibility categories listed in the FAQ ("any of the following"). */
export const PMMVY_CATEGORIES = [
  'sc_st',
  'disability',
  'bpl_ration',
  'pmjay',
  'eshram',
  'pm_kisan',
  'mgnrega',
  'income_below_8_lakh',
  'aww_awh_asha',
  'nfsa_ration',
] as const;
export type PmmvyCategory = (typeof PMMVY_CATEGORIES)[number];

/** Documents the FAQ says beneficiaries need. */
export const PMMVY_DOCUMENTS = [
  'aadhaar',
  'bank_account',
  'mobile',
  'mcp_card',
  'eligibility_proof',
  'birth_certificate',
  'immunisation_record',
] as const;
export type DocumentId = (typeof PMMVY_DOCUMENTS)[number];
export type DocumentStatus = 'have' | 'need_help' | 'unknown';

/**
 * Facts given to the chat model as evidence. Each line is tied to a source id
 * so replies can cite only what was actually read.
 */
export const PMMVY_EVIDENCE: readonly { sourceId: keyof typeof SOURCES; text: string }[] = [
  {
    sourceId: 'pmmvy_faq',
    text: 'PMMVY is a maternity benefit scheme of the Ministry of Women and Child Development, launched 1 January 2017. From 1 April 2022 the benefit is also given for a second child if the second child is a girl.',
  },
  {
    sourceId: 'pmmvy_faq',
    text: 'Any one of these is required: SC or ST; partially (40%) or fully disabled; BPL ration card; PMJAY (Ayushman Bharat) beneficiary; e-Shram card; woman farmer beneficiary of Kisan Samman Nidhi; MGNREGA job card; net family income below Rs 8 lakh per year; pregnant or lactating Anganwadi worker, helper or ASHA; ration card under NFSA 2013.',
  },
  {
    sourceId: 'pmmvy_faq',
    text: 'First child: Rs 5,000 in two instalments. Rs 3,000 after pregnancy registration and at least two ante-natal check-ups; Rs 2,000 after the birth is registered and the child completes the first cycle of immunisation (14 weeks). Second child, if a girl: Rs 6,000 in one instalment after birth and immunisation.',
  },
  {
    sourceId: 'pmmvy_faq',
    text: 'The beneficiary should be between 18 years 7 months and 55 years old at the time of child birth. She can register up to 270 days after child birth. After a miscarriage or still birth she is treated as a fresh beneficiary in a future pregnancy.',
  },
  {
    sourceId: 'pmmvy_faq',
    text: 'Documents: Aadhaar card, Aadhaar-mapped bank or post office account, mobile number, eligibility proof, MCP/RCHI card, LMP date, ANC date, child birth certificate, child immunisation details. The husband’s Aadhaar is not required.',
  },
  {
    sourceId: 'pmmvy_faq',
    text: 'To apply, the nearest Anganwadi worker or ASHA can fill the form online, or the woman can apply herself on https://pmmvy.wcd.gov.in. The FAQ states the scheme was not being implemented in Telangana and Odisha, which have their own schemes.',
  },
  {
    sourceId: 'pib_pmmvy_2025',
    text: 'A toll-free multilingual PMMVY helpline is available at 14408. Enrolment is also possible through the UMANG platform.',
  },
];
