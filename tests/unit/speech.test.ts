import { describe, expect, it, vi } from 'vitest';
import type { ListenError } from '@/lib/speech/controller';
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
