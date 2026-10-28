// Deterministic OpenAI-compatible mock used by e2e tests and manual QA.
// It never calls the network. Usage: node scripts/mock-ai-server.mjs [port]
// Valid key: "test-key". Any other key returns HTTP 401 like a real provider.
import http from 'node:http';

const port = Number(process.argv[2] ?? process.env.MOCK_AI_PORT ?? 11435);
const VALID_KEY = 'test-key';

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function firstSourceSentence(text) {
  const m = text.match(/<source n="1"[^>]*>\n([\s\S]*?)\n<\/source>/);
  if (!m) return null;
  return m[1].split(/(?<=[.!?])\s+/).find((s) => s.trim().length > 20)?.trim() ?? m[1].slice(0, 160);
}

function answerFor(messages, json) {
  const user = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof user?.content === 'string' ? user.content : (user?.content ?? []).map((p) => p.text ?? '').join('');
  const sentence = firstSourceSentence(text);
  if (text.includes('NOESIS_UNCITED_REPLY')) return 'RuBisCO catalyses carbon fixation.';
  if (text.includes('Which city hosted the 2012 Olympics?')) return 'The selected sources do not contain information that answers this question.';
  if (json) {
    if (/flashcards/i.test(text)) return JSON.stringify({ cards: [{ front: 'What is described in source 1?', back: `${sentence ?? 'n/a'} [1]` }, { front: 'Key term?', back: 'From the sources [1]' }] });
    if (/multiple-choice/i.test(text))
      return JSON.stringify({ questions: [{ question: 'Which statement appears in the sources?', options: [sentence ?? 'A', 'Unrelated claim'], answer: 0, explanation: 'Stated in source 1 [1]' }] });
    if (/"lines"/.test(text)) return JSON.stringify({ lines: [{ speaker: 0, text: `Welcome. ${sentence ?? ''}` }, { speaker: 1, text: 'That is the key point of the sources.' }] });
    return JSON.stringify({});
  }
  if (/Reply with the single word: OK/.test(text)) return 'OK';
  if (/<content>/.test(text)) {
    const body = text.match(/<content>\n([\s\S]*?)\n<\/content>/)?.[1] ?? '';
    return `**Improved:** ${body.trim()}`;
  }
  if (sentence) return `According to the selected sources, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)} [1] This is also mentioned elsewhere [9].`;
  return 'Mock reply.';
}

function hashEmbed(t) {
  const v = new Array(64).fill(0);
  for (const w of String(t).toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % 64] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${VALID_KEY}`) return send(res, 401, { error: { message: `Incorrect API key provided: ${auth.slice(7, 12)}***`, type: 'invalid_request_error' } });
    let body = {};
    try {
      body = raw && req.headers['content-type']?.includes('json') ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: { message: 'invalid JSON' } });
    }
    if (req.url === '/v1/chat/completions') {
      const content = answerFor(body.messages ?? [], body.response_format?.type === 'json_object');
      if (!body.stream) return send(res, 200, { choices: [{ message: { role: 'assistant', content } }] });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...cors });
      const parts = content.match(/.{1,12}/gs) ?? [];
      let i = 0;
      const tick = setInterval(() => {
        if (i < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
        else {
          res.write('data: [DONE]\n\n');
          clearInterval(tick);
          res.end();
        }
      }, 15);
      return;
    }
    if (req.url === '/v1/embeddings') {
      const input = Array.isArray(body.input) ? body.input : [body.input];
      return send(res, 200, { data: input.map((t, index) => ({ index, embedding: hashEmbed(t) })) });
    }
    if (req.url === '/v1/audio/speech') {
      const samples = 24000 * 0.4;
      const pcm = Buffer.alloc(samples * 2);
      for (let s = 0; s < samples; s++) pcm.writeInt16LE(Math.round(Math.sin((s / 24000) * 2 * Math.PI * 440) * 3000), s * 2);
      res.writeHead(200, { 'Content-Type': 'audio/pcm', ...cors });
      return res.end(pcm);
    }
    if (req.url === '/v1/audio/transcriptions') return send(res, 200, { text: 'This is a mock transcript of the uploaded audio.' });
    send(res, 404, { error: { message: 'not found' } });
  });
});
server.listen(port, '127.0.0.1', () => console.log(`mock AI server on http://127.0.0.1:${port}/v1`));
