import { useEffect, useRef, useState } from 'react';
import { Download, Headphones, Pause, Play, Square, Trash2, Info } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { useT } from '../../i18n';
import { Button, IconButton, Input, Select, Spinner, useAsync, cx } from '../../components/ui';
import { activeProvider, errorMessage, providerWithConsent } from '../../app/services';
import { generateAudioScript, type AudioLength, type SourceDoc } from '../../ai/assistant';
import { blobStore, saveFile } from '../../lib/platform';
import { sha256Hex } from '../../lib/util';
import type { AudioOverview, Source } from '../../core/types';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function AudioStudio({ notebookId, selected, loadDocs }: { notebookId: string; selected: Source[]; loadDocs: () => Promise<SourceDoc[]> }) {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const version = useApp((s) => s.version);
  const bump = useApp((s) => s.bump);
  const [length, setLength] = useState<AudioLength>('short');
  const [format, setFormat] = useState<'narration' | 'dialogue'>('narration');
  const [audioLang, setAudioLang] = useState<string>(lang);
  const [focus, setFocus] = useState('');
  const [phase, setPhase] = useState<'idle' | 'script' | 'tts'>('idle');
  const [error, setError] = useState('');
  const [ttsAvailable, setTtsAvailable] = useState<{ tts: boolean; multi: boolean } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const { data: overviews } = useAsync(() => repos().notebooks.audioOverviews(notebookId), [notebookId, version]);

  useEffect(() => {
    void activeProvider().then((p) => setTtsAvailable({ tts: !!p?.capabilities.tts && !!p.speech, multi: !!p?.capabilities.multiSpeakerTts }));
  }, [version]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const generate = async () => {
    if (!selected.length) return setError(t('nb.noSelected'));
    setError('');
    const c = new AbortController();
    ctrl.current = c;
    try {
      const provider = await providerWithConsent();
      setPhase('script');
      const docs = await loadDocs();
      const script = await generateAudioScript(provider, docs, { lang: audioLang, length, format, focus: focus.trim() || undefined, signal: c.signal });
      let attachmentId: string | null = null;
      let providerName = 'system-voice';
      if (provider.speech && provider.capabilities.tts) {
        setPhase('tts');
        const speech = await provider.speech(
          script.map((l) => ({ speaker: Number(l.speaker), text: l.text })),
          audioLang,
          c.signal,
        );
        const name = `audio-overview-${Date.now()}.wav`;
        const key = await blobStore.put(name, speech.bytes);
        const att = await repos().attachments.create({
          workspace_id: wsId(),
          file_name: name,
          mime: speech.mime,
          size: speech.bytes.byteLength,
          storage_key: key,
          sha256: await sha256Hex(speech.bytes),
        });
        attachmentId = att.id;
        providerName = `${provider.label} · ${provider.config.ttsModel}`;
      }
      await repos().notebooks.addAudioOverview({
        notebook_id: notebookId,
        title: `${t('audio.title')} · ${new Date().toLocaleString(lang)}`,
        language: audioLang,
        length,
        format,
        script,
        attachment_id: attachmentId,
        provider: providerName,
        source_ids: selected.map((s) => s.id),
      });
      bump();
    } catch (e) {
      if (!c.signal.aborted) setError(errorMessage(e));
    } finally {
      setPhase('idle');
    }
  };

  return (
    <div className="rounded-xl border border-line bg-elevated p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Headphones className="size-4 text-accent" /> {t('audio.title')}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          ariaLabel={t('audio.length')}
          value={length}
          onChange={setLength}
          className="h-8 text-xs"
          options={[
            { value: 'short', label: t('audio.short') },
            { value: 'medium', label: t('audio.medium') },
            { value: 'long', label: t('audio.long') },
          ]}
        />
        <Select
          ariaLabel={t('audio.format')}
          value={format}
          onChange={setFormat}
          className="h-8 text-xs"
          options={[
            { value: 'narration', label: t('audio.narration') },
            { value: 'dialogue', label: t('audio.dialogue') },
          ]}
        />
        <Select
          ariaLabel={t('audio.language')}
          value={audioLang}
          onChange={setAudioLang}
          className="h-8 text-xs"
          options={[
            { value: 'en', label: 'English' },
            { value: 'tr', label: 'Türkçe' },
          ]}
        />
        <Input className="h-8 text-xs" placeholder={t('audio.focus')} value={focus} onChange={(e) => setFocus(e.target.value)} />
      </div>
      {ttsAvailable && !ttsAvailable.tts && (
        <p className="mt-2 flex gap-1.5 text-[11px] text-muted">
          <Info className="mt-0.5 size-3 shrink-0" /> {format === 'dialogue' ? t('audio.dialogueUnsupported') : t('audio.noTts')}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="primary" className="flex-1" loading={phase !== 'idle'} onClick={() => void generate()} disabled={phase !== 'idle'}>
          {phase === 'script' ? t('audio.scripting') : phase === 'tts' ? t('audio.synthesizing') : t('audio.generate')}
        </Button>
        {phase !== 'idle' && (
          <Button size="sm" onClick={() => ctrl.current?.abort()}>
            {t('common.stop')}
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
      <div className="mt-3 space-y-3">
        {overviews?.map((o) => <AudioPlayer key={o.id} o={o} />)}
      </div>
    </div>
  );
}

function AudioPlayer({ o }: { o: AudioOverview }) {
  const t = useT();
  const bump = useApp((s) => s.bump);
  const [url, setUrl] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [showScript, setShowScript] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [sysState, setSysState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [line, setLine] = useState(-1);

  useEffect(() => {
    let revoke: string | null = null;
    if (o.attachment_id)
      void repos()
        .attachments.get(o.attachment_id)
        .then(async (a) => {
          if (!a) return;
          const bytes = await blobStore.get(a.storage_key);
          revoke = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime }));
          setUrl(revoke);
        });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    };
  }, [o.attachment_id]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, url]);

  /** System voice fallback: reads the script with the OS speech engine. */
  const speakFrom = (idx: number) => {
    if (typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(o.language));
    const play = (i: number) => {
      if (i >= o.script.length) {
        setSysState('stopped');
        setLine(-1);
        return;
      }
      const u = new SpeechSynthesisUtterance(o.script[i].text);
      u.lang = o.language === 'tr' ? 'tr-TR' : 'en-US';
      u.rate = speed;
      // Alternate voices for dialogue when the system has more than one.
      const v = voices[Number(o.script[i].speaker) % Math.max(1, voices.length)];
      if (v) u.voice = v;
      u.onstart = () => setLine(i);
      u.onend = () => play(i + 1);
      speechSynthesis.speak(u);
    };
    setSysState('playing');
    play(idx);
  };

  return (
    <div className="rounded-lg border border-line p-2.5">
      <div className="mb-1 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{o.title}</div>
          <div className="text-[11px] text-faint">
            {o.format === 'dialogue' ? t('audio.dialogue') : t('audio.narration')} · {o.provider} · {t('audio.attribution', { n: o.source_ids.length })}
          </div>
        </div>
        <IconButton
          size="sm"
          label={t('common.delete')}
          onClick={async () => {
            await repos().notebooks.removeAudioOverview(o.id);
            bump();
          }}
        >
          <Trash2 className="size-3.5" />
        </IconButton>
      </div>
      {url ? (
        <audio ref={audioRef} src={url} controls className="h-9 w-full" />
      ) : (
        <div className="flex items-center gap-1">
          {sysState === 'playing' ? (
            <IconButton label="Pause" onClick={() => (speechSynthesis.pause(), setSysState('paused'))}>
              <Pause className="size-4" />
            </IconButton>
          ) : (
            <IconButton label="Play" onClick={() => (sysState === 'paused' ? (speechSynthesis.resume(), setSysState('playing')) : speakFrom(0))}>
              <Play className="size-4" />
            </IconButton>
          )}
          <IconButton label={t('common.stop')} onClick={() => (speechSynthesis.cancel(), setSysState('stopped'), setLine(-1))}>
            <Square className="size-3.5" />
          </IconButton>
          <span className="flex-1 text-[11px] text-faint">{t('audio.systemVoice')}</span>
        </div>
      )}
      <div className="mt-1 flex items-center gap-1">
        <span className="text-[11px] text-faint">{t('audio.speed')}</span>
        {SPEEDS.map((s) => (
          <button key={s} onClick={() => setSpeed(s)} className={cx('rounded px-1.5 text-[11px]', s === speed ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover')}>
            {s}×
          </button>
        ))}
        <span className="flex-1" />
        {url && (
          <IconButton
            size="sm"
            label={t('audio.exportFile')}
            onClick={async () => {
              const a = await repos().attachments.get(o.attachment_id!);
              if (a) await saveFile(a.file_name, await blobStore.get(a.storage_key), [{ name: 'WAV audio', extensions: ['wav'] }]);
            }}
          >
            <Download className="size-3.5" />
          </IconButton>
        )}
        <button className="text-[11px] text-accent hover:underline" onClick={() => setShowScript((v) => !v)}>
          {t('audio.transcript')}
        </button>
      </div>
      {showScript && (
        <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-md bg-inset p-2 text-xs">
          {o.script.map((l, i) => (
            <p key={i} className={cx(line === i && 'rounded bg-accent-soft')}>
              {o.format === 'dialogue' && <b className="text-accent">{l.speaker === '1' ? 'B' : 'A'}: </b>}
              {l.text}
            </p>
          ))}
        </div>
      )}
      {!url && sysState === 'stopped' && line === -1 && <span className="sr-only"><Spinner /></span>}
    </div>
  );
}
