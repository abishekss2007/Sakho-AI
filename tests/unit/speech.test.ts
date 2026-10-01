import { describe, expect, it, vi } from 'vitest';
import { splitForSpeech, splitSentences, wavFromPcm, type ListenError } from '@/lib/speech/controller';
import { flush, makeSpeech } from '../helpers';

const speakRequest = { text: 'வணக்கம்', locale: 'ta' as const, bcp47: 'ta-IN', speed: 'normal' as const };

function listenWith(speech: ReturnType<typeof makeSpeech>, bcp47 = 'hi-IN') {
  const onResult = vi.fn();
  const onError = vi.fn<(error: ListenError) => void>();
  speech.controller.listen({ bcp47, onResult, onError });
  return { onResult, onError, recognition: speech.recognitions[speech.recognitions.length - 1] };
}

describe('listening', () => {
  it('starts recognition in the requested language and reports the transcript', () => {
    const speech = makeSpeech();
    const { onResult, recognition } = listenWith(speech);
    expect(speech.controller.getStatus()).toBe('listening');
    expect(recognition).toMatchObject({ lang: 'hi-IN', started: true, continuous: false, interimResults: false });
    recognition?.say('  हाँ ');
    expect(onResult).toHaveBeenCalledWith('हाँ');
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('reports an unsupported browser without throwing', () => {
    const speech = makeSpeech();
    speech.options.recognition = false;
    const { onError } = listenWith(speech);
    expect(onError).toHaveBeenCalledWith('unsupported');
    expect(speech.controller.recognitionSupported()).toBe(false);
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it.each([
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['no-speech', 'no_speech'],
    ['network', 'network'],
    ['language-not-supported', 'unsupported'],
    ['audio-capture', 'failed'],
  ])('maps recognition error %s to %s', (raw, mapped) => {
    const speech = makeSpeech();
    const { onError, recognition } = listenWith(speech);
    recognition?.fail(raw);
    expect(onError).toHaveBeenCalledWith(mapped);
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('treats ending with no result as silence, exactly once', () => {
    const speech = makeSpeech();
    const { onError, recognition } = listenWith(speech);
    recognition?.end();
    recognition?.end();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('no_speech');
  });

  it('does not report an error after a result when the browser then fires end', () => {
    const speech = makeSpeech();
    const { onResult, onError, recognition } = listenWith(speech);
    const handlers = { end: recognition?.onend };
    recognition?.say('yes');
    handlers.end?.();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('handles start() throwing synchronously', () => {
    const speech = makeSpeech();
    speech.options.startThrows = true;
    const { onError } = listenWith(speech);
    expect(onError).toHaveBeenCalledWith('failed');
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('ignores late callbacks from a stopped session', () => {
    const speech = makeSpeech();
    const { onResult, onError, recognition } = listenWith(speech);
    const late = { result: recognition?.onresult, error: recognition?.onerror, end: recognition?.onend };
    speech.controller.stopListening();
    expect(recognition?.aborted).toBe(true);
    late.result?.({ results: [[{ transcript: 'yes' }]] });
    late.error?.({ error: 'network' });
    late.end?.();
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('a language change aborts the old session and ignores its callbacks', () => {
    const speech = makeSpeech();
    const first = listenWith(speech, 'hi-IN');
    const stale = first.recognition?.onresult;
    const second = listenWith(speech, 'ta-IN');
    expect(first.recognition?.aborted).toBe(true);
    stale?.({ results: [[{ transcript: 'old language' }]] });
    expect(first.onResult).not.toHaveBeenCalled();
    second.recognition?.say('ஆம்');
    expect(second.onResult).toHaveBeenCalledWith('ஆம்');
  });

  it('aborted recognition is silent', () => {
    const speech = makeSpeech();
    const { onError, recognition } = listenWith(speech);
    recognition?.fail('aborted');
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('speaking', () => {
  it('plays cloud audio and releases it when finished', async () => {
    const speech = makeSpeech();
    const outcome = speech.controller.speak(speakRequest);
    expect(speech.controller.getStatus()).toBe('speaking');
    await flush();
    expect(speech.ttsRequests[0]).toMatchObject({ text: 'வணக்கம்', locale: 'ta', speed: 'normal' });
    const audio = speech.audios[0];
    audio?.onended?.();
    expect(await outcome).toBe('played');
    expect(speech.revoked).toEqual([audio?.url]);
    expect(audio?.onended).toBeNull();
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('stopping pauses, revokes the object URL, aborts the fetch and resolves as cancelled', async () => {
    const speech = makeSpeech();
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    speech.controller.stopSpeaking();
    expect(await outcome).toBe('cancelled');
    expect(speech.audios[0]?.paused).toBe(true);
    expect(speech.revoked).toHaveLength(1);
    expect(speech.ttsRequests[0]?.signal.aborted).toBe(true);
    expect(speech.synthCancel).toHaveBeenCalled();
  });

  it('cancelling while the audio is still downloading never creates an audio element', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'hang';
    const outcome = speech.controller.speak(speakRequest);
    speech.controller.stopAll();
    expect(await outcome).toBe('cancelled');
    await flush();
    expect(speech.audios).toHaveLength(0);
    expect(speech.utterances).toHaveLength(0);
  });

  it('falls back to a matching device voice when cloud speech fails', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'fail';
    speech.options.voices = [{ lang: 'en-US' }, { lang: 'ta_IN' }];
    const outcome = speech.controller.speak({ ...speakRequest, speed: 'slow' });
    await flush();
    const utterance = speech.utterances[0];
    expect(utterance).toMatchObject({ lang: 'ta-IN', rate: 0.8, voice: { lang: 'ta_IN' } });
    utterance?.onend?.();
    expect(await outcome).toBe('played_device_voice');
  });

  it('does not pretend to speak when no voice exists for the language', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'fail';
    speech.options.voices = [{ lang: 'en-US' }];
    expect(await speech.controller.speak(speakRequest)).toBe('no_voice');
    expect(speech.utterances).toHaveLength(0);
  });

  it('says the voice is busy when the service is over its limit and no device voice exists', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'busy';
    speech.options.voices = [{ lang: 'en-US' }];
    expect(await speech.controller.speak(speakRequest)).toBe('busy');
    speech.options.synth = false;
    expect(await speech.controller.speak(speakRequest)).toBe('busy');
    // A device voice still covers for a busy service.
    speech.options.synth = true;
    speech.options.voices = [{ lang: 'ta-IN' }];
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    speech.utterances[0]?.onend?.();
    expect(await outcome).toBe('played_device_voice');
  });

  it('waits briefly for voices that load late, then gives up honestly', async () => {
    vi.useFakeTimers();
    const speech = makeSpeech();
    speech.options.tts = 'fail';
    const outcome = speech.controller.speak(speakRequest);
    await vi.advanceTimersByTimeAsync(800);
    expect(await outcome).toBe('no_voice');
  });

  it('reports failure when neither cloud nor device speech exists', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'fail';
    speech.options.synth = false;
    expect(await speech.controller.speak(speakRequest)).toBe('failed');
  });

  it('reports blocked autoplay so the screen can offer a tap', async () => {
    const speech = makeSpeech();
    speech.options.nextPlay = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    expect(await speech.controller.speak(speakRequest)).toBe('blocked');
    expect(speech.revoked).toHaveLength(1);
  });

  it('releases broken audio before falling back', async () => {
    const speech = makeSpeech();
    speech.options.voices = [{ lang: 'ta-IN' }];
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    speech.audios[0]?.onerror?.();
    await flush();
    expect(speech.revoked).toHaveLength(1);
    speech.utterances[0]?.onend?.();
    expect(await outcome).toBe('played_device_voice');
  });

  it('a new utterance cancels the previous one and ignores its late events', async () => {
    const speech = makeSpeech();
    const first = speech.controller.speak(speakRequest);
    await flush();
    const firstAudio = speech.audios[0];
    const lateEnd = firstAudio?.onended;
    const second = speech.controller.speak({ ...speakRequest, text: 'second' });
    expect(await first).toBe('cancelled');
    lateEnd?.();
    expect(speech.controller.getStatus()).toBe('speaking');
    await flush();
    speech.audios[1]?.onended?.();
    expect(await second).toBe('played');
    expect(speech.revoked).toHaveLength(2);
  });
});

describe('starting sooner and speaking speed', () => {
  const long =
    'आधार कार्ड, बैंक खाता और मोबाइल नंबर तैयार रखें। फिर अपनी आंगनवाड़ी कार्यकर्ता से मिलें। वे आपके लिए फ़ॉर्म भर सकती हैं और आगे की जानकारी भी दे सकती हैं। किसी भी सवाल के लिए हेल्पलाइन पर फ़ोन करें।';

  it('keeps short text whole and splits long text into an opening and the rest', () => {
    expect(splitForSpeech('  नमस्ते।  ')).toEqual(['नमस्ते।']);
    const parts = splitForSpeech(long);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.length).toBeLessThan(parts.join(' ').length / 2);
    expect(parts.join(' ')).toBe(long);
    // No sentence break means nothing to split on.
    expect(splitForSpeech('क'.repeat(300))).toHaveLength(1);
    // Decimal points and Urdu full stops are handled.
    expect(splitForSpeech(`Give 2.5 ml now. ${'Then wait and watch the child closely for one hour. '.repeat(4)}`)[0]).toBe(
      'Give 2.5 ml now. Then wait and watch the child closely for one hour.',
    );
    expect(splitForSpeech(`${'یہ ایک جملہ ہے۔ '.repeat(12)}`)).toHaveLength(2);
  });

  it('requests both parts at once and plays them in order', async () => {
    const speech = makeSpeech();
    const outcome = speech.controller.speak({ ...speakRequest, locale: 'hi', bcp47: 'hi-IN', text: long });
    await flush();
    // Both requests are already out before the first part has finished playing.
    expect(speech.ttsRequests.map((r) => r.text)).toEqual(splitForSpeech(long));
    expect(speech.audios).toHaveLength(1);
    speech.audios[0]?.onended?.();
    await flush();
    expect(speech.audios).toHaveLength(2);
    expect(speech.revoked).toHaveLength(1);
    expect(speech.controller.getStatus()).toBe('speaking');
    speech.audios[1]?.onended?.();
    expect(await outcome).toBe('played');
    expect(speech.revoked).toHaveLength(2);
  });

  it('stopping between parts never starts the second part', async () => {
    const speech = makeSpeech();
    const outcome = speech.controller.speak({ ...speakRequest, text: long });
    await flush();
    const lateEnd = speech.audios[0]?.onended;
    speech.controller.stopSpeaking();
    lateEnd?.();
    await flush();
    expect(await outcome).toBe('cancelled');
    expect(speech.audios).toHaveLength(1);
  });

  it('applies the chosen speed in the player, so one clip serves every speed', async () => {
    const speech = makeSpeech();
    void speech.controller.speak({ ...speakRequest, speed: 'slow' });
    await flush();
    expect(speech.audios[0]?.playbackRate).toBe(0.8);
    void speech.controller.speak({ ...speakRequest, speed: 'fast' });
    await flush();
    expect(speech.audios[1]?.playbackRate).toBe(1.2);
    expect(speech.ttsRequests).toHaveLength(1);
  });
});

describe('streamed speech', () => {
  const streaming = () => {
    const speech = makeSpeech();
    speech.options.streaming = true;
    return speech;
  };

  it('plays chunks as they arrive, in one request, without splitting the text', async () => {
    const speech = streaming();
    const long = `${'यह एक लंबा वाक्य है। '.repeat(12)}`.trim();
    const outcome = speech.controller.speak({ ...speakRequest, locale: 'hi', bcp47: 'hi-IN', text: long });
    await flush();
    expect(speech.ttsRequests).toHaveLength(1);
    expect(speech.ttsRequests[0]).toMatchObject({ stream: true, text: long });
    const player = speech.players[0];
    expect(player?.sampleRate).toBe(24000);
    expect(player?.chunks.map((c) => [...c])).toEqual([[1, 2], [3, 4]]);
    expect(player?.finished).toBe(true);
    expect(speech.audios).toHaveLength(0);
    expect(speech.controller.getStatus()).toBe('speaking');
    player?.end();
    expect(await outcome).toBe('played');
    expect(player?.stopped).toBe(true);
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('keeps the streamed clip so listening again is instant and needs no request', async () => {
    const speech = streaming();
    const first = speech.controller.speak(speakRequest);
    await flush();
    speech.players[0]?.end();
    await first;
    const second = speech.controller.speak(speakRequest);
    await flush();
    expect(speech.ttsRequests).toHaveLength(1);
    expect(speech.players).toHaveLength(1);
    expect(speech.audios).toHaveLength(1);
    speech.audios[0]?.onended?.();
    expect(await second).toBe('played');
  });

  it('stopping a stream stops the player, aborts the request and ignores late audio', async () => {
    const speech = streaming();
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    const player = speech.players[0];
    speech.controller.stopSpeaking();
    expect(await outcome).toBe('cancelled');
    expect(player?.stopped).toBe(true);
    expect(speech.ttsRequests[0]?.signal.aborted).toBe(true);
    player?.end();
    expect(speech.controller.getStatus()).toBe('idle');
  });

  it('reports blocked audio when the browser will not start it', async () => {
    const speech = streaming();
    speech.options.playerAllowed = false;
    expect(await speech.controller.speak(speakRequest)).toBe('blocked');
    expect(speech.players[0]?.chunks).toHaveLength(0);
  });

  it('falls back to a device voice when the stream breaks before any sound', async () => {
    const speech = streaming();
    speech.options.streamChunks = ['break'];
    speech.options.voices = [{ lang: 'ta-IN' }];
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    expect(speech.players[0]?.stopped).toBe(true);
    speech.utterances[0]?.onend?.();
    expect(await outcome).toBe('played_device_voice');
  });

  it('lets audio that already arrived finish when the stream breaks part-way, and does not keep the partial clip', async () => {
    const speech = streaming();
    speech.options.streamChunks = [new Uint8Array([1, 2]), 'break'];
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    expect(speech.players[0]?.finished).toBe(true);
    speech.players[0]?.end();
    expect(await outcome).toBe('played');
    speech.options.streamChunks = [new Uint8Array([5, 6])];
    void speech.controller.speak(speakRequest);
    await flush();
    expect(speech.ttsRequests).toHaveLength(2);
  });

  it('uses complete clips, not a stream, at slow or fast speed so pitch is kept', async () => {
    const speech = streaming();
    void speech.controller.speak({ ...speakRequest, speed: 'slow' });
    await flush();
    expect(speech.ttsRequests[0]).not.toHaveProperty('stream');
    expect(speech.players).toHaveLength(0);
    expect(speech.audios[0]?.playbackRate).toBe(0.8);
  });

  it('accepts a complete file even when a stream was requested', async () => {
    const speech = makeSpeech();
    speech.options.streaming = true;
    const original = speech.env.fetchTts;
    speech.env.fetchTts = (body, signal) => original({ ...body, stream: false }, signal);
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    expect(speech.audios).toHaveLength(1);
    speech.audios[0]?.onended?.();
    expect(await outcome).toBe('played');
  });

  it('builds a valid WAV file from PCM chunks', async () => {
    const blob = wavFromPcm([new Uint8Array([1, 2]), new Uint8Array([3, 4])], 24000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/wav');
    expect(bytes.byteLength).toBe(48);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(24000);
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(4);
    expect([...bytes.slice(44)]).toEqual([1, 2, 3, 4]);
  });
});

describe('device voice first', () => {
  const device = { ...speakRequest, prefer: 'device' as const };

  it('speaks at once with a matching device voice and makes no request', async () => {
    const speech = makeSpeech();
    speech.options.voices = [{ lang: 'en-US' }, { lang: 'ta-IN', name: 'Google தமிழ்' }];
    const outcome = speech.controller.speak({ ...device, speed: 'fast' });
    // Synchronous: no waiting for a network round trip.
    expect(speech.utterances).toHaveLength(1);
    expect(speech.utterances[0]).toMatchObject({ lang: 'ta-IN', rate: 1.2, voice: { name: 'Google தமிழ்' } });
    expect(speech.ttsRequests).toHaveLength(0);
    expect(speech.controller.getStatus()).toBe('speaking');
    speech.utterances[0]?.onend?.();
    expect(await outcome).toBe('played_device_voice');
  });

  it('queues a long reply sentence by sentence so the browser does not cut it off', async () => {
    const speech = makeSpeech();
    speech.options.voices = [{ lang: 'ta-IN' }];
    const text = `${'இது ஒரு நீண்ட வாக்கியம், இதில் பல சொற்கள் உள்ளன. '.repeat(12)}`.trim();
    const outcome = speech.controller.speak({ ...device, text });
    const pieces = splitSentences(text);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.join(' ')).toBe(text);
    for (let i = 0; i < pieces.length; i += 1) {
      expect(speech.utterances).toHaveLength(i + 1);
      speech.utterances[i]?.onend?.();
    }
    expect(await outcome).toBe('played_device_voice');
  });

  it('uses the speech service when the device has no voice for the language', async () => {
    const speech = makeSpeech();
    speech.options.voices = [{ lang: 'en-US' }];
    const outcome = speech.controller.speak(device);
    await flush();
    expect(speech.utterances).toHaveLength(0);
    expect(speech.ttsRequests).toHaveLength(1);
    speech.audios[0]?.onended?.();
    expect(await outcome).toBe('played');
  });

  it('falls back to the speech service if the device voice fails before any sound', async () => {
    const speech = makeSpeech();
    speech.options.voices = [{ lang: 'ta-IN' }];
    const outcome = speech.controller.speak(device);
    speech.utterances[0]?.onerror?.();
    await flush();
    expect(speech.ttsRequests).toHaveLength(1);
    speech.audios[0]?.onended?.();
    expect(await outcome).toBe('played');
  });

  it('stops cleanly and ignores late events from the device voice', async () => {
    const speech = makeSpeech();
    speech.options.voices = [{ lang: 'ta-IN' }];
    const outcome = speech.controller.speak({ ...device, text: 'ஒன்று. இரண்டு. '.repeat(20) });
    const late = speech.utterances[0]?.onend;
    speech.controller.stopSpeaking();
    expect(await outcome).toBe('cancelled');
    expect(speech.synthCancel).toHaveBeenCalled();
    late?.();
    expect(speech.utterances).toHaveLength(1);
  });

  it('keeps short text in one piece and never returns nothing', () => {
    expect(splitSentences('வணக்கம்')).toEqual(['வணக்கம்']);
    expect(splitSentences('One. Two. Three.', 9)).toEqual(['One. Two.', 'Three.']);
    expect(splitSentences('   ')).toEqual(['']);
  });
});

describe('replaying and voice choice', () => {
  it('replays fetched audio without asking the server again', async () => {
    const speech = makeSpeech();
    const first = speech.controller.speak(speakRequest);
    await flush();
    speech.audios[0]?.onended?.();
    await first;
    const second = speech.controller.speak(speakRequest);
    await flush();
    speech.audios[1]?.onended?.();
    expect(await second).toBe('played');
    expect(speech.ttsRequests).toHaveLength(1);
    // Different text is a new request, and clearing forgets everything.
    void speech.controller.speak({ ...speakRequest, text: 'other' });
    await flush();
    expect(speech.ttsRequests).toHaveLength(2);
    speech.controller.clearClips();
    void speech.controller.speak(speakRequest);
    await flush();
    expect(speech.ttsRequests).toHaveLength(3);
  });

  it('does not keep audio from a failed request', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'fail';
    speech.options.voices = [{ lang: 'en-US' }];
    expect(await speech.controller.speak(speakRequest)).toBe('no_voice');
    speech.options.tts = 'ok';
    void speech.controller.speak(speakRequest);
    await flush();
    expect(speech.ttsRequests).toHaveLength(2);
    expect(speech.audios).toHaveLength(1);
  });

  it('prefers a female device voice when falling back', async () => {
    const speech = makeSpeech();
    speech.options.tts = 'fail';
    speech.options.voices = [
      { lang: 'ta-IN', name: 'Microsoft Valluvar' },
      { lang: 'ta-IN', name: 'Microsoft Pallavi Online' },
    ];
    void speech.controller.speak(speakRequest);
    await flush();
    expect(speech.utterances[0]?.voice).toMatchObject({ name: 'Microsoft Pallavi Online' });
  });
});

describe('one coordinated lifecycle', () => {
  it('starting to listen stops speech', async () => {
    const speech = makeSpeech();
    const outcome = speech.controller.speak(speakRequest);
    await flush();
    listenWith(speech);
    expect(await outcome).toBe('cancelled');
    expect(speech.audios[0]?.paused).toBe(true);
    expect(speech.controller.getStatus()).toBe('listening');
  });

  it('starting to speak stops listening', () => {
    const speech = makeSpeech();
    const { recognition } = listenWith(speech);
    void speech.controller.speak(speakRequest);
    expect(recognition?.aborted).toBe(true);
    expect(speech.controller.getStatus()).toBe('speaking');
  });

  it('stopAll stops both and notifies subscribers', async () => {
    const speech = makeSpeech();
    const seen: string[] = [];
    const unsubscribe = speech.controller.subscribe(() => seen.push(speech.controller.getStatus()));
    const { recognition } = listenWith(speech);
    speech.controller.stopAll();
    expect(recognition?.aborted).toBe(true);
    expect(seen).toEqual(['listening', 'idle']);
    unsubscribe();
    listenWith(speech);
    expect(seen).toHaveLength(2);
  });
});
