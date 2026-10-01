/**
 * Emergency services shown on the help screen.
 *
 * Only numbers confirmed on an official page on the retrieval date are
 * listed. Ambulance numbers 102/108 could not be confirmed from an official
 * page for this build and are deliberately absent; 112 covers ambulance.
 */

export interface EmergencyService {
  id: 'erss_112' | 'women_181' | 'child_1098';
  number: string;
  sourceUrl: string;
  retrievedOn: string;
}

export const EMERGENCY_SERVICES: readonly EmergencyService[] = [
  {
    id: 'erss_112',
    number: '112',
    sourceUrl: 'https://www.ncw.gov.in/other-useful-helplines/',
    retrievedOn: '2026-10-01',
  },
  {
    // wcd.gov.in: "operational in all States/UTs except West Bengal".
    id: 'women_181',
    number: '181',
    sourceUrl: 'https://wcd.gov.in/women/help',
    retrievedOn: '2026-10-01',
  },
  {
    id: 'child_1098',
    number: '1098',
    sourceUrl: 'https://www.ncw.gov.in/other-useful-helplines/',
    retrievedOn: '2026-10-01',
  },
];

export type EmergencyServiceId = EmergencyService['id'];

export const EMERGENCY_SERVICE_IDS = EMERGENCY_SERVICES.map((s) => s.id) as [
  EmergencyServiceId,
  ...EmergencyServiceId[],
];

export type SosMode = 'demo' | 'live';

/**
 * Deployment contract: only the exact value `live` enables real dialer links.
 * Anything else, including unset or a typo, is demo mode. Read on the server
 * at request time, so it is never inlined into the client bundle.
 */
export function resolveSosMode(value: string | undefined): SosMode {
  return value === 'live' ? 'live' : 'demo';
}

/**
 * Phrases that suggest the user may need urgent help. This is a small
 * assistive keyword list, not emergency or medical detection: it will miss
 * real emergencies and may trigger on harmless text.
 */
const URGENT_PATTERNS: readonly RegExp[] = [
  /\b(emergency|help me|save me|bleeding|unconscious|can'?t breathe|cannot breathe|suicide|kill myself|being beaten|he (hit|beat)s? me|rape[d]?)\b/i,
  /(बचाओ|मदद करो|खून बह|बेहोश|सांस नहीं|साँस नहीं|आत्महत्या|मार रहा|मारता है|इमरजेंसी|आपातकाल)/,
  /(காப்பாற்று|உதவி செய்|ரத்தம் வரு|இரத்தம் வரு|ரத்தப்போக்கு|மயக்கம்|மூச்சு விட முடிய|தற்கொலை|அடிக்கிறார்|அடிக்கிறான்|அவசரம்)/,
];

export function looksUrgent(text: string): boolean {
  return URGENT_PATTERNS.some((p) => p.test(text));
}
