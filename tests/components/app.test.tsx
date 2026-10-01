import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '@/components/App';
import { SafeText } from '@/components/ui/SafeText';
import { ApiClientError, type Api } from '@/lib/client/api';
import type { SosMode } from '@/lib/emergency';
import { PREFS_KEY } from '@/lib/storage';
import { deferred, flush, makeApi, makeSpeech } from '../helpers';

type UnderstandResult = Awaited<ReturnType<Api['understand']>>;

function setup(options: { language?: string | null; introSeen?: boolean; sosMode?: SosMode; api?: ReturnType<typeof makeApi> } = {}) {
  const { language = 'en', introSeen = true, sosMode = 'demo' } = options;
  if (language) {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ language, speed: 'normal', autoRead: false, introSeen }));
  }
  const api = options.api ?? makeApi();
  const speech = makeSpeech();
  const user = userEvent.setup();
  render(<App sosMode={sosMode} providers="mock" api={api} speech={speech.controller} />);
  return { api, speech, user };
}

const button = (name: string | RegExp) => screen.getByRole('button', { name });

async function openBenefits(user: ReturnType<typeof userEvent.setup>) {
  await user.click(button(/Check benefits/));
  await user.click(button('Continue'));
  await screen.findByText('Question 1 of 3');
}

describe('onboarding', () => {
  it('shows all 13 languages in their own script with honest support labels', () => {
    setup({ language: null });
    expect(screen.getByRole('heading', { name: 'Choose your language' })).toBeInTheDocument();
    for (const name of ['हिन्दी', 'বাংলা', 'मराठी', 'తెలుగు', 'தமிழ்', 'ગુજરાતી', 'اردو', 'ಕನ್ನಡ', 'ଓଡ଼ିଆ', 'മലയാളം', 'ਪੰਜਾਬੀ', 'অসমীয়া', 'English']) {
      expect(screen.getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Preview')).toHaveLength(10);
    expect(screen.getAllByText('Needs review')).toHaveLength(2);
    expect(screen.getAllByText('Full')).toHaveLength(1);
    // No main menu until a language is chosen, but emergency help is already there.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(button('Get help')).toBeInTheDocument();
  });

  it('switches the screen to Tamil, plays the greeting, saves the choice and opens the introduction', async () => {
    const { user, speech } = setup({ language: null });
    await user.click(button(/தமிழ்/));
    expect(screen.getByRole('heading', { name: 'உங்கள் மொழியைத் தேர்ந்தெடுங்கள்' })).toBeInTheDocument();
    await user.click(button(/வணக்கத்தைக் கேள்/));
    expect(speech.ttsRequests[0]).toMatchObject({ text: 'வணக்கம்', locale: 'ta' });
    await user.click(button('தொடர்'));

    expect(document.documentElement.lang).toBe('ta');
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}').language).toBe('ta');
    const dialog = screen.getByRole('dialog', { name: 'Sakho AI எப்படி வேலை செய்கிறது' });
    expect(within(dialog).getByText('படி 1 / 3')).toBeInTheDocument();
  });

  it('a preview language keeps English screens, lang and direction, and says so', async () => {
    const { user } = setup({ language: null });
    await user.click(button(/اردو/));
    expect(screen.getByText(/Preview\. Screens stay in English\./)).toBeInTheDocument();
    expect(screen.getByText(/This language is a preview/)).toBeInTheDocument();
    await user.click(button('Continue'));
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}').language).toBe('ur');
  });

  it('walks the introduction forwards and backwards and remembers it was seen', async () => {
    const { user } = setup({ introSeen: false, language: null });
    await user.click(button('Continue'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Back' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByText('Step 1 of 3')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}').introSeen).toBe(true);
  });
});

describe('emergency help', () => {
  it('is reachable from inside the introduction, and closing it returns to the introduction', async () => {
    const { user } = setup({ language: null });
    await user.click(button('Continue'));
    const intro = screen.getByRole('dialog', { name: 'How Sakho AI works' });
    await user.click(within(intro).getByRole('button', { name: 'Get help' }));

    const sos = screen.getByRole('dialog', { name: 'Emergency help' });
    expect(sos).toBeInTheDocument();
    expect(sos.parentElement).toHaveClass('z-50');
    expect(intro.parentElement).toHaveAttribute('inert');

    await user.click(within(sos).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Emergency help' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'How Sakho AI works' })).toBeInTheDocument();
  });

  it('demo mode has no dialer links anywhere and says no call was made', async () => {
    const { user } = setup({ sosMode: 'demo' });
    await user.click(button('Get help'));
    const sos = screen.getByRole('dialog', { name: 'Emergency help' });
    expect(within(sos).getByText('Demo mode: these buttons do not call anyone.')).toBeInTheDocument();
    expect(document.querySelectorAll('a[href^="tel:"]')).toHaveLength(0);
    expect(document.body.innerHTML).not.toContain('tel:');
    await user.click(within(sos).getByRole('button', { name: 'Practice: 112' }));
    expect(within(sos).getByText(/No call was made/)).toBeInTheDocument();
  });

  it('live mode shows real dialer links for the verified numbers and no demo banner', async () => {
    const { user } = setup({ sosMode: 'live' });
    await user.click(button('Get help'));
    const links = [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['tel:112', 'tel:181', 'tel:1098']);
    expect(screen.queryByText(/Demo mode/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 112' })).toBeInTheDocument();
  });

  it('asks for location only when the user presses the button, and shows it without sending it', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) =>
      success({ coords: { latitude: 13.0826802, longitude: 80.2707184 } } as GeolocationPosition),
    );
    vi.stubGlobal('navigator', { ...navigator, onLine: true, geolocation: { getCurrentPosition } });
    const { user, api } = setup();
    await user.click(button('Get help'));
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await user.click(button('Show my location'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText('13.08268, 80.27072')).toBeInTheDocument();
    expect(api.chat).not.toHaveBeenCalled();
    expect(api.understand).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('a denied location does not block calling', async () => {
    const getCurrentPosition = vi.fn((_: PositionCallback, failure: PositionErrorCallback) =>
      failure({ code: 1, PERMISSION_DENIED: 1 } as GeolocationPositionError),
    );
    vi.stubGlobal('navigator', { ...navigator, onLine: true, geolocation: { getCurrentPosition } });
    const { user } = setup();
    await user.click(button('Get help'));
    await user.click(button('Show my location'));
    expect(screen.getByText('Location was not allowed. You can still call.')).toBeInTheDocument();
    expect(button('Practice: 112')).toBeEnabled();
    vi.unstubAllGlobals();
  });

  it('opening help stops the microphone and aborts the request in flight', async () => {
    const pendingChat = deferred<Awaited<ReturnType<Api['chat']>>>();
    let chatSignal: AbortSignal | undefined;
    const api = makeApi({
      chat: vi.fn((_, signal) => {
        chatSignal = signal;
        signal?.addEventListener('abort', () => pendingChat.reject(new ApiClientError('aborted')));
        return pendingChat.promise;
      }),
    });
    const { user, speech } = setup({ api });
    await user.click(button(/Ask Sakho AI/));
    await user.type(screen.getByLabelText('Your question'), 'hello');
    await user.click(button('Send'));
    expect(screen.getByText('Sakho AI is thinking…')).toBeInTheDocument();

    await user.click(button('Get help'));
    expect(chatSignal?.aborted).toBe(true);
    expect(speech.controller.getStatus()).toBe('idle');
    expect(screen.getByRole('dialog', { name: 'Emergency help' })).toBeInTheDocument();
    await user.click(button('Close'));
    // The question is kept and can be retried; no error is shown for a deliberate interruption.
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(button('Try again')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opening help while listening aborts recognition', async () => {
    const { user, speech } = setup();
    await user.click(button(/Ask Sakho AI/));
    await user.click(button('Speak'));
    expect(speech.controller.getStatus()).toBe('listening');
    expect(screen.getByText(/your phone will ask to use the microphone/)).toBeInTheDocument();
    await user.click(button('Get help'));
    expect(speech.recognitions[0]?.aborted).toBe(true);
    expect(speech.controller.getStatus()).toBe('idle');
  });
});

describe('guided benefits', () => {
  it('is driven by the backend one question at a time and ends in preliminary guidance', async () => {
    const { user, api } = setup();
    await openBenefits(user);
    expect(api.schemeCheck).toHaveBeenLastCalledWith({ schemeId: 'pmmvy', answers: {} }, expect.any(AbortSignal));

    await user.click(button('Yes'));
    await screen.findByRole('heading', { name: 'Which child is this?' });
    expect(api.schemeCheck).toHaveBeenLastCalledWith(
      { schemeId: 'pmmvy', answers: { pregnant_or_recent_birth: 'yes' } },
      expect.any(AbortSignal),
    );
    await user.click(button('Second child'));
    await screen.findByRole('heading', { name: 'Is your second child a girl?' });
    expect(screen.getByText('Question 3 of 4')).toBeInTheDocument();
    await user.click(button('Yes'));
    await screen.findByRole('heading', { name: 'Do you have any one of these?' });
    expect(screen.getByText('MGNREGA job card')).toBeInTheDocument();
    await user.click(button('Yes'));

    await screen.findByRole('heading', { name: 'Early guidance' });
    expect(screen.getByText('Your answers match the published conditions we checked.')).toBeInTheDocument();
    expect(screen.getByText('This is not an approval or a rejection. Only the scheme office can decide.')).toBeInTheDocument();
    expect(screen.getByText('Not verified by an official')).toBeInTheDocument();
    expect(screen.getByText('Rule version: pmmvy-draft-2026-10-01')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/you are eligible/i);
    expect(screen.getByRole('link', { name: /PMMVY Frequently Asked Questions/ })).toHaveAttribute(
      'href',
      expect.stringContaining('wcd.gov.in'),
    );
  });

  it('explains an early "may not apply" and still offers document preparation', async () => {
    const { user } = setup();
    await openBenefits(user);
    await user.click(button('No'));
    await screen.findByText('From your answers, this benefit may not apply right now.');
    expect(screen.getByText(/pregnant women and mothers who register within 270 days/)).toBeInTheDocument();
    expect(button('See papers to prepare')).toBeInTheDocument();
  });

  it('ignores rapid repeated taps while a check is pending', async () => {
    const gate = deferred<Awaited<ReturnType<Api['schemeCheck']>>>();
    const base = makeApi();
    let calls = 0;
    const api = makeApi({
      schemeCheck: vi.fn((body, signal) => {
        calls += 1;
        return calls === 2 ? gate.promise : base.schemeCheck(body, signal);
      }),
    });
    const { user } = setup({ api });
    await openBenefits(user);
    const yes = button('Yes');
    await user.click(yes);
    expect(yes).toBeDisabled();
    await user.click(yes);
    await user.click(button('No'));
    expect(calls).toBe(2);
    expect(screen.getByText('Checking…')).toBeInTheDocument();
    // Emergency help stays available while the answer is being checked.
    expect(button('Get help')).toBeEnabled();
  });

  it('falls back to the bundled engine when the server is unreachable and says so', async () => {
    const api = makeApi({ schemeCheck: vi.fn().mockRejectedValue(new ApiClientError('network')) });
    const { user } = setup({ api });
    await openBenefits(user);
    expect(screen.getByText(/using guidance saved in this app \(version pmmvy-draft-2026-10-01\)/)).toBeInTheDocument();
    await user.click(button('No'));
    await screen.findByRole('heading', { name: 'Early guidance' });
    expect(screen.getByText('Not verified by an official')).toBeInTheDocument();
  });

  it('applies a typed answer through /api/understand', async () => {
    const api = makeApi();
    api.understand.mockImplementation(async (body: Parameters<Api['understand']>[0]) => ({
      ok: true,
      requestId: 't',
      questionId: body.questionId,
      sessionId: body.sessionId,
      interpretation: { kind: 'answer', value: 'yes' },
      via: 'keywords',
    }));
    const { user } = setup({ api });
    await openBenefits(user);
    await user.type(screen.getByLabelText('Or type your answer'), 'haan{Enter}');
    await screen.findByRole('heading', { name: 'Which child is this?' });
    expect(api.understand.mock.calls[0]?.[0]).toMatchObject({
      questionId: 'pregnant_or_recent_birth',
      utterance: 'haan',
      locale: 'en',
    });
  });

  it('discards a voice interpretation that arrives after the question has changed', async () => {
    const slow = deferred<UnderstandResult>();
    const api = makeApi();
    api.understand.mockImplementation(() => slow.promise);
    const { user, speech } = setup({ api });
    await openBenefits(user);

    await user.click(button('Speak'));
    act(() => speech.recognitions[0]?.say('no'));
    await screen.findByText('Understanding…');
    const sent = api.understand.mock.calls[0]?.[0];

    // The user taps a button while the voice reply is still being interpreted.
    await user.click(button('Yes'));
    await screen.findByRole('heading', { name: 'Which child is this?' });

    // The late reply says "no" for question 1. It must not be applied to question 2 or rewind the flow.
    await act(async () => {
      slow.resolve({
        ok: true,
        requestId: 't',
        questionId: sent.questionId,
        sessionId: sent.sessionId,
        interpretation: { kind: 'answer', value: 'no' },
        via: 'model',
      });
      await flush();
    });
    expect(screen.getByRole('heading', { name: 'Which child is this?' })).toBeInTheDocument();
    expect(api.schemeCheck).toHaveBeenLastCalledWith(
      { schemeId: 'pmmvy', answers: { pregnant_or_recent_birth: 'yes' } },
      expect.any(AbortSignal),
    );
    expect(screen.queryByText('Understanding…')).not.toBeInTheDocument();
  });

  it('shows an emergency suggestion as a choice and never opens help by itself', async () => {
    const api = makeApi();
    api.understand.mockImplementation(async (body: Parameters<Api['understand']>[0]) => ({
      ok: true,
      requestId: 't',
      questionId: body.questionId,
      sessionId: body.sessionId,
      interpretation: { kind: 'emergency_suggestion', serviceId: 'erss_112' },
      via: 'keywords',
    }));
    const { user } = setup({ api });
    await openBenefits(user);
    await user.type(screen.getByLabelText('Or type your answer'), 'help me{Enter}');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('It sounds like you may need urgent help.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Get help' }));
    expect(screen.getByRole('dialog', { name: 'Emergency help' })).toBeInTheDocument();
  });

  it('keeps the question and offers buttons when voice is unsupported, denied or unclear', async () => {
    const { user, speech } = setup();
    await openBenefits(user);

    await user.type(screen.getByLabelText('Or type your answer'), 'bananas{Enter}');
    await screen.findByText('I did not understand. Please press one of the buttons.');

    await user.click(button('Speak'));
    act(() => speech.recognitions[0]?.fail('not-allowed'));
    expect(screen.getByText(/The microphone is turned off for this site/)).toBeInTheDocument();

    speech.options.recognition = false;
    await user.click(button('Speak'));
    expect(screen.getByText(/Voice input does not work in this browser/)).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Are you pregnant now, or did you give birth in the last 9 months?' })).toBeInTheDocument();
    expect(button('Yes')).toBeEnabled();
  });

  it('reads the question aloud and reports honestly when no voice exists', async () => {
    const { user, speech } = setup();
    speech.options.tts = 'fail';
    speech.options.voices = [{ lang: 'hi-IN' }];
    await openBenefits(user);
    await user.click(button('Listen again'));
    await screen.findByText('Sound is not available for this language right now. The text is shown on the screen.');
    expect(speech.ttsRequests[0]?.text).toContain('Are you pregnant now');
  });

  it('goes back one question and keeps earlier answers', async () => {
    const { user, api } = setup();
    await openBenefits(user);
    await user.click(button('Yes'));
    await screen.findByRole('heading', { name: 'Which child is this?' });
    await user.click(button('Back'));
    await screen.findByText('Question 1 of 3');
    expect(api.schemeCheck).toHaveBeenLastCalledWith({ schemeId: 'pmmvy', answers: {} }, expect.any(AbortSignal));
  });

  it('marks documents, builds a summary, and keeps answers out of the QR code until consent', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('dismissed'), { name: 'AbortError' }));
    vi.stubGlobal('navigator', { ...navigator, onLine: true, share });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { user } = setup();
    await openBenefits(user);
    await user.click(button('Yes'));
    await user.click(await screen.findByRole('button', { name: 'First child' }));
    await user.click(await screen.findByRole('button', { name: 'Not sure' }));
    await screen.findByText('We cannot tell from these answers.');
    await user.click(button('See papers to prepare'));

    const aadhaar = screen.getByRole('group', { name: 'Aadhaar card' });
    const have = within(aadhaar).getByRole('button', { name: 'Have it' });
    expect(have).toHaveAttribute('aria-pressed', 'false');
    await user.click(have);
    expect(have).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(screen.getByRole('group', { name: 'Mobile number' })).getByRole('button', { name: 'Need help' }));
    await user.click(have);
    expect(have).toHaveAttribute('aria-pressed', 'false');
    await user.click(have);
    await user.click(button('See summary'));

    expect(screen.getByRole('heading', { name: 'Your summary' })).toBeInTheDocument();
    expect(screen.getByText('First child')).toBeInTheDocument();
    expect(screen.getByText(/Aadhaar card:/).textContent).toContain('Have it');
    expect(screen.getByText(/Mobile number:/).textContent).toContain('Need help');
    expect(screen.getByText('This QR code opens the official PMMVY website. It does not contain your answers.')).toBeInTheDocument();
    expect(screen.getByText(/Anyone who scans the QR code can read them/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'I understand. Put my answers in the QR code.' }));
    expect(screen.getByText('This QR code now contains your answers.')).toBeInTheDocument();

    // Dismissing the share sheet is reported as cancelled, and nothing else is opened.
    await user.click(button('Share summary'));
    await screen.findByText('Sharing was cancelled. Nothing was sent.');
    expect(share).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();

    await user.click(button('Start again'));
    expect(button('Continue')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('chat', () => {
  it('sends typed questions with bounded history and shows replies, sources and urgency', async () => {
    const api = makeApi();
    api.chat.mockResolvedValueOnce({
      ok: true,
      requestId: 't',
      reply: { text: 'First child: **Rs 5,000**.\n\n- Aadhaar\n- Bank account', language: 'en' },
      sources: [{ id: 'pmmvy_faq', title: 'PMMVY FAQ', publisher: 'MWCD', url: 'https://www.spniwcd.wcd.gov.in/x.pdf' }],
      safety: { urgent: true },
      needsClarification: false,
      provider: 'gemini',
    });
    const { user, speech } = setup({ api });
    await user.click(button(/Ask Sakho AI/));
    expect(button('Send')).toBeDisabled();
    await user.type(screen.getByLabelText('Your question'), 'How much money?');
    await user.click(button('Send'));

    await screen.findByText('Rs 5,000');
    expect(api.chat.mock.calls[0]?.[0]).toEqual({
      messages: [{ role: 'user', text: 'How much money?' }],
      locale: 'en',
      inputMode: 'text',
    });
    expect(screen.getByText('Aadhaar').tagName).toBe('LI');
    expect(screen.getByRole('link', { name: 'PMMVY FAQ' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('If this is urgent, press "Get help". Sakho AI cannot call for you.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your question')).toHaveValue('');
    // A typed question is not read aloud unless the user turned that on.
    expect(speech.ttsRequests).toHaveLength(0);

    await user.type(screen.getByLabelText('Your question'), 'And documents?');
    await user.click(button('Send'));
    await screen.findByText('Test reply');
    expect(api.chat.mock.calls[1]?.[0].messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);

    await user.click(button('Start new conversation'));
    expect(screen.queryByText('Test reply')).not.toBeInTheDocument();
    expect(screen.getByText(/Ask anything/)).toBeInTheDocument();
  });

  it('a spoken question is sent as voice and the answer is spoken; Stop stops it', async () => {
    const { user, speech, api } = setup({ language: 'hi' });
    await user.click(button(/Sakho AI से पूछें/));
    await user.click(button('बोलें'));
    expect(speech.recognitions[0]?.lang).toBe('hi-IN');
    act(() => speech.recognitions[0]?.say('कौन से कागज़ चाहिए'));
    await screen.findByText('Test reply');
    expect(api.chat.mock.calls[0]?.[0]).toMatchObject({ locale: 'hi', inputMode: 'voice' });
    await waitFor(() => expect(speech.ttsRequests[0]).toMatchObject({ text: 'Test reply', locale: 'hi' }));
    await user.click(await screen.findByRole('button', { name: 'रोकें' }));
    expect(speech.audios[0]?.paused).toBe(true);
    expect(speech.revoked).toHaveLength(1);
  });

  it.each([
    ['rate_limited', 'Too many questions in a short time. Please wait a minute and try again.'],
    ['provider_unavailable', 'The AI helper is not available right now. You can still use "Check benefits" and "Get help".'],
    ['provider_timeout', 'The answer took too long. Please try again.'],
    ['network', 'No internet. Chat needs internet. Your message is still here.'],
    ['provider_bad_response', 'Something went wrong. Your message is still here. Please try again.'],
  ] as const)('explains %s and lets the user retry without retyping', async (code, message) => {
    const api = makeApi();
    api.chat.mockRejectedValueOnce(new ApiClientError(code));
    const { user } = setup({ api });
    await user.click(button(/Ask Sakho AI/));
    await user.type(screen.getByLabelText('Your question'), 'hello');
    await user.click(button('Send'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByText('hello')).toBeInTheDocument();
    await user.click(button('Try again'));
    await screen.findByText('Test reply');
    expect(api.chat.mock.calls[1]?.[0].messages).toEqual([{ role: 'user', text: 'hello' }]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders model output as text, never as HTML', () => {
    const { container } = render(
      <SafeText text={'<img src=x onerror="alert(1)"> **bold** [click](javascript:alert(1))\n\n<script>alert(2)</script>'} />,
    );
    expect(container.querySelector('img, script, a')).toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.textContent).toContain('<script>alert(2)</script>');
  });

  it('marks replies with their own language and direction', async () => {
    const api = makeApi();
    api.chat.mockResolvedValueOnce({
      ok: true,
      requestId: 't',
      reply: { text: 'ہیلپ لائن 14408', language: 'ur' },
      sources: [],
      safety: { urgent: false },
      needsClarification: false,
      provider: 'gemini',
    });
    const { user } = setup({ api, language: 'ur' });
    await user.click(button(/Ask Sakho AI/));
    await user.type(screen.getByLabelText('Your question'), 'ہیلو');
    await user.click(button('Send'));
    const reply = (await screen.findByText('ہیلپ لائن 14408')).closest('[dir]');
    expect(reply).toHaveAttribute('dir', 'rtl');
    expect(reply).toHaveAttribute('lang', 'ur-IN');
    expect(document.documentElement.dir).toBe('ltr');
  });
});

describe('settings, privacy and navigation', () => {
  it('never writes chat or answers to storage', async () => {
    const { user } = setup();
    await user.click(button(/Ask Sakho AI/));
    await user.type(screen.getByLabelText('Your question'), 'PRIVATE-CHAT-TEXT');
    await user.click(button('Send'));
    await screen.findByText('Test reply');
    await user.click(button('Benefits'));
    await user.click(button('Continue'));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    await screen.findByRole('heading', { name: 'Which child is this?' });

    const stored = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(Object.keys(window.localStorage)).toEqual([PREFS_KEY]);
    expect(stored).not.toMatch(/PRIVATE-CHAT-TEXT|pregnant|Test reply/);
    expect(window.sessionStorage).toHaveLength(0);
  });

  it('keeps chat and questionnaire progress across a language change', async () => {
    const { user } = setup();
    await openBenefits(user);
    await user.click(button('Yes'));
    await screen.findByRole('heading', { name: 'Which child is this?' });

    await user.click(button('Settings'));
    await user.click(button('Change language'));
    await user.click(button(/हिन्दी/));
    await user.click(button('आगे बढ़ें'));
    expect(document.documentElement.lang).toBe('hi');

    await user.click(button('लाभ'));
    expect(screen.getByRole('heading', { name: 'यह आपका कौन सा बच्चा है?' })).toBeInTheDocument();
    expect(screen.getByText('सवाल 2 / 3')).toBeInTheDocument();
  });

  it('changes speed and auto-read, saves them, and erases the session on request', async () => {
    const { user, speech } = setup();
    await user.click(button(/Ask Sakho AI/));
    await user.type(screen.getByLabelText('Your question'), 'hello');
    await user.click(button('Send'));
    await screen.findByText('Test reply');

    await user.click(button('Settings'));
    await user.click(button('Slow'));
    expect(button('Slow')).toHaveAttribute('aria-pressed', 'true');
    const toggle = screen.getByRole('switch', { name: 'Read answers aloud automatically' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? '{}')).toMatchObject({ speed: 'slow', autoRead: true });

    await user.click(button('Erase my chat and answers'));
    expect(screen.getByText('Erased.')).toBeInTheDocument();
    await user.click(button('Ask'));
    expect(screen.queryByText('Test reply')).not.toBeInTheDocument();

    // With auto-read on, a typed question is read aloud at the chosen speed.
    await user.type(screen.getByLabelText('Your question'), 'again');
    await user.click(button('Send'));
    await waitFor(() => expect(speech.ttsRequests[0]).toMatchObject({ text: 'Test reply', speed: 'slow' }));
  });

  it('marks the current page in the menu and offers a skip link', async () => {
    const { user } = setup();
    const nav = screen.getByRole('navigation', { name: 'Main menu' });
    expect(within(nav).getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await user.click(within(nav).getByRole('button', { name: 'Ask' }));
    expect(within(nav).getByRole('button', { name: 'Ask' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main');
  });

  it('shows the offline banner and the demo-provider notice', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    const { user } = setup();
    expect(screen.getByText('No internet. Chat and voice need internet. The buttons still work.')).toBeInTheDocument();
    await user.click(button(/Ask Sakho AI/));
    expect(screen.getByText('Demo answers: the AI service is not connected.')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('dialogs', () => {
  it('have an accessible name, trap focus, close on Escape and restore focus', async () => {
    const { user } = setup();
    const trigger = within(screen.getByRole('banner')).getByRole('button', { name: 'Get help' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Emergency help' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    const inside = within(dialog).getAllByRole('button');
    await user.tab({ shift: true });
    expect(inside[inside.length - 1]).toHaveFocus();
    await user.tab();
    expect(inside[0]).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
