import { Bot } from 'lucide-react';
import { useMcpApprovals } from '../../mcp/host';
import { useT } from '../../i18n';
import { Button, Modal } from '../../components/ui';

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
      <p className="text-sm text-muted">{t('mcp.approve.body', { client: req.client, page: req.target })}</p>
      <pre aria-label={t('mcp.approve.preview')} className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-bg p-3 font-sans text-sm">
        {req.preview}
      </pre>
    </Modal>
  );
}
