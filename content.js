/**
 * 区域选择截图 content script
 * 在页面上覆盖半透明遮罩，用户拖拽选择矩形区域
 */

if (!window.__sfContentInjected) {
  window.__sfContentInjected = true;
}

let overlayDiv = null;
let selectionDiv = null;
let isSelecting = false;
let startX = 0;
let startY = 0;
let screenshotDataUrl = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startAreaSelect') {
    screenshotDataUrl = request.dataUrl;
    startSelection();
    sendResponse({ success: true });
    return true;
  }

});

function startSelection() {
  if (overlayDiv) return;

  overlayDiv = document.createElement('div');
  overlayDiv.id = 'sf-ql-overlay';
  overlayDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.4);
    z-index: 2147483646;
    cursor: crosshair;
  `;

  selectionDiv = document.createElement('div');
  selectionDiv.id = 'sf-ql-selection';
  selectionDiv.style.cssText = `
    position: fixed;
    border: 2px solid #00A1E0;
    background: rgba(0, 161, 224, 0.1);
    pointer-events: none;
    z-index: 2147483647;
    display: none;
    box-sizing: border-box;
  `;

  const tipDiv = document.createElement('div');
  tipDiv.id = 'sf-ql-tip';
  tipDiv.textContent = chrome.i18n.getMessage('qrSelectTip') || '拖拽选择二维码区域，按 ESC 取消';
  tipDiv.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.75);
    color: white;
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    pointer-events: none;
  `;

  overlayDiv.appendChild(selectionDiv);
  overlayDiv.appendChild(tipDiv);
  document.body.appendChild(overlayDiv);

  isSelecting = false;

  overlayDiv.addEventListener('mousedown', onMouseDown);
  overlayDiv.addEventListener('mousemove', onMouseMove);
  overlayDiv.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
}

function onMouseDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  isSelecting = true;
  startX = e.clientX;
  startY = e.clientY;
  selectionDiv.style.display = 'block';
  selectionDiv.style.left = startX + 'px';
  selectionDiv.style.top = startY + 'px';
  selectionDiv.style.width = '0px';
  selectionDiv.style.height = '0px';
}

function onMouseMove(e) {
  if (!isSelecting) return;
  e.preventDefault();

  const currentX = Math.max(0, Math.min(window.innerWidth, e.clientX));
  const currentY = Math.max(0, Math.min(window.innerHeight, e.clientY));

  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  const width = Math.abs(currentX - startX);
  const height = Math.abs(currentY - startY);

  selectionDiv.style.left = left + 'px';
  selectionDiv.style.top = top + 'px';
  selectionDiv.style.width = width + 'px';
  selectionDiv.style.height = height + 'px';
}

async function onMouseUp(e) {
  if (!isSelecting) return;
  e.preventDefault();
  isSelecting = false;

  const rect = selectionDiv.getBoundingClientRect();
  const left = rect.left;
  const top = rect.top;
  const width = rect.width;
  const height = rect.height;

  cleanup();

  if (width < 10 || height < 10) {
    chrome.runtime.sendMessage({ action: 'areaCancelled', reason: 'too small' });
    return;
  }

  try {
    const croppedDataUrl = await cropImage(screenshotDataUrl, left, top, width, height);
    chrome.runtime.sendMessage({ action: 'areaSelected', dataUrl: croppedDataUrl });
  } catch (err) {
    chrome.runtime.sendMessage({ action: 'areaCancelled', reason: err.message });
  }
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    cleanup();
    chrome.runtime.sendMessage({ action: 'areaCancelled', reason: 'user cancelled' });
  }
}

function cleanup() {
  isSelecting = false;
  if (overlayDiv && overlayDiv.parentNode) {
    overlayDiv.parentNode.removeChild(overlayDiv);
  }
  overlayDiv = null;
  selectionDiv = null;
  document.removeEventListener('keydown', onKeyDown);
}

function cropImage(dataUrl, x, y, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scaleX = img.width / window.innerWidth;
      const scaleY = img.height / window.innerHeight;

      const canvas = document.createElement('canvas');
      canvas.width = width * scaleX;
      canvas.height = height * scaleY;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        x * scaleX, y * scaleY,
        width * scaleX, height * scaleY,
        0, 0,
        canvas.width, canvas.height
      );
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error(chrome.i18n.getMessage('imageLoadFailed') || '图片加载失败'));
    img.src = dataUrl;
  });
}

// ============================================
// Passkey 桥接模块（v4 架构）
// - page-world.js 拦截 WebAuthn API → 转发到 Side Panel 集中处理
// - session storage 读写接口（通过 Background 中转）
// - Side Panel 负责所有 Passkey UI 和数据处理
// ============================================

(function() {
  'use strict';

  if (window.__sfPasskeyBridgeInjected) return;
  window.__sfPasskeyBridgeInjected = true;

  const CT = '[CT]';

  /**
   * 向 page-world.js 回传响应
   * page-world.js 由 manifest.json 声明 world: "MAIN" 直接注入主世界
   * 不再使用 fetch + 内联 script 的方式，避免被 Salesforce 严格 CSP（禁止 unsafe-inline）阻止
   */
  function respondToPageWorld(requestId, data) {
    window.postMessage({
      source: 'sf-extension',
      requestId: requestId,
      data: data
    }, '*');
  }

  // ============================================
  // postMessage 监听（接收 page-world.js 的请求）
  // ============================================
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.source !== 'sf-page-world') return;

    const action = event.data.action;
    const requestId = event.data.requestId;

    // ====== sessionGet：通过 Background 读取 session storage ======
    if (action === 'sessionGet') {
      try {
        const result = await chrome.runtime.sendMessage({
          action: '__sf_sessionGet',
          keys: event.data.data.keys || event.data.keys
        });
        respondToPageWorld(requestId, result || {});
      } catch (e) {
        console.error(`${CT} [sessionGet] 失败:`, e.message);
        respondToPageWorld(requestId, {});
      }
      return;
    }

    // ====== sf:passkeyGet / sf:passkeyCreate：发送给 Side Panel ======
    // 如果 Side Panel 没开，2秒后显示气泡并轮询，Panel 打开后自动重发
    // 如果 chrome.runtime.sendMessage 报错（如 bfcache 关闭消息端口），立即 fallback 到系统 Passkey
    if (action === 'sf:passkeyGet' || action === 'sf:passkeyCreate') {
      const passkeyAction = action;
      const passkeyData = event.data.data;
      let stopped = false;
      let sent = false;
      let pingInterval = null;

      function doFallback(reason) {
        if (stopped || sent) return;
        stopped = true;
        sent = true;
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
        hidePasskeyBubble();
        pendingPasskeyRequests.delete(requestId);
        console.warn(`${CT} [${passkeyAction}] 立即 fallback 系统 Passkey: ${reason || ''}`);
        respondToPageWorld(requestId, { fallback: true });
      }

      function trySend() {
        if (stopped || sent) return;
        chrome.runtime.sendMessage({ action: 'bg:ping' })
          .then(response => {
            if (stopped || sent) return;
            if (response && response.open) {
              // Side Panel 已打开，发送 Passkey 请求
              chrome.runtime.sendMessage({
                action: passkeyAction,
                requestId: requestId,
                data: passkeyData
              }).catch(err => {
                // sendMessage 失败：bfcache port closed / Side Panel 关闭 等
                doFallback(`send ${passkeyAction} 失败: ${err?.message || String(err)}`);
              });
              sent = true;
              if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
              }
            }
            // response === undefined: Side Panel 未打开，继续等待轮询
          })
          .catch(err => {
            // ping 失败：bfcache 将扩展 port 移入 back/forward cache 导致 message channel closed
            // 这种情况下继续轮询也没用，立即让页面走系统 Passkey
            doFallback(`bg:ping 失败: ${err?.message || String(err)}`);
          });
      }

      // 立即尝试发送（Side Panel 可能已打开）
      trySend();

      // 2秒后如果没有响应，显示气泡并开始轮询
      const bubbleTimer = setTimeout(() => {
        if (stopped || sent) return;
        showPasskeyBubble();
        pingInterval = setInterval(trySend, 3000);
      }, 2000);

      pendingPasskeyRequests.set(requestId, () => {
        stopped = true;
        clearTimeout(bubbleTimer);
        if (pingInterval) clearInterval(pingInterval);
        hidePasskeyBubble();
      });
      return;
    }

    console.error(`${CT} [message] 未处理的消息: ${action}`);
  });

  // ====== 接收 Side Panel 的直接响应（sf:passkeyResult） ======
  chrome.runtime.onMessage.addListener((request, sender) => {
    if (request.action !== 'sf:passkeyResult') return;
    const cleanup = pendingPasskeyRequests.get(request.requestId);
    if (cleanup) {
      cleanup();
      pendingPasskeyRequests.delete(request.requestId);
    }
    respondToPageWorld(request.requestId, request.data);
  });

  // ============================================
  // Passkey 气泡提示（Side Panel 未打开时显示）
  // ============================================
  const pendingPasskeyRequests = new Map();
  let bubbleEl = null;
  let bubbleCountdown = null;

  function showPasskeyBubble() {
    if (bubbleEl) return; // 已显示

    // 注入样式（只注入一次）
    if (!document.getElementById('sf-bubble-style')) {
      const style = document.createElement('style');
      style.id = 'sf-bubble-style';
      style.textContent = `
        @keyframes sf-bubble-in {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes sf-bubble-out {
          from { opacity: 1; transform: translateX(0); }
          to { opacity: 0; transform: translateX(20px); }
        }
        #sf-passkey-bubble.sf-closing {
          animation: sf-bubble-out 0.3s ease forwards;
        }
      `;
      document.head.appendChild(style);
    }

    bubbleEl = document.createElement('div');
    bubbleEl.id = 'sf-passkey-bubble';
    bubbleEl.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #fff;
      border: 1px solid #1976d2;
      border-radius: 10px;
      box-shadow: 0 6px 24px rgba(0,0,0,0.18);
      padding: 0;
      width: 300px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      color: #333;
      overflow: hidden;
      animation: sf-bubble-in 0.3s ease;
    `;

    // ---- 头部：来源标识 ----
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: linear-gradient(135deg, #1565c0, #1976d2);
      color: #fff;
    `;
    const iconUrl = chrome.runtime.getURL('icons/icon48.png');
    header.innerHTML = `
      <div style="width:22px;height:22px;border-radius:4px;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <img src="${iconUrl}" style="width:16px;height:16px;" alt="ext"/>
      </div>
      <span style="font-weight:600;font-size:13px;">Salesforce Quick Login</span>
    `;

    // ---- 内容区 ----
    const body = document.createElement('div');
    body.style.cssText = `padding: 12px 14px;`;

    const title = document.createElement('div');
    title.textContent = chrome.i18n.getMessage('passkeyBubbleTitle') || '需要打开扩展面板';
    title.style.cssText = `font-weight: 600; color: #0d47a1; margin-bottom: 6px; font-size: 14px;`;

    const desc = document.createElement('div');
    desc.textContent = chrome.i18n.getMessage('passkeyBubbleDesc') || '网页正在请求 Passkey 验证，请打开扩展侧边栏以完成验证。';
    desc.style.cssText = `color: #555; line-height: 1.5; margin-bottom: 10px;`;

    // ---- 操作指引图 ----
    const guide = document.createElement('div');
    guide.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      background: #f0f7ff;
      border-radius: 6px;
      margin-bottom: 10px;
    `;
    guide.innerHTML = `
      <div style="position:relative;width:28px;height:28px;flex-shrink:0;">
        <svg width="28" height="28" viewBox="0 0 28 28" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="4" width="24" height="18" rx="2" fill="#e3f2fd" stroke="#1976d2" stroke-width="1"/>
          <rect x="2" y="4" width="24" height="4" rx="2" fill="#bbdefb"/>
          <circle cx="5.5" cy="6" r="0.8" fill="#1976d2"/>
          <circle cx="8" cy="6" r="0.8" fill="#1976d2"/>
          <circle cx="10.5" cy="6" r="0.8" fill="#1976d2"/>
        </svg>
        <div style="position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;background:#ff6f00;border:1.5px solid #fff;box-shadow:0 0 4px rgba(255,111,0,0.5);"></div>
      </div>
      <svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <path d="M3 8 L13 8 M9 4 L13 8 L9 12" stroke="#1976d2" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div style="width:28px;height:28px;flex-shrink:0;border-radius:6px;background:#fff;border:1.5px solid #1976d2;display:flex;align-items:center;justify-content:center;">
        <img src="${iconUrl}" style="width:18px;height:18px;" alt="ext"/>
      </div>
      <span style="font-size:11px;color:#1976d2;font-weight:500;">${chrome.i18n.getMessage('passkeyBubbleClickIcon') || '点击图标'}</span>
    `;

    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(guide);

    // ---- 底部：倒计时 + 关闭 ----
    const footer = document.createElement('div');
    footer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      background: #fafafa;
      border-top: 1px solid #eee;
    `;

    const countdownEl = document.createElement('span');
    countdownEl.style.cssText = `font-size: 11px; color: #999;`;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = chrome.i18n.getMessage('passkeyBubbleClose') || '关闭';
    closeBtn.style.cssText = `
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      color: #1976d2;
      font-weight: 500;
      padding: 2px 8px;
    `;
    closeBtn.onmouseover = () => { closeBtn.style.color = '#0d47a1'; };
    closeBtn.onmouseout = () => { closeBtn.style.color = '#1976d2'; };
    closeBtn.onclick = hidePasskeyBubble;

    footer.appendChild(countdownEl);
    footer.appendChild(closeBtn);

    bubbleEl.appendChild(header);
    bubbleEl.appendChild(body);
    bubbleEl.appendChild(footer);
    document.body.appendChild(bubbleEl);

    // ---- 倒计时自动关闭（30秒）----
    const formatCountdown = (sec) =>
      chrome.i18n.getMessage('passkeyBubbleCountdown', [String(sec)]) || `${sec}s 后自动关闭`;
    let remaining = 30;
    countdownEl.textContent = formatCountdown(remaining);
    bubbleCountdown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        hidePasskeyBubble();
      } else {
        countdownEl.textContent = formatCountdown(remaining);
      }
    }, 1000);
  }

  function hidePasskeyBubble() {
    if (bubbleCountdown) {
      clearInterval(bubbleCountdown);
      bubbleCountdown = null;
    }
    if (bubbleEl) {
      bubbleEl.classList.add('sf-closing');
      const el = bubbleEl;
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
      bubbleEl = null;
    }
  }

  // page-world.js 由 manifest.json 声明 world: "MAIN" 注入主世界（避免 CSP 阻止内联脚本）
  console.log(`${CT} ========== 桥接模块初始化完成 (v4.1) ==========`);
})();

// ============================================
// 页面右侧浮动工具入口（注入到 Salesforce 页面，非扩展 Side Panel）
// ============================================
(function injectToolFloatRail() {
  'use strict';

  if (window !== window.top) return;
  if (window.__sfToolFloatRailInjected) return;
  window.__sfToolFloatRailInjected = true;

  const HOST_ID = 'sf-ql-tool-float-rail';
  const POS_KEY = 'sfql_tool_float_pos';
  const DRAG_THRESHOLD = 5;

  function label(key, fallback) {
    try {
      return chrome.i18n.getMessage(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function openTool(toolId) {
    chrome.runtime.sendMessage(
      {
        action: 'openToolWindow',
        toolId,
        hostname: location.hostname || ''
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }

  function loadPos() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(POS_KEY, (data) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(data?.[POS_KEY] || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function savePos(pos) {
    try {
      chrome.storage.local.set({ [POS_KEY]: pos }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      /* ignore */
    }
  }

  function clampPos(top, right, host) {
    const w = host.offsetWidth || 28;
    const h = host.offsetHeight || 200;
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    const maxRight = Math.max(0, window.innerWidth - w - 8);
    return {
      top: Math.min(Math.max(8, top), maxTop),
      right: Math.min(Math.max(0, right), maxRight)
    };
  }

  function applyPos(host, pos) {
    if (!pos || typeof pos.top !== 'number' || typeof pos.right !== 'number') {
      host.style.top = '50%';
      host.style.right = '0';
      host.style.left = 'auto';
      host.style.bottom = 'auto';
      host.style.transform = 'translateY(-50%)';
      return;
    }
    const clamped = clampPos(pos.top, pos.right, host);
    host.style.top = `${clamped.top}px`;
    host.style.right = `${clamped.right}px`;
    host.style.left = 'auto';
    host.style.bottom = 'auto';
    host.style.transform = 'none';
  }

  function ensureRail() {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-sf-ql', 'tool-float-rail');
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'top: 50%',
      'right: 0',
      'z-index: 2147483000',
      'transform: translateY(-50%)',
      'pointer-events: none',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ].join(';');

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .rail {
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
        }
        .tab {
          pointer-events: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          min-height: 92px;
          padding: 12px 0;
          border: 1px solid transparent;
          border-right: none;
          border-radius: 10px 0 0 10px;
          cursor: grab;
          opacity: 0.48;
          box-shadow: -2px 2px 10px rgba(13, 71, 161, 0.14);
          transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
        }
        .tab:hover {
          opacity: 0.92;
          transform: translateX(-3px);
          box-shadow: -4px 3px 14px rgba(13, 71, 161, 0.28);
          filter: brightness(1.04);
        }
        .tab:active { cursor: grabbing; }
        .rail.is-dragging .tab {
          opacity: 0.85;
          cursor: grabbing;
          transition: none;
        }
        .text {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.12em;
          line-height: 1;
          user-select: none;
          pointer-events: none;
        }
        .apex {
          background: linear-gradient(180deg, #0277bd 0%, #01579b 100%);
          border-color: #4fc3f7;
          color: #e1f5fe;
        }
        .apex:hover { color: #fff; }
        .soql {
          background: linear-gradient(180deg, #f9a825 0%, #ef6c00 100%);
          border-color: #ffe082;
          color: #fff8e1;
        }
        .soql:hover { color: #fff; }
      </style>
      <div class="rail" part="rail">
        <button type="button" class="tab apex" data-tool="apex-log" title="${label('toolFloatApexTitle', 'Apex Log Viewer')}">
          <span class="text">${label('toolFloatApex', 'Apex Log')}</span>
        </button>
        <button type="button" class="tab soql" data-tool="soql" title="${label('toolFloatSoqlTitle', 'SOQL Creator')}">
          <span class="text">${label('toolFloatSoql', 'SOQL')}</span>
        </button>
      </div>
    `;

    const rail = shadow.querySelector('.rail');
    let dragState = null;
    let savedPos = null;

    loadPos().then((pos) => {
      savedPos = pos;
      applyPos(host, savedPos);
    });

    const onPointerMove = (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (!dragState.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        dragState.moved = true;
        rail.classList.add('is-dragging');
      }
      if (!dragState.moved) return;
      e.preventDefault();
      const next = clampPos(dragState.originTop + dy, dragState.originRight - dx, host);
      applyPos(host, next);
      dragState.current = next;
    };

    const endDrag = (e) => {
      if (!dragState) return;
      const state = dragState;
      dragState = null;
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
      rail.classList.remove('is-dragging');

      if (state.moved) {
        if (state.current) {
          savedPos = state.current;
          savePos(savedPos);
        }
        return;
      }
      if (state.toolId) openTool(state.toolId);
    };

    rail.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = host.getBoundingClientRect();
        const originTop =
          savedPos && typeof savedPos.top === 'number'
            ? savedPos.top
            : rect.top;
        const originRight =
          savedPos && typeof savedPos.right === 'number'
            ? savedPos.right
            : Math.max(0, window.innerWidth - rect.right);
        // 首次拖动前把百分比定位固化为像素，避免跳动
        applyPos(host, { top: originTop, right: originRight });
        dragState = {
          startX: e.clientX,
          startY: e.clientY,
          originTop,
          originRight,
          moved: false,
          toolId: btn.getAttribute('data-tool'),
          current: { top: originTop, right: originRight }
        };
        window.addEventListener('pointermove', onPointerMove, true);
        window.addEventListener('pointerup', endDrag, true);
        window.addEventListener('pointercancel', endDrag, true);
      });
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    window.addEventListener('resize', () => {
      if (!savedPos) return;
      savedPos = clampPos(savedPos.top, savedPos.right, host);
      applyPos(host, savedPos);
      savePos(savedPos);
    });

    const mount = () => {
      if (!document.documentElement || document.getElementById(HOST_ID)) return;
      document.documentElement.appendChild(host);
    };

    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });
  }

  ensureRail();

  // Lightning SPA 可能重建 DOM，定期确认入口仍在
  const recheck = () => {
    try {
      ensureRail();
    } catch {
      /* ignore */
    }
  };
  setInterval(recheck, 3000);
  document.addEventListener('DOMContentLoaded', recheck, { once: true });
})();
