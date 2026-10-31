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
    }, location.origin);
  }

  // ============================================
  // postMessage 监听（接收 page-world.js 的请求）
  // ============================================
  window.addEventListener('message', async (event) => {
    // 只接受本页主世界的消息，不接受 iframe 或其他窗口伪造
    if (event.source !== window || event.origin !== location.origin) return;
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
  const MODAL_HOST_ID = 'sf-ql-object-search-modal';
  const POS_KEY = 'sfql_tool_float_pos';
  const DRAG_THRESHOLD = 5;
  const SF_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
  const MAX_LIST = 40;

  /**
   * 与 src/tools/_shared/toolThemes.js 保持同步（content 未走 Vite，无法直接 import）。
   * 调用：THEME.soql.accent / THEME.object.railGradient
   */
  const THEME = {
    apex: {
      accent: '#0277bd',
      accent2: '#01579b',
      railGradient: 'linear-gradient(180deg, #0277bd 0%, #01579b 100%)',
      railBorder: '#4fc3f7',
      railText: '#e1f5fe'
    },
    soql: {
      accent: '#f9a825',
      accent2: '#ef6c00',
      railGradient: 'linear-gradient(180deg, #f9a825 0%, #ef6c00 100%)',
      railBorder: '#ffe082',
      railText: '#fff8e1'
    },
    object: {
      accent: '#9575cd',
      accent2: '#7e57c2',
      accentDeep: '#5e35b1',
      page: '#f7f3fb',
      soft: '#ede7f6',
      softTint: '#faf7fc',
      border: '#d1c4e9',
      borderHover: '#b39ddb',
      panel: '#faf5ff',
      title: '#5e35b1',
      railGradient: 'linear-gradient(180deg, #9575cd 0%, #5e35b1 100%)',
      railBorder: '#b39ddb',
      railText: '#f3e5f5',
      expandGradient: 'linear-gradient(180deg, #9575cd 0%, #5e35b1 100%)',
      expandText: '#f3e5f5',
      focusRing: '0 0 0 2px rgba(126, 87, 194, 0.22)',
      listHover: '#ede7f6',
      listActive: '#d1c4e9',
      modalHeaderGrad: 'linear-gradient(180deg, #ede7f6 0%, #fff 100%)'
    }
  };

  /** @type {Map<string, { hostname: string, sobjects: Array, fetchedAt: number }>} */
  const sobjectsCache = new Map();

  // 跟随 Side Panel「语言」偏好（chrome.storage.local ui_locale），而非仅浏览器 chrome.i18n
  const LOCALE_STORAGE_KEY = 'ui_locale';
  const LOCALE_PREF_SYSTEM = 'system';
  const SUPPORTED_LOCALES = ['zh-CN', 'en', 'ja'];
  const DEFAULT_LOCALE = 'zh-CN';

  const CONTENT_I18N = {
    'zh-CN': {
      toolFloatApex: 'Apex Log',
      toolFloatSoql: 'SOQL',
      toolFloatObject: '对象',
      toolFloatApexTitle: 'Apex Log Viewer',
      toolFloatSoqlTitle: 'SOQL Creator',
      toolFloatObjectTitle: '对象搜索',
      objectSearchTitle: '对象搜索',
      objectSearchPlaceholder: '标签、API 名称或 Salesforce Id…',
      objectSearchLoading: '正在加载对象元数据…',
      objectSearchNoSession: '未找到 Salesforce 会话，请先登录此 Org',
      objectSearchLoadFailed: '加载对象失败：$1',
      objectSearchNoMatch: '无匹配对象',
      objectSearchPrefixConflict: '多个对象共享此前缀，请选择其一',
      objectSearchUnknownPrefix: '未找到此前缀对应的对象',
      objectSearchSelectHint: '选择对象以预览',
      objectSearchExpand: '展开',
      objectSearchLabel: '标签',
      objectSearchApiName: 'API 名称',
      objectSearchPrefix: 'Key Prefix',
      objectSearchType: '类型',
      objectSearchCustom: '自定义',
      objectSearchStandard: '标准',
      objectSearchRecordId: '记录 Id',
      objectSearchClose: '关闭',
      objectSearchDescribeLoading: '加载详情中…',
      objectSearchExpandFailed: '打开对象详情失败：$1'
    },
    en: {
      toolFloatApex: 'Apex Log',
      toolFloatSoql: 'SOQL',
      toolFloatObject: 'Object',
      toolFloatApexTitle: 'Apex Log Viewer',
      toolFloatSoqlTitle: 'SOQL Creator',
      toolFloatObjectTitle: 'Object Search',
      objectSearchTitle: 'Object Search',
      objectSearchPlaceholder: 'Label, API Name, or Salesforce Id…',
      objectSearchLoading: 'Loading object metadata…',
      objectSearchNoSession: 'No Salesforce session found. Log in to this org first.',
      objectSearchLoadFailed: 'Failed to load objects: $1',
      objectSearchNoMatch: 'No matching objects',
      objectSearchPrefixConflict: 'Multiple objects share this Id prefix — select one',
      objectSearchUnknownPrefix: 'No object found for this Id prefix',
      objectSearchSelectHint: 'Select an object to preview',
      objectSearchExpand: 'Expand',
      objectSearchLabel: 'Label',
      objectSearchApiName: 'API Name',
      objectSearchPrefix: 'Key Prefix',
      objectSearchType: 'Type',
      objectSearchCustom: 'Custom',
      objectSearchStandard: 'Standard',
      objectSearchRecordId: 'Record Id',
      objectSearchClose: 'Close',
      objectSearchDescribeLoading: 'Loading details…',
      objectSearchExpandFailed: 'Failed to open Object Detail: $1'
    },
    ja: {
      toolFloatApex: 'Apex Log',
      toolFloatSoql: 'SOQL',
      toolFloatObject: 'オブジェクト',
      toolFloatApexTitle: 'Apex Log Viewer',
      toolFloatSoqlTitle: 'SOQL Creator',
      toolFloatObjectTitle: 'オブジェクト検索',
      objectSearchTitle: 'オブジェクト検索',
      objectSearchPlaceholder: 'ラベル、API 名、または Salesforce Id…',
      objectSearchLoading: 'オブジェクトメタデータを読み込み中…',
      objectSearchNoSession: 'Salesforce セッションが見つかりません。先にこの Org にログインしてください。',
      objectSearchLoadFailed: 'オブジェクトの読み込みに失敗しました：$1',
      objectSearchNoMatch: '一致するオブジェクトがありません',
      objectSearchPrefixConflict: 'この Id プレフィックスを共有するオブジェクトが複数あります。1 つ選択してください',
      objectSearchUnknownPrefix: 'この Id プレフィックスに該当するオブジェクトがありません',
      objectSearchSelectHint: 'プレビューするオブジェクトを選択',
      objectSearchExpand: '展開',
      objectSearchLabel: 'ラベル',
      objectSearchApiName: 'API 名',
      objectSearchPrefix: 'Key Prefix',
      objectSearchType: '種別',
      objectSearchCustom: 'カスタム',
      objectSearchStandard: '標準',
      objectSearchRecordId: 'レコード Id',
      objectSearchClose: '閉じる',
      objectSearchDescribeLoading: '詳細を読み込み中…',
      objectSearchExpandFailed: 'オブジェクト詳細を開けませんでした：$1'
    }
  };

  let effectiveLocale = DEFAULT_LOCALE;
  /** @type {ShadowRoot | null} */
  let railShadow = null;
  /** @type {null | { host: HTMLElement, shadow: ShadowRoot, pageHostname: string, apiHostname: string, sobjects: Array, matches: Array, selected: any, recordId: string, describeCache: Map, searchGen: number, _rerunSearch: null | Function }} */
  let modalState = null;

  function mapBrowserLanguage(lang) {
    if (!lang) return DEFAULT_LOCALE;
    const lower = String(lang).toLowerCase().replace('_', '-');
    if (lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('ja')) return 'ja';
    if (lower.startsWith('en')) return 'en';
    return DEFAULT_LOCALE;
  }

  function detectBrowserLocale() {
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage) {
        return mapBrowserLanguage(chrome.i18n.getUILanguage());
      }
    } catch {
      /* ignore */
    }
    if (typeof navigator !== 'undefined') {
      return mapBrowserLanguage(navigator.language || navigator.languages?.[0]);
    }
    return DEFAULT_LOCALE;
  }

  function resolveEffectiveLocale() {
    return new Promise((resolve) => {
      const finish = (pref) => {
        const locale =
          pref === LOCALE_PREF_SYSTEM || !SUPPORTED_LOCALES.includes(pref)
            ? detectBrowserLocale()
            : pref;
        effectiveLocale = locale;
        resolve(locale);
      };
      try {
        chrome.storage.local.get([LOCALE_STORAGE_KEY], (data) => {
          if (chrome.runtime.lastError) {
            finish(LOCALE_PREF_SYSTEM);
            return;
          }
          finish(data?.[LOCALE_STORAGE_KEY] || LOCALE_PREF_SYSTEM);
        });
      } catch {
        finish(LOCALE_PREF_SYSTEM);
      }
    });
  }

  function applySubs(template, substitutions) {
    if (substitutions == null) return template;
    const arr = Array.isArray(substitutions) ? substitutions : [substitutions];
    return String(template)
      .replace(/\$1/g, arr[0] != null ? String(arr[0]) : '')
      .replace(/\$ERROR\$/g, arr[0] != null ? String(arr[0]) : '');
  }

  function label(key, fallback, substitutions) {
    const catalog = CONTENT_I18N[effectiveLocale] || CONTENT_I18N[DEFAULT_LOCALE];
    let msg = catalog?.[key];
    if (!msg) {
      try {
        msg = chrome.i18n.getMessage(key, substitutions);
      } catch {
        /* ignore */
      }
    }
    if (!msg) msg = fallback;
    return applySubs(msg, substitutions);
  }

  function applyRailLocale() {
    if (!railShadow) return;
    const map = [
      ['apex-log', 'toolFloatApex', 'toolFloatApexTitle', 'Apex Log', 'Apex Log Viewer'],
      ['soql', 'toolFloatSoql', 'toolFloatSoqlTitle', 'SOQL', 'SOQL Creator'],
      ['object-search', 'toolFloatObject', 'toolFloatObjectTitle', 'Object', 'Object Search']
    ];
    map.forEach(([tool, textKey, titleKey, textFb, titleFb]) => {
      const btn = railShadow.querySelector(`.tab[data-tool="${tool}"]`);
      if (!btn) return;
      btn.title = label(titleKey, titleFb);
      const text = btn.querySelector('.text');
      if (text) text.textContent = label(textKey, textFb);
    });
  }

  function applyModalLocale() {
    if (!modalState?.shadow) return;
    const shadow = modalState.shadow;
    const title = shadow.querySelector('.title');
    if (title) title.textContent = label('objectSearchTitle', 'Object Search');
    const panel = shadow.querySelector('.panel');
    if (panel) panel.setAttribute('aria-label', label('objectSearchTitle', 'Object Search'));
    const closeBtn = shadow.querySelector('.close');
    if (closeBtn) {
      const closeLabel = label('objectSearchClose', 'Close');
      closeBtn.title = closeLabel;
      closeBtn.setAttribute('aria-label', closeLabel);
    }
    const input = shadow.querySelector('.search');
    if (input) {
      input.placeholder = label(
        'objectSearchPlaceholder',
        'Label, API Name, or Salesforce Id…'
      );
    }
    const setK = (sel, key, fb) => {
      const el = shadow.querySelector(sel);
      if (el) el.textContent = label(key, fb);
    };
    setK('.preview .row:nth-child(1) .k', 'objectSearchLabel', 'Label');
    setK('.preview .row:nth-child(2) .k', 'objectSearchApiName', 'API Name');
    setK('.preview .row:nth-child(3) .k', 'objectSearchPrefix', 'Key Prefix');
    setK('.preview .row:nth-child(4) .k', 'objectSearchType', 'Type');
    setK('.preview .record-row .k', 'objectSearchRecordId', 'Record Id');
    const expandBtn = shadow.querySelector('.btn-expand');
    if (expandBtn) expandBtn.textContent = label('objectSearchExpand', 'Expand');
    if (modalState.selected) {
      const typeEl = shadow.querySelector('[data-f="type"]');
      if (typeEl) {
        typeEl.textContent = modalState.selected.custom
          ? label('objectSearchCustom', 'Custom')
          : label('objectSearchStandard', 'Standard');
      }
    }
    // 刷新状态/列表提示文案
    const statusEl = shadow.querySelector('.status');
    const q = input?.value?.trim() || '';
    if (!modalState.sobjects?.length && statusEl && !statusEl.classList.contains('error')) {
      statusEl.textContent = label('objectSearchLoading', 'Loading object metadata…');
    } else if (q && typeof modalState._rerunSearch === 'function') {
      modalState._rerunSearch();
    }
  }

  function sendMsg(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { success: false, error: '无响应' });
        });
      } catch (e) {
        resolve({ success: false, error: e?.message || String(e) });
      }
    });
  }

  function openTool(toolId) {
    sendMsg({
      action: 'openToolWindow',
      toolId,
      hostname: location.hostname || ''
    });
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

  function clampPos(top, host) {
    const h = host.offsetHeight || 200;
    const maxTop = Math.max(8, window.innerHeight - h - 8);
    return {
      top: Math.min(Math.max(8, top), maxTop),
      right: 0
    };
  }

  function applyPos(host, pos) {
    if (!pos || typeof pos.top !== 'number') {
      host.style.top = '50%';
      host.style.right = '0';
      host.style.left = 'auto';
      host.style.bottom = 'auto';
      host.style.transform = 'translateY(-50%)';
      return;
    }
    const clamped = clampPos(pos.top, host);
    host.style.top = `${clamped.top}px`;
    host.style.right = '0';
    host.style.left = 'auto';
    host.style.bottom = 'auto';
    host.style.transform = 'none';
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function ensureSObjects(pageHostname) {
    const key = pageHostname || location.hostname || '';
    const cached = sobjectsCache.get(key);
    if (cached?.sobjects?.length) return cached;

    const res = await sendMsg({ action: 'sfGetSObjects', hostname: key });
    if (!res?.success) {
      const err = new Error(res?.error || 'load failed');
      if (/sid|session|未找到/i.test(String(res?.error || ''))) err.code = 'NO_SESSION';
      throw err;
    }
    const list = Array.isArray(res.data?.sobjects) ? res.data.sobjects : [];
    const entry = {
      hostname: res.hostname || key,
      sobjects: list.map((o) => ({
        name: o.name,
        label: o.label || o.name,
        labelPlural: o.labelPlural || '',
        keyPrefix: o.keyPrefix || '',
        custom: !!o.custom,
        queryable: !!o.queryable,
        searchable: !!o.searchable
      })),
      fetchedAt: Date.now()
    };
    sobjectsCache.set(key, entry);
    return entry;
  }

  function isSfId(q) {
    return SF_ID_RE.test(q);
  }

  function filterSObjects(sobjects, query) {
    const q = String(query || '').trim();
    if (!q) return { matches: [], recordId: '', idMode: false, prefixConflict: false, unknownPrefix: false };

    if (isSfId(q)) {
      const prefix = q.slice(0, 3);
      const matches = sobjects.filter((o) => o.keyPrefix && o.keyPrefix === prefix);
      return {
        matches,
        recordId: q,
        idMode: true,
        prefixConflict: matches.length > 1,
        unknownPrefix: matches.length === 0
      };
    }

    const lower = q.toLowerCase();
    const matches = sobjects.filter((o) => {
      const name = (o.name || '').toLowerCase();
      const lab = (o.label || '').toLowerCase();
      const plural = (o.labelPlural || '').toLowerCase();
      return name.includes(lower) || lab.includes(lower) || plural.includes(lower);
    });
    // Prefer exact / prefix API name matches
    matches.sort((a, b) => {
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      const al = (a.label || '').toLowerCase();
      const bl = (b.label || '').toLowerCase();
      const score = (n, l) => {
        if (n === lower || l === lower) return 0;
        if (n.startsWith(lower) || l.startsWith(lower)) return 1;
        return 2;
      };
      return score(an, al) - score(bn, bl) || an.localeCompare(bn);
    });
    return {
      matches: matches.slice(0, MAX_LIST),
      recordId: '',
      idMode: false,
      prefixConflict: false,
      unknownPrefix: false
    };
  }

  // ---------- Object Search Modal (Shadow DOM on page) ----------
  function closeObjectSearchModal() {
    const el = document.getElementById(MODAL_HOST_ID);
    if (el) el.remove();
    modalState = null;
  }

  function openObjectSearchModal() {
    closeObjectSearchModal();

    const host = document.createElement('div');
    host.id = MODAL_HOST_ID;
    host.setAttribute('data-sf-ql', 'object-search-modal');
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'inset: 0',
      'z-index: 2147483600',
      'pointer-events: none',
      'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ].join(';');

    const ot = THEME.object;
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; }
        .backdrop {
          pointer-events: auto;
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.38);
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding: 12vh 16px 24px;
        }
        .panel {
          width: min(440px, 100%);
          max-height: min(72vh, 640px);
          display: flex;
          flex-direction: column;
          background: #fff;
          border-radius: 12px;
          box-shadow: 0 16px 48px rgba(94, 53, 177, 0.22);
          border: 1px solid ${ot.border};
          overflow: hidden;
          color: ${ot.accentDeep};
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 12px 14px 8px;
          background: ${ot.modalHeaderGrad};
          border-bottom: 1px solid ${ot.border};
        }
        .title {
          margin: 0;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.02em;
          color: ${ot.title};
        }
        .close {
          border: none;
          background: transparent;
          width: 28px;
          height: 28px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          color: #546e7a;
        }
        .close:hover { background: ${ot.soft}; color: ${ot.accentDeep}; }
        .body { padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 10px; min-height: 0; flex: 1; overflow: hidden; }
        .search {
          width: 100%;
          padding: 9px 12px;
          border: 1px solid ${ot.borderHover};
          border-radius: 8px;
          font-size: 13px;
          outline: none;
          color: #263238;
        }
        .search:focus { border-color: ${ot.accent}; box-shadow: ${ot.focusRing}; }
        .status {
          font-size: 12px;
          color: #607d8b;
          min-height: 1.2em;
        }
        .status.error { color: #c62828; }
        .status.warn { color: #ef6c00; }
        .results {
          list-style: none;
          margin: 0;
          padding: 0;
          overflow-y: auto;
          max-height: 160px;
          border: 1px solid ${ot.border};
          border-radius: 8px;
        }
        .results:empty { display: none; }
        .results li {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 8px 10px;
          cursor: pointer;
          border-bottom: 1px solid #f5f5f5;
          font-size: 12px;
        }
        .results li:last-child { border-bottom: none; }
        .results li:hover { background: ${ot.listHover}; }
        .results li.active { background: ${ot.listActive}; }
        .results .lab { font-weight: 600; color: ${ot.accentDeep}; }
        .results .api { color: #607d8b; font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
        .preview {
          border: 1px solid ${ot.border};
          border-radius: 8px;
          padding: 10px 12px;
          background: ${ot.softTint};
          font-size: 12px;
          display: none;
        }
        .preview.visible { display: block; }
        .preview .row {
          display: grid;
          grid-template-columns: 88px 1fr;
          gap: 4px 8px;
          margin-bottom: 4px;
        }
        .preview .k { color: #78909c; }
        .preview .v { color: #263238; word-break: break-all; }
        .preview .v.mono { font-family: ui-monospace, Consolas, monospace; }
        .actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 8px;
        }
        .btn {
          border: none;
          border-radius: 8px;
          padding: 7px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn-expand {
          background: ${ot.expandGradient};
          color: ${ot.expandText};
          box-shadow: 0 1px 4px rgba(94, 53, 177, 0.35);
        }
        .btn-expand:hover { filter: brightness(1.06); }
        .btn-expand:disabled { opacity: 0.45; cursor: not-allowed; filter: none; }
        .hidden { display: none !important; }
      </style>
      <div class="backdrop" part="backdrop">
        <div class="panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(label('objectSearchTitle', 'Object Search'))}">
          <div class="header">
            <h2 class="title">${escapeHtml(label('objectSearchTitle', 'Object Search'))}</h2>
            <button type="button" class="close" title="${escapeHtml(label('objectSearchClose', 'Close'))}" aria-label="${escapeHtml(label('objectSearchClose', 'Close'))}">×</button>
          </div>
          <div class="body">
            <input class="search" type="search" autocomplete="off" spellcheck="false"
              placeholder="${escapeHtml(label('objectSearchPlaceholder', 'Label, API Name, or Salesforce Id…'))}" />
            <div class="status"></div>
            <ul class="results"></ul>
            <div class="preview">
              <div class="row"><span class="k">${escapeHtml(label('objectSearchLabel', 'Label'))}</span><span class="v" data-f="label"></span></div>
              <div class="row"><span class="k">${escapeHtml(label('objectSearchApiName', 'API Name'))}</span><span class="v mono" data-f="name"></span></div>
              <div class="row"><span class="k">${escapeHtml(label('objectSearchPrefix', 'Key Prefix'))}</span><span class="v mono" data-f="prefix"></span></div>
              <div class="row"><span class="k">${escapeHtml(label('objectSearchType', 'Type'))}</span><span class="v" data-f="type"></span></div>
              <div class="row record-row hidden"><span class="k">${escapeHtml(label('objectSearchRecordId', 'Record Id'))}</span><span class="v mono" data-f="recordId"></span></div>
              <div class="actions">
                <button type="button" class="btn btn-expand" disabled>${escapeHtml(label('objectSearchExpand', 'Expand'))}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const backdrop = shadow.querySelector('.backdrop');
    const panel = shadow.querySelector('.panel');
    const closeBtn = shadow.querySelector('.close');
    const input = shadow.querySelector('.search');
    const statusEl = shadow.querySelector('.status');
    const resultsEl = shadow.querySelector('.results');
    const previewEl = shadow.querySelector('.preview');
    const expandBtn = shadow.querySelector('.btn-expand');

    modalState = {
      host,
      shadow,
      pageHostname: location.hostname || '',
      apiHostname: '',
      sobjects: [],
      matches: [],
      selected: null,
      recordId: '',
      describeCache: new Map(),
      searchGen: 0,
      _rerunSearch: null
    };

    function setStatus(text, kind) {
      statusEl.textContent = text || '';
      statusEl.classList.toggle('error', kind === 'error');
      statusEl.classList.toggle('warn', kind === 'warn');
    }

    function renderPreview(obj) {
      if (!obj) {
        previewEl.classList.remove('visible');
        expandBtn.disabled = true;
        return;
      }
      previewEl.classList.add('visible');
      previewEl.querySelector('[data-f="label"]').textContent = obj.label || obj.name || '—';
      previewEl.querySelector('[data-f="name"]').textContent = obj.name || '—';
      previewEl.querySelector('[data-f="prefix"]').textContent = obj.keyPrefix || '—';
      previewEl.querySelector('[data-f="type"]').textContent = obj.custom
        ? label('objectSearchCustom', 'Custom')
        : label('objectSearchStandard', 'Standard');
      const recordRow = previewEl.querySelector('.record-row');
      if (modalState.recordId) {
        recordRow.classList.remove('hidden');
        previewEl.querySelector('[data-f="recordId"]').textContent = modalState.recordId;
      } else {
        recordRow.classList.add('hidden');
      }
      expandBtn.disabled = !obj.name;
    }

    function renderResults(matches, { autoSelect } = {}) {
      resultsEl.innerHTML = '';
      matches.forEach((obj, idx) => {
        const li = document.createElement('li');
        li.dataset.name = obj.name;
        if (modalState.selected?.name === obj.name) li.classList.add('active');
        li.innerHTML = `<span class="lab">${escapeHtml(obj.label || obj.name)}</span><span class="api">${escapeHtml(obj.name)}${obj.keyPrefix ? ' · ' + escapeHtml(obj.keyPrefix) : ''}</span>`;
        li.addEventListener('click', () => {
          selectObject(obj);
        });
        resultsEl.appendChild(li);
        if (autoSelect && idx === 0 && matches.length === 1) {
          selectObject(obj);
        }
      });
    }

    async function enrichPreview(obj) {
      if (!obj?.name || !modalState) return;
      const cacheKey = obj.name;
      if (modalState.describeCache.has(cacheKey)) {
        const d = modalState.describeCache.get(cacheKey);
        if (d?.label) previewEl.querySelector('[data-f="label"]').textContent = d.label;
        if (d?.keyPrefix) previewEl.querySelector('[data-f="prefix"]').textContent = d.keyPrefix;
        return;
      }
      setStatus(label('objectSearchDescribeLoading', 'Loading details…'));
      const res = await sendMsg({
        action: 'sfDescribeSObject',
        hostname: modalState.pageHostname,
        object: obj.name
      });
      if (!modalState || modalState.selected?.name !== obj.name) return;
      if (res?.success && res.data) {
        modalState.describeCache.set(cacheKey, res.data);
        if (res.data.label) previewEl.querySelector('[data-f="label"]').textContent = res.data.label;
        if (res.data.keyPrefix) previewEl.querySelector('[data-f="prefix"]').textContent = res.data.keyPrefix;
        if (typeof res.data.custom === 'boolean') {
          previewEl.querySelector('[data-f="type"]').textContent = res.data.custom
            ? label('objectSearchCustom', 'Custom')
            : label('objectSearchStandard', 'Standard');
        }
        setStatus('');
      } else {
        setStatus('');
      }
    }

    function selectObject(obj) {
      if (!modalState) return;
      modalState.selected = obj;
      resultsEl.querySelectorAll('li').forEach((li) => {
        li.classList.toggle('active', li.dataset.name === obj.name);
      });
      renderPreview(obj);
      enrichPreview(obj);
    }

    function runSearch() {
      if (!modalState) return;
      const q = input.value.trim();
      const gen = ++modalState.searchGen;
      modalState.selected = null;
      renderPreview(null);

      if (!q) {
        resultsEl.innerHTML = '';
        setStatus('');
        return;
      }
      if (!modalState.sobjects.length) {
        setStatus(label('objectSearchLoading', 'Loading object metadata…'));
        return;
      }

      const result = filterSObjects(modalState.sobjects, q);
      if (gen !== modalState.searchGen) return;
      modalState.matches = result.matches;
      modalState.recordId = result.recordId;

      if (result.idMode && result.unknownPrefix) {
        resultsEl.innerHTML = '';
        setStatus(label('objectSearchUnknownPrefix', 'No object found for this Id prefix'), 'warn');
        return;
      }
      if (result.matches.length === 0) {
        resultsEl.innerHTML = '';
        setStatus(label('objectSearchNoMatch', 'No matching objects'), 'warn');
        return;
      }
      if (result.prefixConflict) {
        setStatus(label('objectSearchPrefixConflict', 'Multiple objects share this Id prefix — select one'), 'warn');
        renderResults(result.matches);
        return;
      }
      if (result.matches.length === 1) {
        setStatus('');
        renderResults(result.matches, { autoSelect: true });
        return;
      }
      setStatus(label('objectSearchSelectHint', 'Select an object to preview'));
      renderResults(result.matches);
    }

    let searchTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 80);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeObjectSearchModal();
      } else if (e.key === 'Enter' && modalState?.selected && !expandBtn.disabled) {
        e.preventDefault();
        expandBtn.click();
      }
    });

    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      closeObjectSearchModal();
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeObjectSearchModal();
    });
    panel.addEventListener('click', (e) => e.stopPropagation());

    expandBtn.addEventListener('click', async () => {
      if (!modalState?.selected?.name) return;
      expandBtn.disabled = true;
      const res = await sendMsg({
        action: 'openObjectDetailTab',
        object: modalState.selected.name,
        hostname: modalState.apiHostname || modalState.pageHostname,
        id: modalState.recordId || undefined
      });
      if (!res?.success) {
        setStatus(
          label('objectSearchExpandFailed', 'Failed to open Object Detail: $1', [
            res?.error || 'unknown'
          ]),
          'error'
        );
        expandBtn.disabled = false;
        return;
      }
      closeObjectSearchModal();
    });

    modalState._rerunSearch = runSearch;

    const mount = () => {
      if (!document.documentElement) return;
      document.documentElement.appendChild(host);
      input.focus();
    };
    if (document.documentElement) mount();
    else document.addEventListener('DOMContentLoaded', mount, { once: true });

    setStatus(label('objectSearchLoading', 'Loading object metadata…'));
    ensureSObjects(modalState.pageHostname)
      .then((entry) => {
        if (!modalState || modalState.host !== host) return;
        modalState.sobjects = entry.sobjects;
        modalState.apiHostname = entry.hostname;
        setStatus('');
        if (input.value.trim()) runSearch();
      })
      .catch((err) => {
        if (!modalState || modalState.host !== host) return;
        if (err?.code === 'NO_SESSION' || /sid|session|未找到/i.test(String(err?.message || ''))) {
          setStatus(label('objectSearchNoSession', 'No Salesforce session found. Log in to this org first.'), 'error');
        } else {
          setStatus(
            label('objectSearchLoadFailed', 'Failed to load objects: $1', [err?.message || String(err)]),
            'error'
          );
        }
      });
  }

  function ensureRail() {
    const existing = document.getElementById(HOST_ID);
    if (existing) {
      if (existing.shadowRoot) railShadow = existing.shadowRoot;
      applyRailLocale();
      return;
    }

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
    railShadow = shadow;
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
          background: ${THEME.apex.railGradient};
          border-color: ${THEME.apex.railBorder};
          color: ${THEME.apex.railText};
        }
        .apex:hover { color: #fff; }
        .soql {
          background: ${THEME.soql.railGradient};
          border-color: ${THEME.soql.railBorder};
          color: ${THEME.soql.railText};
        }
        .soql:hover { color: #fff; }
        .object {
          background: ${THEME.object.railGradient};
          border-color: ${THEME.object.railBorder};
          color: ${THEME.object.railText};
        }
        .object:hover { color: #fff; }
      </style>
      <div class="rail" part="rail">
        <button type="button" class="tab apex" data-tool="apex-log" title="">
          <span class="text"></span>
        </button>
        <button type="button" class="tab soql" data-tool="soql" title="">
          <span class="text"></span>
        </button>
        <button type="button" class="tab object" data-tool="object-search" title="">
          <span class="text"></span>
        </button>
      </div>
    `;
    applyRailLocale();

    const rail = shadow.querySelector('.rail');
    let dragState = null;
    let savedPos = null;

    loadPos().then((pos) => {
      // Migrate old free-X positions: keep Y, always pin to right edge
      if (pos && typeof pos.top === 'number') {
        savedPos = clampPos(pos.top, host);
        applyPos(host, savedPos);
        if (pos.right !== 0) savePos(savedPos);
      } else {
        savedPos = null;
        applyPos(host, null);
      }
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
      // Edge-constrained: stay on right edge; only vertical (Y) movement
      const next = clampPos(dragState.originTop + dy, host);
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
      if (state.toolId === 'object-search') {
        openObjectSearchModal();
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
        // 首次拖动前把百分比定位固化为像素，避免跳动；始终贴右边缘
        const pinned = clampPos(originTop, host);
        applyPos(host, pinned);
        dragState = {
          startX: e.clientX,
          startY: e.clientY,
          originTop: pinned.top,
          moved: false,
          toolId: btn.getAttribute('data-tool'),
          current: pinned
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
      if (!savedPos || typeof savedPos.top !== 'number') return;
      savedPos = clampPos(savedPos.top, host);
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

  function onLocalePreferenceChanged() {
    resolveEffectiveLocale().then(() => {
      applyRailLocale();
      applyModalLocale();
    });
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[LOCALE_STORAGE_KEY]) return;
      onLocalePreferenceChanged();
    });
  } catch {
    /* ignore */
  }

  resolveEffectiveLocale().then(() => {
    ensureRail();
  });

  // Lightning SPA 可能重建 DOM，定期确认入口仍在；弹层被清掉则丢弃状态
  const recheck = () => {
    try {
      ensureRail();
      if (modalState && !document.getElementById(MODAL_HOST_ID)) {
        modalState = null;
      }
    } catch {
      /* ignore */
    }
  };
  setInterval(recheck, 3000);
  document.addEventListener('DOMContentLoaded', recheck, { once: true });
})();
