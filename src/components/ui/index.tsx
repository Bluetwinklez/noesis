import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { create } from 'zustand';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong shadow-sm',
  secondary: 'bg-elevated border border-line-strong text-fg hover:bg-hover shadow-sm',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  subtle: 'bg-hover text-fg hover:bg-active',
  danger: 'bg-danger text-white hover:opacity-90',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors select-none whitespace-nowrap',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-7 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }>(
  function IconButton({ label, active, className, children, size = 'md', ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cx(
          'inline-flex items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40',
          size === 'sm' ? 'size-6' : 'size-8',
          active && 'bg-active text-fg',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={cx(
        'h-9 w-full rounded-lg border border-line-strong bg-elevated px-3 text-sm text-fg placeholder:text-faint',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(
        'w-full rounded-lg border border-line-strong bg-elevated px-3 py-2 text-sm text-fg placeholder:text-faint',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft',
        className,
      )}
      {...rest}
    />
  );
});

export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cx(
        'h-9 rounded-lg border border-line-strong bg-elevated px-2.5 text-sm text-fg focus:border-accent focus:outline-none',
        className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-active border border-line-strong')}
    >
      <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('size-4 animate-spin text-muted', className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-inset px-1 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

export function Badge({ children, color = 'gray', className }: { children: ReactNode; color?: string; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium', tagColor(color), className)}>{children}</span>;
}

const TAG_COLORS: Record<string, string> = {
  gray: 'bg-neutral-500/12 text-neutral-700 dark:text-neutral-300',
  blue: 'bg-blue-500/14 text-blue-700 dark:text-blue-300',
  green: 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-300',
  amber: 'bg-amber-500/16 text-amber-800 dark:text-amber-300',
  red: 'bg-red-500/14 text-red-700 dark:text-red-300',
  violet: 'bg-violet-500/14 text-violet-700 dark:text-violet-300',
  pink: 'bg-pink-500/14 text-pink-700 dark:text-pink-300',
  teal: 'bg-teal-500/14 text-teal-700 dark:text-teal-300',
};
export const TAG_COLOR_NAMES = Object.keys(TAG_COLORS);
export function tagColor(c: string) {
  return TAG_COLORS[c] ?? TAG_COLORS.gray;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center animate-in">
      {icon && <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">{icon}</div>}
      <div className="text-[15px] font-semibold">{title}</div>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/8 p-3 text-sm text-danger">
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers often pass a new onClose on every render; the effect below must run only
  // when the dialog opens, or each keystroke would re-run it and move focus away.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Initial focus: a field marked data-autofocus, else the first field. Never take focus
    // away from something the user (or the dialog's content) already focused inside.
    const timer = setTimeout(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('input, textarea, select, button'))?.focus();
    }, 10);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-6 pt-[10vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="flex max-h-[80vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-elevated shadow-pop animate-in"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="text-[15px] font-semibold">{title}</div>
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line bg-inset/50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------- Popover menu ----------
export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  separator?: boolean;
  checked?: boolean;
}

export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = 'start',
  className,
}: {
  anchor: HTMLElement | DOMRect | null;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const el = ref.current;
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 200;
    let left = align === 'end' ? r.right - w : r.left;
    let top = r.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    left = Math.min(Math.max(8, left), window.innerWidth - w - 8);
    setPos({ top, left });
  }, [open, anchor, align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(anchor instanceof HTMLElement && anchor.contains(e.target as Node))) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className={cx('fixed z-[60] min-w-[200px] rounded-lg border border-line bg-elevated p-1 shadow-pop animate-in', className)}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [active, setActive] = useState(-1);
  const enabled = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.focus();
  }, []);
  return (
    <div
      ref={listRef}
      role="menu"
      tabIndex={-1}
      className="outline-none"
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const idx = enabled.indexOf(active);
          const next = e.key === 'ArrowDown' ? enabled[(idx + 1) % enabled.length] : enabled[(idx - 1 + enabled.length) % enabled.length];
          setActive(next);
        } else if (e.key === 'Enter' && active >= 0) {
          e.preventDefault();
          items[active].onSelect?.();
          onClose();
        }
      }}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              it.onSelect?.();
              onClose();
            }}
            className={cx(
              'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] disabled:opacity-40',
              active === i ? 'bg-hover' : '',
              it.danger ? 'text-danger' : 'text-fg',
            )}
          >
            <span className="flex size-4 items-center justify-center text-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.checked && <span className="text-accent">✓</span>}
            {it.hint && <span className="text-xs text-faint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Button that opens a menu. */
export function MenuButton({ items, children, label, align = 'start', className }: { items: MenuItem[] | (() => MenuItem[]); children: ReactNode; label: string; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button
        ref={btn}
        aria-label={label}
        title={open ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cx('inline-flex items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg', className ?? 'size-8')}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {children}
      </button>
      <Popover anchor={btn.current} open={open} onClose={close} align={align}>
        <MenuList items={typeof items === 'function' ? items() : items} onClose={close} />
      </Popover>
    </>
  );
}

// ---------- Prompt / confirm dialogs (promise based) ----------
interface DialogState {
  kind: 'confirm' | 'prompt' | null;
  title: string;
  body?: string;
  defaultValue?: string;
  danger?: boolean;
  confirmLabel?: string;
  resolve?: (v: string | boolean | null) => void;
}
const useDialog = create<DialogState>(() => ({ kind: null, title: '' }));

export function confirmDialog(title: string, body?: string, opts: { danger?: boolean; confirmLabel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ kind: 'confirm', title, body, ...opts, resolve: (v) => resolve(!!v) }));
}

export function promptDialog(title: string, defaultValue = '', body?: string): Promise<string | null> {
  return new Promise((resolve) =>
    useDialog.setState({ kind: 'prompt', title, body, defaultValue, danger: false, confirmLabel: undefined, resolve: (v) => resolve(typeof v === 'string' ? v : null) }),
  );
}

export function DialogHost({ labels }: { labels: { ok: string; cancel: string } }) {
  const st = useDialog();
  const [value, setValue] = useState('');
  useEffect(() => {
    setValue(st.defaultValue ?? '');
  }, [st.defaultValue, st.kind]);
  const close = (v: string | boolean | null) => {
    st.resolve?.(v);
    useDialog.setState({ kind: null, resolve: undefined });
  };
  return (
    <Modal
      open={!!st.kind}
      onClose={() => close(st.kind === 'prompt' ? null : false)}
      title={st.title}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(st.kind === 'prompt' ? null : false)}>
            {labels.cancel}
          </Button>
          <Button variant={st.danger ? 'danger' : 'primary'} onClick={() => close(st.kind === 'prompt' ? value : true)}>
            {st.confirmLabel ?? labels.ok}
          </Button>
        </>
      }
    >
      {st.body && <p className="mb-3 text-sm text-muted">{st.body}</p>}
      {st.kind === 'prompt' && (
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') close(value);
          }}
        />
      )}
    </Modal>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('inline-flex items-center gap-0.5 rounded-lg bg-hover p-0.5', className)}>
      {tabs.map((tb) => (
        <button
          key={tb.value}
          role="tab"
          aria-selected={value === tb.value}
          onClick={() => onChange(tb.value)}
          className={cx(
            'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors',
            value === tb.value ? 'bg-elevated text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

/** Loads async data and reloads when deps or the global data version change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error) => alive && setState({ data: undefined, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, reload: () => setN((x) => x + 1) };
}

export function PageHeader({ icon, title, subtitle, actions }: { icon?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && <div className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>}
        <div>
          <h1 className="font-display text-[26px] font-bold tracking-tight">{title}</h1>
          {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton h-4', className)} />;
}
