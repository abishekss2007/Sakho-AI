import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * End-to-end tests against the production build with mock providers and
 * demo-mode emergency help. Nothing here needs a Gemini key, cloud
 * credentials, a microphone, geolocation or a phone dialer.
 */

const PREFS_KEY = 'sakho-ai:prefs:v1';

async function start(page: Page, language = 'English', confirm = 'Continue', skip = 'Skip') {
  await page.goto('/');
  await page.getByRole('button', { name: new RegExp(`^${language}`) }).click();
  await page.getByRole('button', { name: confirm, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: skip, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** Skip onboarding by seeding the (non-sensitive) preferences. */
async function seed(page: Page, language = 'en') {
  await page.addInitScript(
    ([key, lang]) => {
      if (!window.localStorage.getItem(key as string)) {
        window.localStorage.setItem(
          key as string,
          JSON.stringify({ language: lang, speed: 'normal', autoRead: false, introSeen: true }),
        );
      }
    },
    [PREFS_KEY, language],
  );
  await page.goto('/');
  // The app is rendered in the browser; wait until it has mounted.
  await expect(page.getByRole('navigation')).toBeVisible();
}

/** Replace browser speech recognition with a scripted fake. */
async function fakeRecognition(page: Page, transcript: string | null) {
  await page.addInitScript((next) => {
    const state = { started: 0, aborted: 0, next };
    (window as unknown as { __sr: typeof state }).__sr = state;
    class FakeRecognition {
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      private timer: ReturnType<typeof setTimeout> | undefined;
      start() {
        state.started += 1;
        if (state.next === null) return;
        this.timer = setTimeout(() => this.onresult?.({ results: [[{ transcript: state.next }]] }), 100);
      }
      abort() {
        clearTimeout(this.timer);
        state.aborted += 1;
      }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  }, transcript);
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function answerToResult(page: Page) {
  await page.getByRole('navigation').getByRole('button', { name: 'Benefits' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'First child' }).click();
  await expect(page.getByRole('heading', { name: 'Do you have any one of these?' })).toBeVisible();
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Early guidance' })).toBeVisible();
}

test.describe('deployment contract', () => {
  test('health reports mock providers and demo emergency mode', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({
      ok: true,
      service: 'sakho-ai',
      providers: 'mock',
      sosMode: 'demo',
      rateLimit: 'per-instance',
    });
  });

  test('security headers are set and no starter branding remains', async ({ page }) => {
    const response = await page.goto('/');
    const headers = response?.headers() ?? {};
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
    await expect(page).toHaveTitle('Sakho');
    const html = await page.content();
    expect(html).not.toMatch(/Create Next App|Thozhi|vercel\.svg/i);
  });
});

test.describe('onboarding', () => {
  test('language, introduction with emergency access, then home', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: /தமிழ்/ }).click();
    await page.getByRole('button', { name: 'தொடர்', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ta');

    const intro = page.getByRole('dialog', { name: 'Sakho எப்படி வேலை செய்கிறது' });
    await expect(intro).toBeVisible();
    await expectNoAxeViolations(page);

    // Emergency help is reachable from inside the introduction and appears above it.
    await intro.getByRole('button', { name: 'உதவி பெறு' }).click();
    const sos = page.getByRole('dialog', { name: 'அவசர உதவி' });
    await expect(sos).toBeVisible();
    await expect(sos.getByRole('button', { name: /112/ })).toBeVisible();
    await sos.getByRole('button', { name: 'மூடு' }).click();
    await expect(intro).toBeVisible();

    await intro.getByRole('button', { name: 'அடுத்து' }).click();
    await intro.getByRole('button', { name: 'அடுத்து' }).click();
    await intro.getByRole('button', { name: 'தொடங்கு' }).click();
    await expect(page.getByRole('heading', { name: 'வணக்கம். இன்று நான் உங்களுக்கு எப்படி உதவலாம்?' })).toBeVisible();
    await expectNoAxeViolations(page);

    // The introduction is not shown again.
    await page.reload();
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('chat', () => {
  test('typed question gets an answer from /api/chat with a verified source', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    await expectNoAxeViolations(page);

    const request = page.waitForRequest('**/api/chat');
    await page.getByLabel('Your question').fill('Tell me about the PMMVY scheme');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    expect((await request).postDataJSON()).toEqual({
      messages: [{ role: 'user', text: 'Tell me about the PMMVY scheme' }],
      locale: 'en',
      inputMode: 'text',
    });

    await expect(page.getByText(/Demo answer: for the first child/)).toBeVisible();
    const source = page.getByRole('link', { name: /PMMVY Frequently Asked Questions/ });
    await expect(source).toHaveAttribute('href', /spniwcd\.wcd\.gov\.in/);
    await expect(page.getByText('Demo answers: the AI service is not connected.')).toBeVisible();
    await expectNoAxeViolations(page);

    // Listening requests audio from /api/tts.
    const tts = page.waitForResponse('**/api/tts');
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    const audio = await tts;
    expect(audio.status()).toBe(200);
    expect(audio.headers()['content-type']).toBe('audio/wav');

    await page.getByRole('button', { name: 'Start new conversation' }).click();
    await expect(page.getByText(/Demo answer: for the first child/)).toHaveCount(0);
  });

  test('streamed speech is played through the browser as it arrives and then stops by itself', async ({ page }) => {
    // The mock server answers with a file; here the reply is swapped for raw PCM, as real Gemini speech sends it.
    await page.addInitScript(() => {
      const state = { scheduled: 0, seconds: 0 };
      (window as unknown as { __pcm: typeof state }).__pcm = state;
      const create = AudioContext.prototype.createBufferSource;
      AudioContext.prototype.createBufferSource = function patched(this: AudioContext) {
        const source = create.call(this);
        const start = source.start.bind(source);
        source.start = (...args: Parameters<typeof start>) => {
          state.scheduled += 1;
          state.seconds += source.buffer?.duration ?? 0;
          return start(...args);
        };
        return source;
      };
    });
    await seed(page);
    const samples = 24000 * 0.4;
    const pcm = Buffer.alloc(samples * 2 + 1);
    for (let i = 0; i < samples; i += 1) pcm.writeInt16LE(Math.round(Math.sin(i / 12) * 6000), i * 2);
    let requestBody: unknown;
    await page.route('**/api/tts', async (route) => {
      requestBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'audio/l16;rate=24000;channels=1', body: pcm });
    });

    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    await page.getByLabel('Your question').fill('hello');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Listen', exact: true }).click();

    await expect(page.getByRole('article').getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible({ timeout: 5000 });
    expect(requestBody).toMatchObject({ stream: true, speed: 'normal', locale: 'en' });
    const played = await page.evaluate(() => (window as unknown as { __pcm: { scheduled: number; seconds: number } }).__pcm);
    expect(played.scheduled).toBeGreaterThan(0);
    // The odd trailing byte is not a whole sample and is left out.
    expect(played.seconds).toBeCloseTo(0.4, 2);
    await expect(page.getByRole('status')).toHaveCount(0);

    // Listening again replays the kept clip without another request.
    let again = 0;
    await page.route('**/api/tts', async (route) => {
      again += 1;
      await route.abort();
    });
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible({ timeout: 5000 });
    expect(again).toBe(0);
  });

  test('urgent wording shows the help prompt but does not open help or call by itself', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    await page.getByLabel('Your question').fill('Please help me, I am bleeding');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('If this is urgent, press "Get help". Sakho cannot call for you.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the home talk button starts listening and sends what was said', async ({ page }) => {
    await fakeRecognition(page, 'how do I open a bank account');
    await seed(page);
    const request = page.waitForRequest('**/api/chat');
    await page.getByRole('button', { name: 'Tap to talk' }).click();
    expect((await request).postDataJSON()).toMatchObject({
      messages: [{ role: 'user', text: 'how do I open a bank account' }],
      inputMode: 'voice',
    });
    await expect(page.getByText(/Demo answer \(/)).toBeVisible();
  });

  test('a suggested question can be sent with one tap', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    await page.getByRole('button', { name: 'How do I open a bank account?' }).click();
    await expect(page.getByText(/Demo answer \(/)).toBeVisible();
  });

  test('a spoken question is sent as voice input', async ({ page }) => {
    await fakeRecognition(page, 'what papers do I need');
    await seed(page);
    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    const request = page.waitForRequest('**/api/chat');
    await page.getByRole('button', { name: 'Speak', exact: true }).click();
    expect((await request).postDataJSON()).toMatchObject({
      messages: [{ role: 'user', text: 'what papers do I need' }],
      inputMode: 'voice',
    });
    await expect(page.getByText(/Demo answer \(/)).toBeVisible();
  });
});

test.describe('guided benefits', () => {
  test('questionnaire, documents, summary and restart, driven by /api/scheme/check', async ({ page }) => {
    await seed(page);
    const checks: unknown[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/scheme/check')) checks.push(request.postDataJSON());
    });

    await page.getByRole('button', { name: /Check benefits/ }).click();
    await expect(page.getByText(/It is not an approval/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Question 1 of 3')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await page.getByRole('button', { name: 'Second child' }).click();
    await expect(page.getByText('Question 3 of 4')).toBeVisible();
    await page.getByRole('button', { name: 'Not known yet' }).click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Early guidance' })).toBeVisible();
    await expect(page.getByText('We cannot tell from these answers.')).toBeVisible();
    await expect(page.getByText('Not verified by an official')).toBeVisible();
    await expect(page.getByText(/you are eligible/i)).toHaveCount(0);
    await expectNoAxeViolations(page);
    expect(checks).toHaveLength(5);
    expect(checks[4]).toEqual({
      schemeId: 'pmmvy',
      answers: {
        pregnant_or_recent_birth: 'yes',
        child_order: 'second',
        second_child_girl: 'unsure',
        has_category_proof: 'yes',
      },
    });

    await page.getByRole('button', { name: 'See papers to prepare' }).click();
    const aadhaar = page.getByRole('group', { name: 'Aadhaar card' });
    await aadhaar.getByRole('button', { name: 'Have it' }).click();
    await expect(aadhaar.getByRole('button', { name: 'Have it' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('group', { name: 'Mobile number' }).getByRole('button', { name: 'Need help' }).click();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'See summary' }).click();
    await expect(page.getByRole('heading', { name: 'Your summary' })).toBeVisible();
    await expect(page.getByText('Second child', { exact: true })).toBeVisible();
    await expect(page.getByText('This QR code opens the official PMMVY website. It does not contain your answers.')).toBeVisible();
    await page.getByRole('checkbox', { name: 'I understand. Put my answers in the QR code.' }).check();
    await expect(page.getByText('This QR code now contains your answers.')).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Start again' }).click();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  });

  test('a mocked spoken answer moves the questionnaire forward through /api/understand', async ({ page }) => {
    await fakeRecognition(page, 'yes');
    await seed(page);
    await page.getByRole('button', { name: /Check benefits/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const understand = page.waitForResponse('**/api/understand');
    await page.getByRole('button', { name: 'Speak', exact: true }).click();
    const body = await (await understand).json();
    expect(body).toMatchObject({
      questionId: 'pregnant_or_recent_birth',
      interpretation: { kind: 'answer', value: 'yes' },
      via: 'keywords',
    });
    await expect(page.getByRole('heading', { name: 'Which child is this?' })).toBeVisible();
  });

  test('changing language keeps questionnaire progress', async ({ page }) => {
    await seed(page);
    await page.getByRole('button', { name: /Check benefits/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Which child is this?' })).toBeVisible();

    await page.getByRole('navigation').getByRole('button', { name: 'Settings' }).click();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Change language' }).click();
    await page.getByRole('button', { name: /हिन्दी/ }).click();
    await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await page.getByRole('navigation').getByRole('button', { name: 'लाभ' }).click();
    await expect(page.getByRole('heading', { name: 'यह आपका कौन सा बच्चा है?' })).toBeVisible();
    await expect(page.getByText('सवाल 2 / 3')).toBeVisible();
  });
});

test.describe('safety regressions', () => {
  test('demo mode contains no live emergency links', async ({ page }) => {
    await seed(page);
    await page.getByRole('banner').getByRole('button', { name: 'Get help' }).click();
    const sos = page.getByRole('dialog', { name: 'Emergency help' });
    await expect(sos.getByText('Demo mode: these buttons do not call anyone.')).toBeVisible();
    await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
    expect(await page.content()).not.toContain('tel:');
    await sos.getByRole('button', { name: 'Practice: 112' }).click();
    await expect(sos.getByText(/No call was made/)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('opening emergency help interrupts listening', async ({ page }) => {
    await fakeRecognition(page, null);
    await seed(page);
    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    await page.getByRole('button', { name: 'Speak', exact: true }).click();
    await expect(page.getByText('Listening… speak now')).toBeVisible();
    await page.getByRole('banner').getByRole('button', { name: 'Get help' }).click();
    await expect(page.getByRole('dialog', { name: 'Emergency help' })).toBeVisible();
    const state = await page.evaluate(() => (window as unknown as { __sr: { started: number; aborted: number } }).__sr);
    expect(state).toMatchObject({ started: 1, aborted: 1 });
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('Listening… speak now')).toHaveCount(0);
  });

  test('location is requested only on an explicit press', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 13.08268, longitude: 80.27072 });
    await page.addInitScript(() => {
      const state = { calls: 0 };
      (window as unknown as { __geo: typeof state }).__geo = state;
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      navigator.geolocation.getCurrentPosition = (...args) => {
        state.calls += 1;
        return original(...args);
      };
    });
    await seed(page);
    await page.getByRole('banner').getByRole('button', { name: 'Get help' }).click();
    const calls = () => page.evaluate(() => (window as unknown as { __geo: { calls: number } }).__geo.calls);
    expect(await calls()).toBe(0);
    await page.getByRole('button', { name: 'Show my location' }).click();
    await expect(page.getByText('13.08268, 80.27072')).toBeVisible();
    expect(await calls()).toBe(1);
  });

  test('cancelling the share sheet sends nothing and opens nothing else', async ({ page }) => {
    await page.addInitScript(() => {
      const state = { calls: 0 };
      (window as unknown as { __share: typeof state }).__share = state;
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: () => {
          state.calls += 1;
          return Promise.reject(new DOMException('Share cancelled', 'AbortError'));
        },
      });
    });
    await seed(page);
    const navigations: string[] = [];
    page.on('framenavigated', (frame) => navigations.push(frame.url()));
    const popups: Page[] = [];
    page.on('popup', (popup) => popups.push(popup));

    await answerToResult(page);
    await page.getByRole('button', { name: 'See papers to prepare' }).click();
    await page.getByRole('button', { name: 'See summary' }).click();
    const before = navigations.length;
    await page.getByRole('button', { name: 'Share summary' }).click();
    await expect(page.getByText('Sharing was cancelled. Nothing was sent.')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __share: { calls: number } }).__share.calls)).toBe(1);
    expect(navigations.length).toBe(before);
    expect(popups).toHaveLength(0);
    expect(await page.content()).not.toMatch(/sms:/);
  });
});

test.describe('privacy', () => {
  test('chat and answers are not persisted and disappear on reload', async ({ page }) => {
    await start(page);
    await page.getByRole('button', { name: /Ask Sakho/ }).click();
    await page.getByLabel('Your question').fill('PRIVATE-CHAT-TEXT about my pregnancy');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText(/Demo answer \(/)).toBeVisible();
    await answerToResult(page);

    const stored = await page.evaluate(() => ({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
      cookies: document.cookie,
    }));
    expect(Object.keys(stored.local)).toEqual([PREFS_KEY]);
    expect(Object.keys(JSON.parse(stored.local[PREFS_KEY] ?? '{}')).sort()).toEqual(['autoRead', 'introSeen', 'language', 'speed']);
    expect(stored.session).toEqual({});
    expect(stored.cookies).toBe('');
    expect(JSON.stringify(stored)).not.toMatch(/PRIVATE-CHAT-TEXT|pregnan/i);

    await page.reload();
    await page.getByRole('navigation').getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByText(/PRIVATE-CHAT-TEXT/)).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button', { name: 'Benefits' }).click();
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  });
});

test.describe('accessibility and keyboard', () => {
  test('keyboard: skip link, visible focus, dialog focus and restore', async ({ page }) => {
    await seed(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Tab');
    const help = page.getByRole('banner').getByRole('button', { name: 'Get help' });
    await expect(help).toBeFocused();
    const outline = await help.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(parseFloat(outline)).toBeGreaterThanOrEqual(3);

    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Emergency help' });
    await expect(dialog).toBeFocused();
    // Focus stays inside the dialog.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test('primary actions are large touch targets', async ({ page }) => {
    await seed(page);
    const targets = [
      page.getByRole('banner').getByRole('button', { name: 'Get help' }),
      page.getByRole('button', { name: /Ask Sakho/ }),
      page.getByRole('button', { name: /Check benefits/ }),
      page.getByRole('navigation').getByRole('button', { name: 'Settings' }),
    ];
    for (const target of targets) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    }
    await page.getByRole('button', { name: /Check benefits/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    for (const name of ['Yes', 'No', 'Not sure']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(56);
    }
  });
});

test.describe('responsive', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('small phone with long Tamil text does not scroll sideways', async ({ page }) => {
    await seed(page, 'ta');
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole('banner').getByRole('button', { name: 'உதவி பெறு' })).toBeInViewport();
    for (const name of ['கேள்', 'பலன்கள்', 'அமைப்பு']) {
      await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
      await expectNoHorizontalScroll(page);
    }
    await page.getByRole('banner').getByRole('button', { name: 'உதவி பெறு' }).click();
    await expectNoHorizontalScroll(page);
  });

  test('text enlarged to 200% stays usable', async ({ page }) => {
    await seed(page, 'hi');
    await page.addStyleTag({ content: 'html { font-size: 225% !important; }' });
    await expectNoHorizontalScroll(page);
    await expect(page.getByRole('banner').getByRole('button', { name: 'मदद पाएँ' })).toBeInViewport();
    await page.getByRole('button', { name: /लाभ की जाँच करें/ }).click();
    await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
    await expect(page.getByRole('button', { name: 'हाँ', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('with very large text the menu moves into the page so every control stays reachable', async ({ page }) => {
    await seed(page, 'hi');
    // Larger than the 200% that WCAG asks for, to cover fonts that render taller on other systems.
    await page.addStyleTag({ content: 'html { font-size: 300% !important; }' });
    await expect(page.locator('main nav')).toHaveCount(1);
    await expect(page.getByRole('banner').getByRole('button', { name: 'मदद पाएँ' })).toBeInViewport();
    await expectNoHorizontalScroll(page);
    await page.getByRole('button', { name: /लाभ की जाँच करें/ }).click();
    await page.getByRole('button', { name: 'आगे बढ़ें', exact: true }).click();
    await page.getByRole('button', { name: 'हाँ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'यह आपका कौन सा बच्चा है?' })).toBeVisible();
    // The menu is still there, at the end of the page.
    await page.getByRole('navigation').getByRole('button', { name: 'होम', exact: true }).click();
    await expect(page.getByRole('button', { name: 'बोलने के लिए दबाएँ' })).toBeVisible();
  });

  test('Urdu: the whole interface is right-to-left and phone numbers are not reversed', async ({ page }) => {
    await start(page, 'اردو', 'آگے بڑھیں', 'چھوڑیں');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expectNoHorizontalScroll(page);
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: /Sakho سے پوچھیں/ }).click();
    const request = page.waitForRequest('**/api/chat');
    await page.getByLabel('آپ کا سوال').fill('ہیلپ لائن نمبر 14408');
    await page.getByRole('button', { name: 'بھیجیں', exact: true }).click();
    expect((await request).postDataJSON().locale).toBe('ur');
    const mine = page.getByText('ہیلپ لائن نمبر 14408');
    await expect(mine).toBeVisible();
    const bubble = mine.locator('xpath=ancestor::*[@dir][1]');
    await expect(bubble).toHaveAttribute('dir', 'rtl');
    await expect(bubble).toHaveAttribute('lang', 'ur-IN');
    await expectNoHorizontalScroll(page);

    await page.getByRole('banner').getByRole('button', { name: 'مدد حاصل کریں' }).click();
    const numbers = await page.getByRole('dialog').locator('bdi[dir="ltr"]').allTextContents();
    expect(numbers).toEqual(['112', '181', '1098']);
    await expectNoHorizontalScroll(page);
  });

  for (const [code, askLabel] of [
    ['bn', 'জিজ্ঞাসা'],
    ['te', 'అడగండి'],
    ['ml', 'ചോദിക്കുക'],
    ['as', 'সোধক'],
    ['or', 'ପଚାରନ୍ତୁ'],
  ] as const) {
    test(`${code}: translated screens fit a small phone without sideways scrolling`, async ({ page }) => {
      await seed(page, code);
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expectNoHorizontalScroll(page);
      await page.getByRole('navigation').getByRole('button', { name: askLabel, exact: true }).click();
      await expectNoHorizontalScroll(page);
      await page.getByRole('navigation').getByRole('button').nth(2).click();
      await expectNoHorizontalScroll(page);
      await page.getByRole('navigation').getByRole('button').nth(3).click();
      await expectNoHorizontalScroll(page);
      await page.getByRole('banner').getByRole('button').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  }
});

test.describe('offline', () => {
  test('a loaded page degrades honestly: buttons work on bundled rules, chat explains', async ({ page, context }) => {
    await seed(page);
    await context.setOffline(true);
    await expect(page.getByText('No internet. Chat and voice need internet. The buttons still work.')).toBeVisible();

    await page.getByRole('button', { name: /Check benefits/ }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText(/using guidance saved in this app \(version pmmvy-draft-2026-10-01\)/)).toBeVisible();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Early guidance' })).toBeVisible();

    await page.getByRole('navigation').getByRole('button', { name: 'Ask' }).click();
    await page.getByLabel('Your question').fill('hello');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('No internet. Chat needs internet. Your message is still here.')).toBeVisible();

    // Emergency numbers are part of the loaded page and still open.
    await page.getByRole('banner').getByRole('button', { name: 'Get help' }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Practice: 112' })).toBeVisible();

    await context.setOffline(false);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByText('No internet. Chat and voice need internet. The buttons still work.')).toHaveCount(0);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText(/Demo answer \(/)).toBeVisible();
  });

  test('offline reload is not supported (there is no service worker), and nothing claims otherwise', async ({ page, context }) => {
    await seed(page);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
    await context.setOffline(true);
    await expect(page.reload()).rejects.toThrow();
  });
});
