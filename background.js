// background.js (Service Worker)

const DEFAULT_CONFIG = {
  targetLanguage: 'zh-CN',
  triggerMode: 'hover', // 'hover' | 'click'
  contextLength: 30 // 前后各30字符，兼顾准确与token消耗
};

async function getStoredConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => resolve(items));
  });
}

async function getEnv() {
  try {
    const url = chrome.runtime.getURL('env.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error('ENV_NOT_FOUND');
    const json = await res.json();
    return json; // { DEEPSEEK_API_BASE, DEEPSEEK_MODEL, DEEPSEEK_API_KEY }
  } catch (e) {
    return null;
  }
}

function buildPrompt({ selection, pre, post, targetLanguage }) {
  const instructions = `你是一个专业的双语语境分析助手。仅根据下面以严格XML标签包裹的内容进行判断与翻译。\n- 若选中内容为句子或包含多个子句，请完整翻译“选中内容”的全部文本，不得省略任何部分；\n- 若选中内容为词或短语，请给出语境下更自然的译法，并补充直译以供参考；\n请识别是否为习语/隐喻/军事术语等，并优先返回符合语境的译法。严格输出 JSON（仅 JSON，无额外文本）：{\n  "full_translation": 对选中内容（若为句子/多子句）进行完整且忠实的${targetLanguage}翻译（不得缺漏、不得只翻译其中一部分）,\n  "contextual_translation": 在当前语境下更自然且符合真实用法的${targetLanguage}译法（词/短语时优先显示；若与full相同可重复）,\n  "literal_translation": 若存在直译，请给出直译（如不适用可为空字符串）,\n  "meaning_in_context": 简明解释其在当前语境中的含义/用法,\n  "part_of_speech_or_type": 词性或短语类型（如习语/比喻/军事术语等，可选）,\n  "tone_or_register": 语气或语域（如正式/口语/新闻等，可选）,\n  "example_in_cn": 一个简短中文例句（如目标语言不是中文，可选）,\n  "flags": { "is_idiom": 布尔值, "is_metaphorical": 布尔值 },\n  "confidence": 0-1 的语境判断信心（可选）\n}`;
  const content = [
    '<task>',
    `<target_language>${targetLanguage}</target_language>`,
    '<selection><![CDATA[', selection, ']]></selection>',
    '<context>',
    '<pre><![CDATA[', pre, ']]></pre>',
    '<post><![CDATA[', post, ']]></post>',
    '</context>',
    '</task>'
  ].join('');
  return { instructions, content };
}

async function callDeepseek({ selection, pre, post, targetLanguage }) {
  const env = await getEnv();
  if (!env || !env.DEEPSEEK_API_BASE || !env.DEEPSEEK_MODEL || !env.DEEPSEEK_API_KEY) {
    return { error: '未配置或缺少 env.json（DEEPSEEK_API_BASE / MODEL / API_KEY）' };
  }

  const { instructions, content } = buildPrompt({ selection, pre, post, targetLanguage });

  const url = `${env.DEEPSEEK_API_BASE.replace(/\/$/, '')}/v1/chat/completions`;

  const body = {
    model: env.DEEPSEEK_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      return { error: `接口错误: ${res.status} ${text}` };
    }

    const data = await res.json();
    const contentText = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';

    let parsed;
    try {
      const match = contentText.match(/```json[\s\S]*?```/);
      const jsonStr = match ? match[0].replace(/```json|```/g, '').trim() : contentText.trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      parsed = { translation: contentText, meaning_in_context: contentText };
    }

    const usage = data?.usage || null; // 兼容常见响应的usage结构
    let cost = null;
    const promptPrice = parseFloat(env.PRICE_PROMPT_PER_1K);
    const completionPrice = parseFloat(env.PRICE_COMPLETION_PER_1K);
    if (usage && !Number.isNaN(promptPrice) && !Number.isNaN(completionPrice)) {
      const p = usage.prompt_tokens || 0;
      const c = usage.completion_tokens || 0;
      cost = Number(((p / 1000) * promptPrice + (c / 1000) * completionPrice).toFixed(6));
    }

    return { data: parsed, usage, cost, currency: env.CURRENCY || 'USD' };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') return { error: '请求超时' };
    return { error: `网络错误: ${e.message}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'TRANSLATE') {
      const cfg = await getStoredConfig();
      const targetLanguage = msg.targetLanguage || cfg.targetLanguage || DEFAULT_CONFIG.targetLanguage;
      const result = await callDeepseek({
        selection: msg.selection,
        pre: msg.pre,
        post: msg.post,
        targetLanguage
      });
      sendResponse(result);
    } else if (msg?.type === 'GET_CONFIG') {
      const cfg = await getStoredConfig();
      sendResponse(cfg);
    } else if (msg?.type === 'PING') {
      sendResponse({ ok: true });
    }
  })();
  return true; // 异步响应
});

// 处理快捷键 Alt+T
chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'trigger-translate') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SHORTCUT' });
      }
    } catch (e) {
      // 静默失败
    }
  }
});