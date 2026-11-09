// ตัวเรียก AI หลายค่าย (ใช้ fetch ของ Node ไม่ต้องใช้ SDK): Claude · ChatGPT (OpenAI) · Gemini
// key อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น (env) — หน้าเว็บเห็นแค่ว่าค่ายไหน "พร้อมใช้" แล้วเลือกเองได้
// ไม่มี key เลย หรือสั่ง MOCK=1 → ใช้โหมดจำลอง

export type Provider = 'anthropic' | 'openai' | 'gemini';
export type ProviderChoice = Provider | 'mock';
export const PROVIDER_IDS: Provider[] = ['anthropic', 'openai', 'gemini'];

// key ที่ยังเป็นข้อความตัวอย่าง (มีตัวอักษรนอก ASCII เช่น "ใส่คีย์ของคุณ") นับว่ายังไม่ได้ตั้ง
const clean = (v?: string) => { const t = (v ?? '').trim(); return /^[\x21-\x7e]+$/.test(t) ? t : ''; };
const keyOf: Record<Provider, () => string> = {
  anthropic: () => clean(process.env.ANTHROPIC_API_KEY),
  openai: () => clean(process.env.OPENAI_API_KEY),
  gemini: () => clean(process.env.GEMINI_API_KEY) || clean(process.env.GOOGLE_API_KEY),
};
const modelOf: Record<Provider, () => string> = {
  anthropic: () => process.env.MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  openai: () => process.env.OPENAI_MODEL ?? 'gpt-4.1',
  gemini: () => process.env.GEMINI_MODEL ?? 'gemini-3.5-flash',
};
const LABEL: Record<Provider, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };

export interface ProviderInfo { id: ProviderChoice; label: string; model: string; ready: boolean }

const FORCE_MOCK = process.env.MOCK === '1';

export function listProviders(): ProviderInfo[] {
  const real = PROVIDER_IDS.map((id) => ({
    id, label: LABEL[id], model: modelOf[id](), ready: !FORCE_MOCK && !!keyOf[id](),
  }));
  return [...real, { id: 'mock', label: 'จำลอง (ไม่เรียก AI จริง)', model: '', ready: true }];
}

/** ค่ายเริ่มต้น: ตัวแรกที่มี key (หรือ mock ถ้าไม่มีเลย) */
export function defaultProvider(): ProviderChoice {
  return listProviders().find((p) => p.ready && p.id !== 'mock')?.id ?? 'mock';
}

export function isReady(choice: string): choice is ProviderChoice {
  return listProviders().some((p) => p.id === choice && p.ready);
}

const TIMEOUT = 5 * 60 * 1000;

async function post(url: string, headers: Record<string, string>, body: unknown, name: string): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`${name} API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export async function ask(provider: Provider, system: string, user: string, maxTokens = 8000): Promise<string> {
  const key = keyOf[provider]();
  if (!key) throw new Error(`ยังไม่ได้ตั้ง API key ของ ${LABEL[provider]}`);
  const model = modelOf[provider]();

  if (provider === 'anthropic') {
    const d = (await post('https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, 'Claude')) as { content?: { text?: string }[] };
    return (d.content ?? []).map((b) => b.text ?? '').join('');
  }

  if (provider === 'openai') {
    const d = (await post('https://api.openai.com/v1/chat/completions',
      { authorization: `Bearer ${key}` },
      { model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, 'OpenAI')) as { choices?: { message?: { content?: string } }[] };
    return d.choices?.[0]?.message?.content ?? '';
  }

  const d = (await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': key },
    { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }, 'Gemini')) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}
