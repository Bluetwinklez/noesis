// Noesis Web Clipper: reads the active tab (selection or main content) and saves it
// through the local Noesis endpoint (http://127.0.0.1:<port>/mcp, bearer key).
const api = globalThis.browser ?? globalThis.chrome;
const $ = (id) => document.getElementById(id);
const status = (text, cls = '') => Object.assign($('status'), { textContent: text, className: `status ${cls}` });

/** Runs inside the page: returns the selection, or the main content with clutter removed. */
function capture() {
  const sel = getSelection();
  let root;
  let selection = false;
  if (sel && !sel.isCollapsed && sel.toString().trim()) {
    root = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) root.append(sel.getRangeAt(i).cloneContents());
    selection = true;
  } else {
    const main = document.querySelector('article') || document.querySelector('main, [role=main]') || document.body;
    root = main.cloneNode(true);
    root.querySelectorAll('script, style, noscript, nav, header, footer, aside, form, iframe, button, svg, [aria-hidden=true], [role=navigation], [role=banner], [role=complementary]').forEach((n) => n.remove());
  }
  // Make links and images absolute so they still work inside Noesis.
  root.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', a.href));
  root.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src;
    if (src && /^https?:/.test(src)) img.setAttribute('src', src);
    else img.remove();
    img.removeAttribute('srcset');
  });
  return { title: document.title, url: location.href, html: root.innerHTML.slice(0, 2_500_000), selection };
}

async function settings() {
  const s = await api.storage.local.get(['key', 'port']);
  return { key: s.key || '', port: Number(s.port) || 47816 };
}

async function rpc(port, key, session, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (session) headers['Mcp-Session-Id'] = session;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...body }) });
  if (res.status === 401) throw new Error('The key is not accepted. Copy it again from Noesis.');
  if (!res.ok) throw new Error(`Noesis answered ${res.status}.`);
  return { json: await res.json(), session: res.headers.get('Mcp-Session-Id') };
}

async function save(page) {
  const { key, port } = await settings();
  let session = null;
  try {
    const init = await rpc(port, key, null, { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'noesis-web-clipper', title: 'Web clipper', version: '1.0.0' } } });
    session = init.session;
  } catch (e) {
    if (e instanceof TypeError) throw new Error('Noesis is not reachable. Open Noesis and turn on Settings → AI connections.');
    throw e;
  }
  const { json } = await rpc(port, key, session, { id: 2, method: 'tools/call', params: { name: 'clip_web_page', arguments: page } });
  if (json.error) throw new Error(json.error.message);
  if (json.result?.isError) throw new Error(json.result.content?.[0]?.text || 'Noesis could not save the page.');
}

async function main() {
  const { key } = await settings();
  if (!key) return showSetup();
  $('clip').hidden = false;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  let page;
  try {
    const [res] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: capture });
    page = res.result;
  } catch {
    $('save').disabled = true;
    return status('This page cannot be clipped (browser pages and the extension store are protected).', 'err');
  }
  $('title').value = page.title || tab.title || 'Web clip';
  $('what').textContent = page.selection ? 'Saves the selected part of the page.' : 'Saves the main content of the page.';
  $('save').onclick = async () => {
    $('save').disabled = true;
    status('Saving…');
    try {
      // Firefox grants host access on request; Chrome already has it from the manifest.
      await api.permissions?.request?.({ origins: ['http://127.0.0.1/*'] }).catch(() => true);
      await save({ title: $('title').value.trim() || page.title, url: page.url, html: page.html });
      status('Saved to Noesis → Web clips.', 'ok');
      setTimeout(() => window.close(), 1200);
    } catch (e) {
      status(e.message || String(e), 'err');
      $('save').disabled = false;
    }
  };
  $('settings').onclick = showSetup;
}

async function showSetup() {
  const { key, port } = await settings();
  $('clip').hidden = true;
  $('setup').hidden = false;
  $('key').value = key;
  $('port').value = String(port);
  $('saveSettings').onclick = async () => {
    const k = $('key').value.trim();
    if (k.length < 32) return status('Paste the full key from Noesis.', 'err');
    await api.storage.local.set({ key: k, port: Number($('port').value) || 47816 });
    $('setup').hidden = true;
    status('');
    main();
  };
}

main().catch((e) => status(String(e), 'err'));
