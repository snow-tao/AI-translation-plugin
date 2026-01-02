// options.js

const DEFAULTS = {
  targetLanguage: 'zh-CN',
  contextLength: 30,
  triggerMode: 'hover'
};

function load() {
  chrome.storage.sync.get(DEFAULTS, (items) => {
    document.getElementById('targetLanguage').value = items.targetLanguage || DEFAULTS.targetLanguage;
    document.getElementById('contextLength').value = items.contextLength || DEFAULTS.contextLength;
    const radios = document.querySelectorAll('input[name="triggerMode"]');
    radios.forEach((r) => r.checked = r.value === (items.triggerMode || DEFAULTS.triggerMode));
  });
}

function save() {
  const targetLanguage = document.getElementById('targetLanguage').value;
  const contextLength = parseInt(document.getElementById('contextLength').value, 10);
  const triggerMode = Array.from(document.querySelectorAll('input[name="triggerMode"]')).find((r) => r.checked)?.value || 'hover';

  chrome.storage.sync.set({ targetLanguage, contextLength, triggerMode }, () => {
    const btn = document.getElementById('saveBtn');
    const prevText = btn.textContent;
    btn.textContent = '已保存';
    setTimeout(() => { btn.textContent = prevText; }, 1200);
  });
}

document.getElementById('saveBtn').addEventListener('click', save);
window.addEventListener('DOMContentLoaded', load);