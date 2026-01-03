// background.js (Service Worker)

const DEFAULT_CONFIG = {
  targetLanguage: 'zh-CN',
  triggerMode: 'hover', // 'hover' | 'click'
  contextLength: 30, // 前后各30字符，兼顾准确与token消耗
  domain: '',
  glossary: []
};

async function getStoredConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_CONFIG, (items) => resolve(items));
  });
}

async function getLLMConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ llmProvider: 'deepseek', llmBaseUrl: 'https://api.deepseek.com', llmModel: 'deepseek-chat', llmApiKey: '', PRICE_PROMPT_PER_1K: '0', PRICE_COMPLETION_PER_1K: '0', CURRENCY: 'USD' }, (items) => resolve(items));
  });
}

function buildPrompt({ selection, pre, post, targetLanguage, domain, glossary }) {
  const domainHint = domain ? `领域:${domain}` : '';
  const glossaryHint = Array.isArray(glossary) && glossary.length
    ? `术语:${glossary.map((g) => `${g.src}=>${g.tgt}`).join(';')}`
    : '';
  const hints = [domainHint, glossaryHint].filter(Boolean);
  const wordCount = selection.trim().split(/\s+/).filter(w => w.length > 0).length;
  const isWordOrPhrase = wordCount <= 5;
  const pronunciationHint = isWordOrPhrase ? ';词/短语(≤5词)需提供音标/读音' : '';
  const instructions = `双语语境翻译助手。输出JSON:\n{\n"full_translation":"完整${targetLanguage}翻译(句子必完整)",\n"contextual_translation":"语境译法(词/短语优先)",\n"literal_translation":"直译",\n"pronunciation":"音标/读音(词/短语≤5词时必填,使用IPA或拼音)",\n"meaning_in_context":"语境含义",\n"part_of_speech_or_type":"词性/类型",\n"tone_or_register":"语气",\n"example_in_cn":"例句",\n"flags":{"is_idiom":false,"is_metaphorical":false},\n"confidence":0.9\n}\n规则:句子完整翻译;词/短语优先语境译;识别习语/隐喻${pronunciationHint}${hints.length ? ';' + hints.join(';') : ''}`;
  const parts = [
    `T:${targetLanguage}`,
    domain ? `D:${domain}` : '',
    (Array.isArray(glossary) && glossary.length) ? `G:${JSON.stringify(glossary)}` : '',
    `S:${selection}`,
    pre || post ? `C:${pre ? `P:${pre}` : ''}${pre && post ? '|' : ''}${post ? `N:${post}` : ''}` : ''
  ].filter(Boolean);
  const content = parts.join('\n');
  return { instructions, content };
}

async function callLLM({ selection, pre, post, targetLanguage, domain, glossary }) {
  const env = await getLLMConfig();
  const baseUrl = (env.llmBaseUrl || '').replace(/\/$/, '');
  const model = env.llmModel;
  const apiKey = env.llmApiKey;
  if (!baseUrl || !model || !apiKey) {
    return { error: '未在设置页配置 Base URL / Model / API Key' };
  }

  const { instructions, content } = buildPrompt({ selection, pre, post, targetLanguage, domain, glossary });
  const url = `${baseUrl}/v1/chat/completions`;
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content }
    ]
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const startTime = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
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
    if (data.error) {
      return { error: `API错误: ${data.error.message || JSON.stringify(data.error)}` };
    }
    const contentText = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
    if (!contentText || contentText.trim() === '') {
      return { error: 'API返回空内容，请检查API配置和网络连接' };
    }

    let parsed;
    try {
      const match = contentText.match(/```json[\s\S]*?```/);
      const jsonStr = match ? match[0].replace(/```json|```/g, '').trim() : contentText.trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      parsed = { translation: contentText, meaning_in_context: contentText };
    }

    const usage = data?.usage || null;
    let cost = null;
    const promptPrice = parseFloat(env.PRICE_PROMPT_PER_1K);
    const completionPrice = parseFloat(env.PRICE_COMPLETION_PER_1K);
    if (usage && !Number.isNaN(promptPrice) && !Number.isNaN(completionPrice)) {
      const p = usage.prompt_tokens || 0;
      const c = usage.completion_tokens || 0;
      cost = Number(((p / 1000) * promptPrice + (c / 1000) * completionPrice).toFixed(6));
    }
    const translationTime = Date.now() - startTime;
    return { data: parsed, usage, cost, currency: env.CURRENCY || 'USD', translationTime };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') return { error: '请求超时' };
    return { error: `网络错误: ${e.message}` };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let responded = false;
  const safeSendResponse = (response) => {
    if (!responded) {
      responded = true;
      try { sendResponse(response); } catch (e) { console.error('sendResponse error:', e); }
    }
  };

  (async () => {
    try {
      if (msg?.type === 'TRANSLATE') {
        const cfg = await getStoredConfig();
        const targetLanguage = msg.targetLanguage || cfg.targetLanguage || DEFAULT_CONFIG.targetLanguage;
        const result = await callLLM({
          selection: msg.selection,
          pre: msg.pre,
          post: msg.post,
          targetLanguage,
          domain: msg.domain || cfg.domain || '',
          glossary: msg.glossary || cfg.glossary || []
        });
        safeSendResponse(result);
      } else if (msg?.type === 'GET_CONFIG') {
        const cfg = await getStoredConfig();
        safeSendResponse(cfg);
      } else if (msg?.type === 'PING') {
        safeSendResponse({ ok: true });
      } else {
        safeSendResponse({ error: '未知的消息类型' });
      }
    } catch (error) {
      console.error('Background error:', error);
      safeSendResponse({ error: `后台错误: ${error.message || String(error)}` });
    }
  })();
  return true;
});

chrome.commands?.onCommand.addListener(async (command) => {
  if (command === 'trigger-translate') {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_SHORTCUT' });
      }
    } catch (e) {}
  }
});