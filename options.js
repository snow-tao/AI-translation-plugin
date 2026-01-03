// options.js

const COMMON_PROVIDER_DEFAULTS = {
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com', model: 'gpt-4o' },
  openrouter: { baseUrl: 'https://openrouter.ai/api', model: 'openrouter/auto' },
  together: { baseUrl: 'https://api.together.xyz', model: 'meta-llama/Llama-3.1-8B-Instruct-Turbo' },
  groq: { baseUrl: 'https://api.groq.com/openai', model: 'llama3-8b-8192' },
  custom: { baseUrl: '', model: '' }
};

const DEFAULT_SYNC = {
  targetLanguage: 'zh-CN',
  triggerMode: 'hover',
  contextLength: 30,
  domain: '',
  glossary: []
};

function isExtensionEnv() {
  return !!(typeof chrome !== 'undefined' && chrome.storage);
}

function loadSyncSettings() {
  return new Promise((resolve) => {
    if (!isExtensionEnv()) {
      resolve({ ...DEFAULT_SYNC });
      return;
    }
    chrome.storage.sync.get(DEFAULT_SYNC, (items) => resolve(items));
  });
}

function saveSyncSettings(items) {
  return new Promise((resolve) => {
    if (!isExtensionEnv()) { resolve(true); return; }
    chrome.storage.sync.set(items, () => resolve(true));
  });
}

function loadLocalLLM() {
  return new Promise((resolve) => {
    if (!isExtensionEnv()) {
      resolve({ llmProvider: 'deepseek', llmBaseUrl: COMMON_PROVIDER_DEFAULTS.deepseek.baseUrl, llmModel: COMMON_PROVIDER_DEFAULTS.deepseek.model, llmApiKey: '' });
      return;
    }
    chrome.storage.local.get({ llmProvider: 'deepseek', llmBaseUrl: COMMON_PROVIDER_DEFAULTS.deepseek.baseUrl, llmModel: COMMON_PROVIDER_DEFAULTS.deepseek.model, llmApiKey: '' }, (items) => resolve(items));
  });
}

function saveLocalLLM(items) {
  return new Promise((resolve) => {
    if (!isExtensionEnv()) { resolve(true); return; }
    chrome.storage.local.set(items, () => resolve(true));
  });
}

function $(id) { return document.getElementById(id); }

function parseGlossary(str) {
  try {
    const val = JSON.parse(str);
    if (Array.isArray(val)) return val;
    return [];
  } catch { return []; }
}

function formatGlossary(glossary) {
  try { return JSON.stringify(glossary || [], null, 2); } catch { return '[]'; }
}

async function init() {
  const sync = await loadSyncSettings();
  $('targetLanguage').value = sync.targetLanguage;
  $('triggerMode').value = sync.triggerMode;
  $('contextLength').value = String(sync.contextLength || 30);
  $('domain').value = sync.domain || '';
  $('glossary').value = formatGlossary(sync.glossary);

  const llm = await loadLocalLLM();
  $('llmProvider').value = llm.llmProvider || 'deepseek';
  $('llmBaseUrl').value = llm.llmBaseUrl || '';
  $('llmModel').value = llm.llmModel || '';
  $('llmApiKey').value = llm.llmApiKey || '';

  $('llmProvider').addEventListener('change', onProviderChange);
  $('saveGeneral').addEventListener('click', onSaveGeneral);
  $('saveLLM').addEventListener('click', onSaveLLM);
  $('testLLM').addEventListener('click', onTestLLM);
  $('clearLLM').addEventListener('click', onClearLLM);
}

function onProviderChange(e) {
  const provider = e.target.value;
  const defaults = COMMON_PROVIDER_DEFAULTS[provider] || { baseUrl: '', model: '' };
  if (!$('llmBaseUrl').value) $('llmBaseUrl').value = defaults.baseUrl;
  if (!$('llmModel').value) $('llmModel').value = defaults.model;
}

async function onSaveGeneral() {
  const targetLanguage = $('targetLanguage').value;
  const triggerMode = $('triggerMode').value;
  const contextLength = Number($('contextLength').value) || 30;
  const domain = $('domain').value.trim();
  const glossary = parseGlossary($('glossary').value);
  await saveSyncSettings({ targetLanguage, triggerMode, contextLength, domain, glossary });
  alert('已保存通用设置');
}

async function onSaveLLM() {
  const llmProvider = $('llmProvider').value;
  const llmBaseUrl = $('llmBaseUrl').value.trim();
  const llmModel = $('llmModel').value.trim();
  const llmApiKey = $('llmApiKey').value.trim();
  if (!llmBaseUrl || !llmModel || !llmApiKey) { alert('请填写 Base URL / Model / API Key'); return; }
  await saveLocalLLM({ llmProvider, llmBaseUrl, llmModel, llmApiKey });
  alert('已保存提供商设置');
}

async function onTestLLM() {
  const llmBaseUrl = $('llmBaseUrl').value.trim().replace(/\/$/, '');
  const llmModel = $('llmModel').value.trim();
  const llmApiKey = $('llmApiKey').value.trim();
  if (!llmBaseUrl || !llmModel || !llmApiKey) { alert('请填写 Base URL / Model / API Key'); return; }
  try {
    const res = await fetch(`${llmBaseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${llmApiKey}` }
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const models = Array.isArray(data?.data) ? data.data.map(m => m.id || '').filter(Boolean).slice(0, 5) : [];
      alert('连接成功' + (models.length ? `\n示例模型: ${models.join(', ')}` : ''));
    } else {
      const text = await res.text();
      alert(`连接失败: ${res.status} ${text}`);
    }
  } catch (e) {
    alert(`请求错误: ${e.message}`);
  }
}

async function onClearLLM() {
  await saveLocalLLM({ llmApiKey: '' });
  $('llmApiKey').value = '';
  alert('已清除密钥');
}

init();