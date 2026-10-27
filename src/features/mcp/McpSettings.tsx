import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Unlink } from 'lucide-react';
import { useApp } from '../../app/state';
import { reportError } from '../../app/services';
import { isTauri } from '../../lib/platform';
import { useT } from '../../i18n';
import { Badge, Button, Switch } from '../../components/ui';
import { connectClient, listClients, mcpStatus, setMcpEnabled, type ClientTarget, type McpStatus } from '../../mcp/host';
import { toolList } from '../../mcp/server';

function CopyBox({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-line bg-bg p-2">
      <code aria-label={label} className="min-w-0 flex-1 break-all text-xs">
        {text}
      </code>
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {t('mcp.copy')}
      </Button>
    </div>
  );
}

/** Settings → AI connections: lets assistants such as Claude or Cursor use this workspace through MCP. */
export function McpSettings() {
  const t = useT();
  const enabled = useApp((s) => s.prefs.mcpEnabled);
  const toast = useApp((s) => s.toast);
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [clients, setClients] = useState<ClientTarget[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    setStatus(await mcpStatus());
    setClients(await listClients());
  };
  useEffect(() => {
    if (isTauri()) void refresh().catch(reportError);
  }, []);

  if (!isTauri())
    return (
      <section className="space-y-2 text-sm">
        <p className="text-muted">{t('mcp.desktopOnly')}</p>
      </section>
    );

  const exe = status?.exe ?? '';
  const stdioJson = JSON.stringify({ mcpServers: { noesis: { command: exe, args: ['--mcp'] } } }, null, 2);

  return (
    <section className="space-y-5 text-sm">
      <p className="text-muted">{t('mcp.intro')}</p>
      <div className="flex items-center justify-between gap-4 rounded-md border border-line p-3">
        <div>
          <div className="font-medium">{t('mcp.enable')}</div>
          <div className="text-xs text-muted">
            {status?.running ? t('mcp.running', { port: status.port ?? '' }) : t('mcp.stopped')}
          </div>
        </div>
        <Switch
          checked={enabled}
          label={t('mcp.enable')}
          onChange={(v) => {
            setBusy('toggle');
            void setMcpEnabled(v)
              .then(setStatus)
              .catch(reportError)
              .finally(() => setBusy(null));
          }}
        />
      </div>

      <div>
        <h3 className="mb-2 font-medium">{t('mcp.clients')}</h3>
        <ul className="divide-y divide-line rounded-md border border-line">
          {clients.map((c) => (
            <li key={c.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {c.name}
                  {c.connected && <Badge color="green">{t('mcp.connected')}</Badge>}
                  {!c.installed && <Badge>{t('mcp.notInstalled')}</Badge>}
                </div>
                {c.path && <div className="truncate text-xs text-faint">{c.path}</div>}
              </div>
              <Button
                variant={c.connected ? 'ghost' : 'primary'}
                disabled={!c.installed || !enabled || busy !== null}
                onClick={() => {
                  setBusy(c.id);
                  void connectClient(c.id, !c.connected)
                    .then(() => {
                      toast(c.connected ? t('mcp.disconnectedToast', { client: c.name }) : t('mcp.connectedToast', { client: c.name }), 'success');
                      return refresh();
                    })
                    .catch(reportError)
                    .finally(() => setBusy(null));
                }}
              >
                {c.connected ? <Unlink className="size-3.5" /> : <Link2 className="size-3.5" />}
                {c.connected ? t('mcp.disconnect') : t('mcp.connect')}
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">{t('mcp.restartHint')}</p>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium">Claude Code</h3>
        <CopyBox label="Claude Code" text={`claude mcp add noesis -s user -- "${exe}" --mcp`} />
      </div>
      <div className="space-y-2">
        <h3 className="font-medium">{t('mcp.other')}</h3>
        <p className="text-xs text-muted">{t('mcp.otherHint')}</p>
        <CopyBox label="JSON" text={stdioJson} />
      </div>

      <details className="rounded-md border border-line p-3">
        <summary className="cursor-pointer font-medium">{t('mcp.tools')}</summary>
        <ul className="mt-2 space-y-1">
          {toolList().map((tool) => (
            <li key={tool.name}>
              <code className="text-xs">{tool.name}</code> — <span className="text-muted">{tool.description}</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted">{t('mcp.privacy')}</p>
    </section>
  );
}
