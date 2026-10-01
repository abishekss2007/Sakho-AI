// Opt-in integration check against the real providers. Never run by CI or tests.
//
//   GEMINI_API_KEY=... npm run check:providers
//   TTS_ENABLED=true npm run check:providers     (needs Application Default Credentials)
//
// It makes one small Gemini request and one Cloud Text-to-Speech voice listing
// (the listing is free), then prints which of the 13 configured languages the
// speech provider currently has a voice for.
import { GoogleGenAI } from '@google/genai';
import { GoogleAuth } from 'google-auth-library';

const LANGUAGES = ['hi', 'bn', 'mr', 'te', 'ta', 'gu', 'ur', 'kn', 'or', 'ml', 'pa', 'as', 'en'];
let failed = false;

const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
if (!apiKey) {
  console.log('Gemini: skipped (GEMINI_API_KEY is not set)');
} else {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents: 'Reply with the single word: ok',
      config: { maxOutputTokens: 20, httpOptions: { timeout: 20_000 } },
    });
    console.log(`Gemini: model "${model}" answered (${(response.text ?? '').trim().slice(0, 20) || 'empty reply'})`);
  } catch (error) {
    failed = true;
    console.error(`Gemini: model "${model}" failed: ${error?.status ?? ''} ${error?.message ?? error}`);
  }
}

if (process.env.TTS_ENABLED !== 'true') {
  console.log('Cloud Text-to-Speech: skipped (TTS_ENABLED is not "true")');
} else {
  try {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const token = await auth.getAccessToken();
    const response = await fetch('https://texttospeech.googleapis.com/v1/voices', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { voices = [] } = await response.json();
    for (const code of LANGUAGES) {
      const tag = `${code}-IN`;
      const count = voices.filter((voice) => (voice.languageCodes ?? []).includes(tag)).length;
      console.log(`Cloud Text-to-Speech: ${tag} ${count > 0 ? `${count} voice(s)` : 'NO VOICE (the app falls back to a device voice, or shows text only)'}`);
    }
  } catch (error) {
    failed = true;
    console.error(`Cloud Text-to-Speech: failed: ${error?.message ?? error}`);
  }
}

process.exit(failed ? 1 : 0);
