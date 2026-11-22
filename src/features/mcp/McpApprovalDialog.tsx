import { Bot } from 'lucide-react';
import { useMcpApprovals } from '../../mcp/host';
import type { ApprovalRequest } from '../../mcp/server';
import { useT, type MessageKey } from '../../i18n';
import { Button, Modal } from '../../components/ui';

type Translator = (key: MessageKey, vars?: Record<string, string | number>) => string;

const BODY_KEYS: Record<string, MessageKey> = {
  replace: 'mcp.approve.body.replace',
  move: 'mcp.approve.body.move',
  rename: 'mcp.approve.body.rename',
  trash: 'mcp.approve.body.trash',
  merge: 'mcp.approve.body.merge',
};
const bodyKey = (action: string): MessageKey => BODY_KEYS[action] ?? 'mcp.approve.body';

export function formatApprovalBody(req: ApprovalRequest, t: Translator): string {
  if (req.detail?.kind === 'replace' && req.detail.titleFrom !== undefined && req.detail.titleTo !== undefined) {
    return t('mcp.approve.body.replaceWithTitle', {
      client: req.client,
      page: req.detail.titleFrom,
      title: req.detail.titleTo,
    });
  }
  return t(bodyKey(req.action), { client: req.client, page: req.target });
}

export function formatApprovalPreview(req: ApprovalRequest, t: Translator): string {
  const d = req.detail;
  if (!d) return req.preview;
  switch (d.kind) {
    case 'move':
      return d.parent !== null ? t('mcp.approve.preview.moveUnder', { parent: d.parent }) : t('mcp.approve.preview.moveRoot');
    case 'rename':
      return t('mcp.approve.preview.rename', { from: d.from, to: d.to });
    case 'trash':
      return d.subpages === 0
        ? t('mcp.approve.preview.trash', { page: req.target, n: 0 })
        : t('mcp.approve.preview.trashWithSubpages', { page: req.target, n: d.subpages });
    case 'replace': {
      const body = d.body ?? req.preview;
      if (d.titleFrom !== undefined && d.titleTo !== undefined) {
        const header = t('mcp.approve.preview.titleChange', { from: d.titleFrom, to: d.titleTo });
        return body ? `${header}\n\n${body}` : header;
      }
      return body;
    }
  }
}

/** Shown when a connected AI assistant asks to change existing content. Nothing changes unless the user allows it. */
export function McpApprovalDialog() {
  const t = useT();
  const req = useMcpApprovals((s) => s.queue[0]);
  if (!req) return null;
  return (
    <Modal
      open
      onClose={() => req.resolve(false)}
      width={560}
      title={
        <span className="flex items-center gap-2">
          <Bot className="size-4 text-accent" />
          {t('mcp.approve.title', { client: req.client })}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => req.resolve(false)}>
            {t('mcp.approve.deny')}
          </Button>
          <Button variant="primary" onClick={() => req.resolve(true)}>
            {t('mcp.approve.allow')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{formatApprovalBody(req, t)}</p>
      <pre aria-label={t('mcp.approve.preview')} className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg p-3 font-sans text-sm">
        {formatApprovalPreview(req, t)}
      </pre>
    </Modal>
  );
}
