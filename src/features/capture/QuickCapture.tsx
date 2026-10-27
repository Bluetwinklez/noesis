import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Zap } from 'lucide-react';
import { repos, useApp, wsId } from '../../app/state';
import { reportError } from '../../app/services';
import { isTauri } from '../../lib/platform';
import { useT, t as translate } from '../../i18n';
import { Button, Input, Kbd, Modal, Textarea } from '../../components/ui';

export const useQuickCapture = create<{ open: boolean }>(() => ({ open: false }));
export const openQuickCapture = () => useQuickCapture.setState({ open: true });

/** Notes captured quickly land under one "Inbox" page per workspace (created on first use). */
async function inboxPage(): Promise<string> {
  const r = repos();
  const key = `inboxPage:${wsId()}`;
  const id = await r.settings.get<string | null>(key, null);
  const existing = id ? await r.pages.get(id) : null;
  if (existing && !existing.deleted_at) return existing.id;
  const page = await r.pages.create({ workspaceId: wsId(), title: translate('capture.inbox'), icon: '📥' });
  await r.settings.set(key, page.id);
  return page.id;
}

export async function saveQuickNote(title: string, body: string): Promise<string> {
  const firstLine = body.trim().split('\n')[0]?.replace(/^#+\s*/, '').slice(0, 80) ?? '';
  const name = title.trim() || firstLine || new Date().toLocaleString();
  const r = repos();
  const page = await r.pages.create({ workspaceId: wsId(), parentId: await inboxPage(), title: name });
  if (body.trim()) {
    const [{ htmlToDoc }, { markdownToHtml }] = await Promise.all([import('../../editor/serialize'), import('../../editor/markdown')]);
    await r.pages.saveContent(page.id, htmlToDoc(markdownToHtml(body)));
  }
  return page.id;
}

/** Global quick-capture box: Ctrl+Shift+Space anywhere in Windows (desktop) or the tray icon. */
export function QuickCapture() {
  const t = useT();
  const open = useQuickCapture((s) => s.open);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // The modal focuses its first button; typing should start in the title instead.
  useEffect(() => {
    if (open) setTimeout(() => titleRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => listen('quick-capture', openQuickCapture)).then((u) => (off = u));
    return () => off?.();
  }, []);

  const close = () => {
    useQuickCapture.setState({ open: false });
    setTitle('');
    setBody('');
  };
  const busy = useRef(false);
  const saveRef = useRef<(openAfter?: boolean) => Promise<void>>(async () => {});
  // Ctrl+Enter saves wherever focus is inside the dialog (the modal may move focus to its header).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const save = async (openAfter = false) => {
    if (busy.current) return;
    if (!title.trim() && !body.trim()) return close();
    busy.current = true;
    setSaving(true);
    try {
      const id = await saveQuickNote(title, body);
      useApp.getState().bump();
      useApp.getState().toast(t('capture.saved'), 'success');
      close();
      if (openAfter) useApp.getState().navigate({ name: 'page', id });
    } catch (e) {
      reportError(e);
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  saveRef.current = save;
  if (!open) return null;
  return (
    <Modal
      open
      onClose={close}
      width={560}
      title={
        <span className="flex items-center gap-2">
          <Zap className="size-4 text-accent" />
          {t('capture.title')}
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-xs text-faint">
            <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> {t('capture.saveHint')}
          </span>
          <Button variant="ghost" onClick={() => void save(true)} disabled={saving}>
            {t('capture.saveOpen')}
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            {t('capture.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('capture.titlePlaceholder')} aria-label={t('capture.titlePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && !e.ctrlKey && (e.preventDefault(), bodyRef.current?.focus())} />
        <Textarea ref={bodyRef} rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('capture.bodyPlaceholder')} aria-label={t('capture.bodyPlaceholder')} />
      </div>
    </Modal>
  );
}
