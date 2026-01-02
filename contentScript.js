// contentScript.js

const STATE = {
  cfg: {
    targetLanguage: 'zh-CN',
    triggerMode: 'hover',
    contextLength: 30
  },
  overlay: null,
  tooltip: null,
  currentSelection: null,
  busy: false,
  langBound: false,
  docClickHandler: null
};

function readConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ targetLanguage: 'zh-CN', triggerMode: 'hover', contextLength: 30 }, (items) => {
      STATE.cfg = items;
      resolve(items);
    });
  });
}

function createOverlay() {
  if (STATE.overlay) return STATE.overlay;
  const overlay = document.createElement('div');
  overlay.className = 'cta-heart-overlay';
  overlay.setAttribute('role', 'button');
  overlay.setAttribute('aria-label', '翻译并推测语境');
  const dogUrl = chrome.runtime.getURL('icons/柴犬.svg');
  overlay.innerHTML = `
    <img class="cta-dog" src="${dogUrl}" alt="Translate"/>
  `;
  document.body.appendChild(overlay);

  const trigger = () => tryTranslate();
  overlay.addEventListener('click', (e) => { e.preventDefault(); trigger(); });
  overlay.addEventListener('mouseenter', (e) => {
    if (STATE.cfg.triggerMode === 'hover') trigger();
  });

  STATE.overlay = overlay;
  return overlay;
}

function createTooltip() {
  if (STATE.tooltip) return STATE.tooltip;
  const tip = document.createElement('div');
  tip.className = 'cta-tooltip';
  // 拖拽交互：仅在 header 上拖动，避免与下拉/按钮冲突
  let dragState = { dragging: false, startX: 0, startY: 0, origLeft: 0, origTop: 0 };
  function isInteractive(el) {
    if (!el) return false;
    const tag = el.tagName && el.tagName.toLowerCase();
    if (tag === 'select' || tag === 'button' || tag === 'input' || tag === 'textarea' || tag === 'a') return true;
    return !!el.closest('.cta-lang-select');
  }
  function onDown(e) {
    const isPrimary = e.button === 0;
    if (!isPrimary) return;
    if (isInteractive(e.target)) return; // 不在交互元素上触发拖拽
    dragState.dragging = true;
    const header = tip.querySelector('.cta-tooltip-header');
    if (header) header.classList.add('grabbing');
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
    tip.style.left = `${Math.max(0, Math.min(window.innerWidth - tip.offsetWidth, newLeft))}px`;
    tip.style.top = `${Math.max(0, Math.min(window.innerHeight - tip.offsetHeight, newTop))}px`;
  }
  function onUp() {
    dragState.dragging = false;
    const header = tip.querySelector('.cta-tooltip-header');
    if (header) header.classList.remove('grabbing');
  }
  // 仅在 header 上监听拖拽开始
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  tip.innerHTML = `
    <div class="cta-tooltip-inner">
      <div class="cta-tooltip-header">
        <span class="cta-status">准备中…</span>
        <select class="cta-lang-select" aria-label="切换语言">
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁体中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="es">Español</option>
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
  // header 绑定拖拽起点
  const headerEl = tip.querySelector('.cta-tooltip-header');
  if (headerEl) headerEl.addEventListener('mousedown', onDown);
  tip.querySelector('.cta-close').addEventListener('click', () => hideTooltip());
  tip.querySelector('.cta-copy').addEventListener('click', () => copyTooltip());
  // 语言切换事件只绑定一次
  const select = tip.querySelector('.cta-lang-select');
  if (select && !STATE.langBound) {
    STATE.langBound = true;
    select.addEventListener('change', async () => {
      if (!STATE.currentSelection || STATE.busy) return;
      const lang = select.value;
      tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>`;
      tip.querySelector('.cta-tooltip-footer').hidden = true;
      const usageEl = tip.querySelector('.cta-usage');
      if (usageEl) usageEl.textContent = '';
      showFireworksAroundHeart();
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'TRANSLATE',
          selection: STATE.currentSelection.selection,
          pre: STATE.currentSelection.pre,
          post: STATE.currentSelection.post,
          targetLanguage: lang
        }, (response) => resolve(response));
      });
      renderResult(res);
    });
  }
  STATE.tooltip = tip;
  return tip;
}

function positionOverlayNearRect(rect) {
  const overlay = createOverlay();
  const top = window.scrollY + rect.top - 8; // 上方稍微偏移
  const left = window.scrollX + rect.right + 8; // 右侧偏移
  overlay.style.top = `${top}px`;
  overlay.style.left = `${left}px`;
  overlay.style.display = 'block';
}

function positionTooltipNearRect(rect) {
  const tip = createTooltip();
  // fixed 定位下使用 viewport 坐标
  const top = rect.bottom + 8;
  const left = Math.min(rect.left, rect.right);
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
  tip.style.display = 'block';
}

function hideOverlay() {
  if (STATE.overlay) STATE.overlay.style.display = 'none';
}
function hideTooltip() {
  if (STATE.tooltip) STATE.tooltip.style.display = 'none';
  if (STATE.docClickHandler) {
    document.removeEventListener('click', STATE.docClickHandler, true);
    STATE.docClickHandler = null;
  }
}

function showFireworksAroundHeart() {
  const overlay = STATE.overlay;
  if (!overlay) return;
  const container = document.createElement('div');
  container.className = 'cta-fireworks';
  overlay.appendChild(container);
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('span');
    p.className = 'spark';
    p.style.left = `${10 + (Math.random() * 20 - 10)}px`;
    p.style.top = `${10 + (Math.random() * 20 - 10)}px`;
    p.style.animationDelay = `${Math.random() * 0.3}s`;
    const dx = (Math.random() - 0.5) * 32; // 更大范围
    const dy = -10 - Math.random() * 20; // 向上更明显
    p.style.setProperty('--dx', `${dx}px`);
    p.style.setProperty('--dy', `${dy}px`);
    container.appendChild(p);
  }
  setTimeout(() => { container.remove(); }, 1600);
}

function getSelectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  return range.getBoundingClientRect();
}

function getSelectionAndContext(len) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return null;
  const selection = sel.toString().trim();
  if (!selection) return null;

  // 文本节点遍历，收集前后上下文
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);

  // 找到起始和结束节点的位置
  let startNode = range.startContainer;
  let startOffset = range.startOffset;
  let endNode = range.endContainer;
  let endOffset = range.endOffset;

  function collectBefore(node, offset, limit) {
    let collected = '';
    const nodes = [];
    while (walker.currentNode && walker.currentNode !== node) walker.nextNode();
    // 当前节点之前，从当前节点的offset向前收集
    let cur = walker.currentNode;
    if (cur) {
      const text = cur.nodeValue.slice(0, Math.min(offset, cur.nodeValue.length));
      collected = text + collected;
    }
    // 继续向前遍历
    while (collected.length < limit) {
      const prev = previousTextNode(node);
      if (!prev) break;
      node = prev;
      const take = prev.nodeValue.slice(-Math.min(limit - collected.length, prev.nodeValue.length));
      collected = take + collected;
    }
    return collected.slice(-limit);
  }

  function collectAfter(node, offset, limit) {
    let collected = '';
    // 从当前节点的offset向后收集
    const text = node.nodeValue.slice(offset);
    collected += text;
    // 向后遍历
    while (collected.length < limit) {
      const next = nextTextNode(node);
      if (!next) break;
      node = next;
      const take = next.nodeValue.slice(0, Math.min(limit - collected.length, next.nodeValue.length));
      collected += take;
    }
    return collected.slice(0, limit);
  }

  function previousTextNode(node) {
    let n = node;
    // 尝试找上一个文本节点
    function prevNodeDeep(n) {
      if (!n) return null;
      // 先找前一个兄弟
      let p = n.previousSibling;
      while (p) {
        // 深入到最后一个子文本节点
        const deepest = deepestRightText(p);
        if (deepest) return deepest;
        p = p.previousSibling;
      }
      // 沿父节点向上
      return n.parentNode ? prevNodeDeep(n.parentNode) : null;
    }
    function deepestRightText(n) {
      if (!n) return null;
      if (n.nodeType === Node.TEXT_NODE) return n;
      let child = n.lastChild;
      while (child) {
        const t = deepestRightText(child);
        if (t) return t;
        child = child.previousSibling;
      }
      return null;
    }
    return prevNodeDeep(n);
  }

  function nextTextNode(node) {
    function nextNodeDeep(n) {
      if (!n) return null;
      // 先尝试子树中的第一个文本
      let c = n.firstChild;
      while (c) {
        const t = shallowLeftText(c);
        if (t) return t;
        c = c.nextSibling;
      }
      // 找后面的兄弟节点
      let s = n.nextSibling;
      while (s) {
        const t = shallowLeftText(s);
        if (t) return t;
        s = s.nextSibling;
      }
      // 向上找下一个可用节点
      return n.parentNode ? nextNodeDeep(n.parentNode) : null;
    }
    function shallowLeftText(n) {
      if (n.nodeType === Node.TEXT_NODE) return n;
      let c = n.firstChild;
      while (c) {
        const t = shallowLeftText(c);
        if (t) return t;
        c = c.nextSibling; // 修复：沿兄弟节点向右寻找第一个文本节点
      }
      return null;
    }
    return nextNodeDeep(node);
  }

  const pre = collectBefore(startNode, startOffset, len);
  const post = collectAfter(endNode, endOffset, len);

  return { selection, pre, post, rect: range.getBoundingClientRect() };
}

async function tryTranslate() {
  if (STATE.busy) return;
  const ctxLen = STATE.cfg.contextLength || 30;
  const data = getSelectionAndContext(ctxLen);
  if (!data) return;
  STATE.currentSelection = data;
  STATE.busy = true;

  // 清理上一次的外部点击隐藏监听（如果存在）
  if (STATE.docClickHandler) {
    document.removeEventListener('click', STATE.docClickHandler, true);
    STATE.docClickHandler = null;
  }

  positionTooltipNearRect(data.rect);
  const tip = createTooltip();
  // 每次翻译开始都清空 usage，避免显示上次数据
  const usageEl = tip.querySelector('.cta-usage');
  if (usageEl) usageEl.textContent = '';
  // 设置语言下拉为当前配置
  const select = tip.querySelector('.cta-lang-select');
  if (select) select.value = STATE.cfg.targetLanguage || 'zh-CN';
  tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-loading"><span class="spinner"></span> 正在获取翻译与语境…</div>`;
  tip.querySelector('.cta-tooltip-footer').hidden = true;

  showFireworksAroundHeart();

  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({
      type: 'TRANSLATE',
      selection: data.selection,
      pre: data.pre,
      post: data.post,
      targetLanguage: STATE.cfg.targetLanguage
    }, (response) => resolve(response));
  });

  STATE.busy = false;

  renderResult(res);
}

function renderResult(res) {
  const tip = STATE.tooltip;
  if (!tip) return;
  if (!res || res.error) {
    tip.querySelector('.cta-status').textContent = '错误';
    tip.querySelector('.cta-tooltip-body').innerHTML = `<div class="cta-error">${res?.error || '未知错误'}</div>`;
    tip.querySelector('.cta-tooltip-footer').hidden = true;
    const usageEl = tip.querySelector('.cta-usage');
    if (usageEl) usageEl.textContent = '';
    return;
  }
  const payload = res.data || {};
  const full = payload.full_translation || '';
  const contextual = payload.contextual_translation || payload.translation || '';
  const literal = payload.literal_translation || '';
  const meaning = payload.meaning_in_context || '（无）';
  const pos = payload.part_of_speech_or_type || payload.part_of_speech || '';
  const tone = payload.tone_or_register || '';
  const ex = payload.example_in_cn || '';

  const posRow = pos ? `<div class="row"><span class="label">词性/类型</span><span class="val">${escapeHTML(pos)}</span></div>` : '';
  const toneRow = tone ? `<div class="row"><span class="label">语气/语域</span><span class="val">${escapeHTML(tone)}</span></div>` : '';
  const exRow = ex ? `<div class="row"><span class="label">示例</span><span class="val">${escapeHTML(ex)}</span></div>` : '';
  const literalRow = literal && contextual && literal !== contextual
    ? `<div class="row"><span class="label">直译</span><span class="val">${escapeHTML(literal)}</span></div>`
    : '';
  const fullRow = full ? `<div class="row"><span class="label">完整译（句子）</span><span class="val">${escapeHTML(full)}</span></div>` : '';

  tip.querySelector('.cta-status').textContent = '完成';
  tip.querySelector('.cta-tooltip-body').innerHTML = `
    <div class="row"><span class="label">原文</span><span class="val">${escapeHTML(STATE.currentSelection.selection)}</span></div>
    ${fullRow}
    <div class="row"><span class="label">语境译</span><span class="val">${escapeHTML(contextual || '（无）')}</span></div>
    ${literalRow}
    <div class="row"><span class="label">语境含义</span><span class="val">${escapeHTML(meaning)}</span></div>
    ${posRow}
    ${toneRow}
    ${exRow}
  `;
  const usageText = buildUsageText(res);
  const usageEl = tip.querySelector('.cta-usage');
  if (usageEl) usageEl.textContent = usageText;
  tip.querySelector('.cta-tooltip-footer').hidden = false;

  // 翻译完成后，点击页面其他地方可隐藏气泡（一次性监听）
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
  if (!usage) return '';
  const p = usage.prompt_tokens || 0;
  const c = usage.completion_tokens || 0;
  const t = usage.total_tokens || (p + c);
  const cost = res?.cost != null ? `${res.cost} ${res.currency || 'USD'}` : '';
  const parts = [
    `Tokens: prompt ${p}, completion ${c}, total ${t}`,
    cost ? `Cost: ${cost}` : ''
  ].filter(Boolean);
  return parts.join('  ·  ');
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
    return;
  }
  positionOverlayNearRect(rect);
}

// 监听快捷键触发
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'TRIGGER_SHORTCUT') {
    tryTranslate();
  }
});

// 初始化
(function init() {
  readConfig();
  createOverlay();
  createTooltip();
  document.addEventListener('selectionchange', () => handleSelectionChange(), { passive: true });
  window.addEventListener('scroll', () => handleSelectionChange(), { passive: true });
  window.addEventListener('resize', () => handleSelectionChange(), { passive: true });
})();