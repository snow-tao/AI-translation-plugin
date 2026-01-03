// contentScript.js

const STATE = {
  cfg: {
    targetLanguage: 'zh-CN',
    triggerMode: 'hover',
    contextLength: 30,
    domain: '',
    glossary: []
  },
  overlay: null,
  tooltip: null,
  currentSelection: null,
  busy: false,
  langBound: false,
  docClickHandler: null,
  lastPos: null,
  overrideDomain: null
};

// 检查扩展上下文是否有效
function isExtensionContextValid() {
  try {
    return chrome.runtime && chrome.runtime.id !== undefined;
  } catch (e) {
    return false;
  }
}

// 安全地获取扩展URL
function safeGetURL(path) {
  if (!isExtensionContextValid()) {
    console.warn('扩展上下文已失效，请重新加载页面');
    return '';
  }
  try {
    return chrome.runtime.getURL(path);
  } catch (e) {
    console.error('获取URL失败:', e);
    return '';
  }
}

// 安全地发送消息
function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) {
    if (callback) {
      callback({ error: '扩展上下文已失效，请刷新页面后重试' });
    }
    return;
  }
  try {
    chrome.runtime.sendMessage(message, callback);
  } catch (e) {
    console.error('发送消息失败:', e);
    if (callback) {
      callback({ error: `发送消息失败: ${e.message}` });
    }
  }
}

function readConfig() {
  return new Promise((resolve) => {
    if (!isExtensionContextValid()) {
      console.warn('扩展上下文已失效，使用默认配置');
      resolve({});
      return;
    }
    try {
      chrome.storage.sync.get({ targetLanguage: 'zh-CN', triggerMode: 'hover', contextLength: 30, domain: '', glossary: [], lastPos: null }, (items) => {
        if (chrome.runtime.lastError) {
          console.error('读取配置失败:', chrome.runtime.lastError);
          resolve({});
          return;
        }
        STATE.cfg = { targetLanguage: items.targetLanguage, triggerMode: items.triggerMode, contextLength: items.contextLength, domain: items.domain, glossary: items.glossary };
        STATE.lastPos = items.lastPos || null;
        resolve(items);
      });
    } catch (e) {
      console.error('读取配置异常:', e);
      resolve({});
    }
  });
}

function createOverlay() {
  if (STATE.overlay) return STATE.overlay;
  const overlay = document.createElement('div');
  overlay.className = 'cta-heart-overlay';
  overlay.setAttribute('role', 'button');
  overlay.setAttribute('aria-label', '翻译并推测语境');
  const dogUrl = safeGetURL('icons/柴犬.svg');
  if (!dogUrl) {
    console.error('无法获取图标URL，扩展可能已重新加载，请刷新页面');
    return overlay;
  }
  const img = document.createElement('img');
  img.className = 'cta-dog';
  img.src = dogUrl;
  img.alt = 'Translate';
  img.onerror = function() {
    // 如果SVG加载失败，尝试使用PNG作为后备
    const fallbackUrl = safeGetURL('icons/哈士奇.png');
    if (fallbackUrl) {
      this.src = fallbackUrl;
    }
  };
  overlay.appendChild(img);
  document.body.appendChild(overlay);

  // 创建烟花特效的函数
  const createFireworks = () => {
    const container = document.createElement('div');
    container.className = 'cta-fireworks';
    overlay.appendChild(container);
    for (let i = 0; i < 16; i++) {
      const p = document.createElement('span');
      p.className = 'spark';
      p.style.left = `${14 + (Math.random() * 20 - 10)}px`;
      p.style.top = `${14 + (Math.random() * 20 - 10)}px`;
      p.style.animationDelay = `${Math.random() * 0.3}s`;
      const dx = (Math.random() - 0.5) * 32;
      const dy = -10 - Math.random() * 20;
      p.style.setProperty('--dx', `${dx}px`);
      p.style.setProperty('--dy', `${dy}px`);
      container.appendChild(p);
    }
    setTimeout(() => {
      container.remove();
    }, 1200);
  };

  const trigger = () => {
    try {
      tryTranslate();
    } catch (e) {
      console.error('Translation trigger error:', e);
    }
  };
  
  // 点击总是触发
  overlay.addEventListener('click', (e) => { 
    e.preventDefault(); 
    e.stopPropagation();
    createFireworks();
    trigger(); 
  });
  
  // 悬停时根据配置触发
  overlay.addEventListener('mouseenter', (e) => {
    createFireworks();
    // 动态检查最新的配置值
    if (STATE.cfg.triggerMode === 'hover') {
      trigger();
    }
  });

  STATE.overlay = overlay;
  return overlay;
}

function createTooltip() {
  if (STATE.tooltip) return STATE.tooltip;
  const tip = document.createElement('div');
  tip.className = 'cta-tooltip';
  let dragState = { dragging: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 };
  function onDown(e) {
    const isPrimary = e.button === 0;
    if (!isPrimary) return;
    dragState.dragging = true;
    tip.classList.add('dragging');
    dragState.startX = e.clientX;
    dragState.startY = e.clientY;
    const rect = tip.getBoundingClientRect();
    dragState.origLeft = rect.left;
    dragState.origTop = rect.top;
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragState.dragging) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const newLeft = dragState.origLeft + dx;
    const newTop = dragState.origTop + dy;
    const boundedLeft = Math.max(0, Math.min(window.innerWidth - tip.offsetWidth, newLeft));
    const boundedTop = Math.max(0, Math.min(window.innerHeight - tip.offsetHeight, newTop));
    tip.style.left = `${boundedLeft}px`;
    tip.style.top = `${boundedTop}px`;
    STATE.lastPos = { left: boundedLeft, top: boundedTop };
    tryAvoidDenseInteractiveAreas(tip);
  }
  function onUp() {
    dragState.dragging = false;
    tip.classList.remove('dragging');
    if (STATE.lastPos && isExtensionContextValid()) {
      try {
        chrome.storage.sync.set({ lastPos: STATE.lastPos }, () => {
          if (chrome.runtime.lastError) {
            console.warn('保存位置失败:', chrome.runtime.lastError);
          }
        });
      } catch (e) {
        console.warn('保存位置异常:', e);
      }
    }
  }

  tip.innerHTML = `
    <div class="cta-tooltip-inner" role="dialog" aria-label="翻译结果">
      <div class="cta-tooltip-header">
        <div class="cta-drag-handle" title="拖拽此区域移动">拖拽</div>
        <span class="cta-status">准备中…</span>
        <select class="cta-lang-select" aria-label="切换语言">
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="es">Español</option>
        </select>
        <select class="cta-domain-select" aria-label="选择领域">
          <option value="">不限/不使用</option>
          <option value="科技">科技</option>
          <option value="金融">金融</option>
          <option value="法律">法律</option>
          <option value="医学">医学</option>
          <option value="计算机">计算机</option>
          <option value="市场营销">市场营销</option>
          <option value="新闻">新闻</option>
          <option value="教育">教育</option>
          <option value="文学">文学</option>
          <option value="历史">历史</option>
          <option value="工程">工程</option>
          <option value="数据科学">数据科学</option>
          <option value="电子商务">电子商务</option>
          <option value="游戏">游戏</option>
          <option value="音乐">音乐</option>
          <option value="艺术">艺术</option>
          <option value="体育">体育</option>
          <option value="化学">化学</option>
          <option value="生物">生物</option>
          <option value="环境">环境</option>
        </select>
        <button class="cta-close" aria-label="关闭">×</button>
      </div>
      <div class="cta-tooltip-body">
        <div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>
      </div>
      <div class="cta-tooltip-footer" hidden>
        <div class="cta-usage" aria-live="polite"></div>
        <button class="cta-copy">复制</button>
      </div>
    </div>
  `;
  document.body.appendChild(tip);

  const handle = tip.querySelector('.cta-drag-handle');
  handle.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  tip.querySelector('.cta-close').addEventListener('click', () => hideTooltip());
  tip.querySelector('.cta-copy').addEventListener('click', () => copyTooltip());

  const langSelect = tip.querySelector('.cta-lang-select');
  if (langSelect && !STATE.langBound) {
    STATE.langBound = true;
    langSelect.addEventListener('change', () => {
      if (!STATE.currentSelection || STATE.busy) return;
      const lang = langSelect.value;
      STATE.cfg.targetLanguage = lang;
      const { selection, pre, post } = STATE.currentSelection;
      tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>`;
      const usageEl = tip.querySelector('.cta-usage');
      if (usageEl) usageEl.innerHTML = '';
      tip.querySelector('.cta-tooltip-footer').hidden = true;
      chrome.runtime.sendMessage({
        type: 'TRANSLATE',
        selection, pre, post,
        targetLanguage: lang,
        domain: STATE.overrideDomain ?? STATE.cfg.domain,
        glossary: STATE.cfg.glossary
      });
    });
  }

  const domainSelect = tip.querySelector('.cta-domain-select');
  if (domainSelect) {
    domainSelect.value = STATE.overrideDomain ?? STATE.cfg.domain ?? '';
    domainSelect.addEventListener('change', () => {
      STATE.overrideDomain = domainSelect.value;
      if (!STATE.currentSelection || STATE.busy) return;
      const { selection, pre, post } = STATE.currentSelection;
      tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>`;
      const usageEl = tip.querySelector('.cta-usage');
      if (usageEl) usageEl.innerHTML = '';
      tip.querySelector('.cta-tooltip-footer').hidden = true;
      chrome.runtime.sendMessage({
        type: 'TRANSLATE',
        selection, pre, post,
        targetLanguage: STATE.cfg.targetLanguage,
        domain: STATE.overrideDomain ?? STATE.cfg.domain,
        glossary: STATE.cfg.glossary
      });
    });
  }
  const usageEl = tip.querySelector('.cta-usage');
  if (usageEl) usageEl.textContent = '';
  const select = tip.querySelector('.cta-lang-select');
  if (select) select.value = STATE.cfg.targetLanguage || 'zh-CN';
  tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>`;
  tip.querySelector('.cta-tooltip-footer').hidden = true;
  STATE.tooltip = tip;
  return tip;
}

function renderResult(res) {
  const tip = STATE.tooltip;
  if (!tip) return;
  
  // 检查是否有错误
  if (!res) {
    tip.querySelector('.cta-status').textContent = '';
    tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-error">错误: 未收到响应</div>`;
    tip.querySelector('.cta-tooltip-footer').hidden = true;
    const usageEl = tip.querySelector('.cta-usage');
    if (usageEl) usageEl.textContent = '';
    console.error('renderResult: res is null or undefined');
    return;
  }
  
  if (res.error) {
    tip.querySelector('.cta-status').textContent = '';
    tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-error">${res.error}</div>`;
    tip.querySelector('.cta-tooltip-footer').hidden = true;
    const usageEl = tip.querySelector('.cta-usage');
    if (usageEl) usageEl.textContent = '';
    console.error('renderResult error:', res.error);
    return;
  }
  
  // 检查是否有数据
  if (!res.data) {
    tip.querySelector('.cta-status').textContent = '';
    tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-error">错误: 响应中缺少数据字段。响应内容: ${JSON.stringify(res).substring(0, 200)}</div>`;
    tip.querySelector('.cta-tooltip-footer').hidden = true;
    const usageEl = tip.querySelector('.cta-usage');
    if (usageEl) usageEl.textContent = '';
    console.error('renderResult: missing data field', res);
    return;
  }
  const payload = res.data || {};
  const full = payload.full_translation || '';
  const contextual = payload.contextual_translation || payload.translation || '';
  const literal = payload.literal_translation || '';
  const pronunciation = payload.pronunciation || '';
  const meaning = payload.meaning_in_context || '（无）';
  const pos = payload.part_of_speech_or_type || payload.part_of_speech || '';
  const tone = payload.tone_or_register || '';
  const ex = payload.example_in_cn || '';
  const flags = payload.flags || {};

  const badges = [];
  if (flags.is_idiom) badges.push('<span class="badge badge-idiom">习语</span>');
  if (flags.is_metaphorical) badges.push('<span class="badge badge-metaphor">隐喻</span>');
  if (pos) badges.push('<span class="badge badge-pos">' + escapeHTML(pos) + '</span>');
  if (tone) badges.push('<span class="badge badge-tone">' + escapeHTML(tone) + '</span>');

  const fullRow = full ? `<div class="row"><span class="label">完整句子</span><span class="val">${escapeHTML(full)}</span></div>` : '';
  const contextualRow = `<div class="row"><span class="label">语境译</span><span class="val">${escapeHTML(contextual || '（无）')}</span></div>`;
  const literalRow = literal && contextual && literal !== contextual
    ? `<div class="row"><span class="label">直译</span><span class="val">${escapeHTML(literal)}</span></div>`
    : '';
  const pronunciationRow = pronunciation 
    ? `<div class="row"><span class="label">读音</span><span class="val" style="font-family: 'Times New Roman', serif; font-size: 1.1em;">${escapeHTML(pronunciation)}</span></div>`
    : '';
  const meaningRow = `<div class="row"><span class="label">语境说明</span><span class="val">${escapeHTML(meaning)}</span></div>`;
  const exRow = ex ? `<div class="row"><span class="label">示例</span><span class="val">${escapeHTML(ex)}</span></div>` : '';

  tip.querySelector('.cta-status').textContent = '';
  tip.querySelector('.cta-tooltip-body').innerHTML = `
    <div class="row"><span class="label">原文</span><span class="val">${escapeHTML(STATE.currentSelection.selection)}</span></div>
    <div class="badges">${badges.join('')}</div>
    ${fullRow}
    ${contextualRow}
    ${literalRow}
    ${pronunciationRow}
    ${meaningRow}
    ${exRow}
  `;
  const usageText = buildUsageText(res);
  const usageEl = tip.querySelector('.cta-usage');
  if (usageEl) usageEl.innerHTML = usageText;
  tip.querySelector('.cta-tooltip-footer').hidden = false;

  const handler = (e) => {
    const t = STATE.tooltip;
    if (!t) return;
    if (t.contains(e.target)) return;
    hideTooltip();
    document.removeEventListener('click', handler, true);
    STATE.docClickHandler = null;
  };
  document.addEventListener('click', handler, true);
  STATE.docClickHandler = handler;
}

function buildUsageText(res) {
  const usage = res?.usage || null;
  const badges = [];
  if (usage) {
    const p = usage.prompt_tokens || 0;
    const c = usage.completion_tokens || 0;
    const t = usage.total_tokens || (p + c);
    badges.push(`<span class="badge">词元 ${t}</span>`);
  }
  const cost = res?.cost;
  if (cost != null) {
    const currency = res?.currency || 'USD';
    badges.push(`<span class="badge">费用 ${cost} ${currency}</span>`);
  }
  let timeText = '';
  if (res?.translationTime != null) {
    const timeMs = res.translationTime;
    if (timeMs < 1000) {
      timeText = `${timeMs}ms`;
    } else if (timeMs < 60000) {
      timeText = `${(timeMs / 1000).toFixed(2)}s`;
    } else {
      const timeMin = Math.floor(timeMs / 60000);
      const timeSec = ((timeMs % 60000) / 1000).toFixed(0);
      timeText = `${timeMin}m ${timeSec}s`;
    }
    badges.push(`<span class="badge">耗时 ${timeText}</span>`);
  }
  return badges.join(' ');
}

function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function copyTooltip() {
  const tip = STATE.tooltip;
  if (!tip) return;
  const text = tip.querySelector('.cta-tooltip-body').innerText || '';
  navigator.clipboard?.writeText(text).catch(() => {});
}

function handleSelectionChange() {
  const rect = getSelectionRect();
  if (!rect) {
    hideOverlay();
    STATE.currentSelection = null; // 清理上一次选区，避免误触发
    return;
  }
  positionOverlayNearRect(rect);
  const tip = STATE.tooltip;
  if (tip) {
    const usageEl = tip.querySelector('.cta-usage');
    if (usageEl) usageEl.innerHTML = '';
    const footerEl = tip.querySelector('.cta-tooltip-footer');
    if (footerEl) footerEl.hidden = true;
  }
}

// 键盘交互：ESC 关闭、Enter 触发翻译、Cmd/Ctrl+C 复制
window.addEventListener('keydown', (e) => {
  const tip = STATE.tooltip;
  if (e.key === 'Escape') {
    hideTooltip();
  } else if (e.key === 'Enter') {
    // 仅当当前有选区且气泡可见或接近展示时触发
    tryTranslate();
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    if (tip && tip.style.display !== 'none') {
      copyTooltip();
    }
  }
});

// 智能避让（示例：避免遮挡输入框与按钮密集区）
function tryAvoidDenseInteractiveAreas(tip) {
  const rect = tip.getBoundingClientRect();
  const elems = Array.from(document.querySelectorAll('input, textarea, select, button, a')); 
  const dense = elems.some((el) => {
    const r = el.getBoundingClientRect();
    const overlap = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom);
    return overlap;
  });
  if (dense) {
    // 简单策略：向上或向右偏移 12px
    const newTop = Math.max(0, rect.top - 12);
    const newLeft = Math.min(window.innerWidth - rect.width, rect.left + 12);
    tip.style.top = `${newTop}px`;
    tip.style.left = `${newLeft}px`;
    STATE.lastPos = { left: newLeft, top: newTop };
  }
}

// 位置持久化：当显示气泡时应用上次位置
function applyLastPosition(tip) {
  if (STATE.lastPos) {
    tip.style.left = `${STATE.lastPos.left}px`;
    tip.style.top = `${STATE.lastPos.top}px`;
  }
}

// 监听快捷键触发（来自后台 Alt+T）
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'TRIGGER_SHORTCUT') {
      if (isExtensionContextValid()) {
        tryTranslate();
      }
    }
  });
} catch (e) {
  console.error('注册消息监听器失败:', e);
}

// 初始化
(async function init() {
  await readConfig();
  createOverlay();
  createTooltip();
  document.addEventListener('selectionchange', () => handleSelectionChange(), { passive: true });
  window.addEventListener('scroll', () => handleSelectionChange(), { passive: true });
  window.addEventListener('resize', () => handleSelectionChange(), { passive: true });
})();

// 新增：选区与定位/隐藏辅助函数 + 翻译触发
function getSelectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const text = sel.toString().trim();
  if (!text) return null; // 只有在存在非空选区时才显示覆盖层
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect) return null;
  return rect;
}

function positionOverlayNearRect(rect) {
  const overlay = STATE.overlay || createOverlay();
  const margin = 8;
  overlay.style.position = 'fixed';
  overlay.style.display = 'block';
  const left = Math.min(window.innerWidth - overlay.offsetWidth, Math.max(0, rect.right + margin));
  const top = Math.min(window.innerHeight - overlay.offsetHeight, Math.max(0, rect.top));
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
}

function hideOverlay() {
  const overlay = STATE.overlay || document.querySelector('.cta-heart-overlay');
  if (overlay) overlay.style.display = 'none';
}

function hideTooltip() {
  const tip = STATE.tooltip;
  if (!tip) return;
  tip.style.display = 'none';
  tip.classList.remove('visible');
  if (STATE.docClickHandler) {
    document.removeEventListener('click', STATE.docClickHandler, true);
    STATE.docClickHandler = null;
  }
}

function positionTooltipNearRect(tip, rect) {
  const margin = 8;
  tip.style.position = 'fixed';
  tip.style.display = 'block';
  const left = Math.min(window.innerWidth - tip.offsetWidth, Math.max(0, rect.left));
  const top = Math.min(window.innerHeight - tip.offsetHeight, Math.max(0, rect.bottom + margin));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

async function tryTranslate() {
  // 优先使用当前选区，仅当存在非空选区时才触发
  let selection, pre, post, rect;
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const currentSelection = sel.toString().trim();
    if (currentSelection) {
      const range = sel.getRangeAt(0);
      rect = range.getBoundingClientRect();
      selection = currentSelection;
      try {
        const preRange = range.cloneRange();
        preRange.setStart(preRange.startContainer, 0);
        pre = preRange.toString().slice(-STATE.cfg.contextLength);
      } catch (e) {}
      try {
        const postRange = range.cloneRange();
        const endNode = postRange.endContainer;
        const endLen = endNode && endNode.nodeType === Node.TEXT_NODE ? (endNode.textContent || '').length : 0;
        if (endLen) postRange.setEnd(endNode, endLen);
        post = postRange.toString().slice(0, STATE.cfg.contextLength);
      } catch (e) {}
    }
  }

  if (!selection) return; // 没有选区时不触发翻译，也不使用上一次选区

  STATE.currentSelection = { selection, pre, post };
  const tip = createTooltip();
  if (STATE.lastPos) {
    applyLastPosition(tip);
    tip.style.display = 'block';
    tip.classList.add('visible');
  } else if (rect) {
    positionTooltipNearRect(tip, rect);
    tip.classList.add('visible');
  }

  tip.querySelector('.cta-status').textContent = '';
  tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>`;
  const usageEl = tip.querySelector('.cta-usage');
  if (usageEl) usageEl.innerHTML = '';
  tip.querySelector('.cta-tooltip-footer').hidden = true;

  console.log('发送翻译请求:', selection?.substring(0, 50));
  
  // 检查扩展上下文
  if (!isExtensionContextValid()) {
    STATE.busy = false;
    renderResult({ error: '扩展上下文已失效，请刷新页面后重试' });
    return;
  }
  
  // 设置超时检测
  const timeoutId = setTimeout(() => {
    if (STATE.busy) {
      STATE.busy = false;
      console.error('翻译请求超时');
      renderResult({ error: '翻译请求超时，请检查网络连接或稍后重试' });
    }
  }, 25000); // 25秒超时（比API的20秒超时稍长）
  
  safeSendMessage({
    type: 'TRANSLATE',
    selection,
    pre,
    post,
    targetLanguage: STATE.cfg.targetLanguage,
    domain: STATE.overrideDomain ?? STATE.cfg.domain,
    glossary: STATE.cfg.glossary
  }, (response) => {
    clearTimeout(timeoutId);
    STATE.busy = false;
    console.log('收到响应:', response ? (response.error || '成功') : '无响应');
    if (chrome.runtime.lastError) {
      console.error('Runtime error:', chrome.runtime.lastError);
      renderResult({ error: `扩展错误: ${chrome.runtime.lastError.message}` });
      return;
    }
    if (!response) {
      console.error('无响应');
      renderResult({ error: '未收到响应，请检查后台服务是否正常运行。如果问题持续，请重新加载扩展。' });
      return;
    }
    renderResult(response);
  });
}