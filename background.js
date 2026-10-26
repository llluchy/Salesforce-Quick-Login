// ============================================
// 云同步诊断日志（开发版扩展 chrome.storage.sync 行为受限制）
// 在 Service Worker 控制台查看（chrome://extensions → 检查视图 service worker）
// ============================================
import { TOOL_WINDOW_DEFS, buildToolWindowUrl, openObjectDetailTab } from './src/tools/_shared/toolWindows.js'
import {
  listLoggedInSfEnvironments,
  getSession,
  normalizeSfHostname
} from './src/tools/_shared/sfSessionBg.js'
import { handleApexLogMessage, initApexLogBackground } from './src/tools/apex-log/apexLogBackground.js'

const SF_API_VERSION = '64.0'
const SF_REST_CLIENT_ID = 'Salesforce Quick Login SOQL'

/** Content script 代理：用 Cookie sid 调 Salesforce REST（绕过页面 CORS） */
async function sfRestViaSession(hostname, path) {
  const hostIn = normalizeSfHostname(hostname || '')
  if (!hostIn) throw new Error('hostname 为空')
  const session = await getSession(hostIn)
  if (!session?.key) throw new Error('未找到 sid Cookie')
  const host = session.hostname || hostIn
  const url = path.startsWith('http')
    ? path
    : `https://${host}/services/data/v${SF_API_VERSION}${path}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json; charset=UTF-8',
      Authorization: `Bearer ${session.key}`,
      'Sforce-Call-Options': `client=${SF_REST_CLIENT_ID}`
    }
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (res.status === 401) {
    const msg =
      Array.isArray(data) && data[0]?.message ? data[0].message : 'Session 已过期，请重新登录该 Org'
    const err = new Error(msg)
    err.name = 'Unauthorized'
    throw err
  }
  if (res.status < 200 || res.status >= 300) {
    let message = `HTTP ${res.status}`
    if (Array.isArray(data)) {
      message = data
        .map((d) => `${d.errorCode || ''}: ${d.message || ''}`.trim())
        .join('\n')
    } else if (data?.message) {
      message = data.message
    }
    throw new Error(message)
  }
  return { success: true, data, hostname: host, sessionId: session.key }
}

initApexLogBackground().catch((e) => console.warn('[ApexLog] init failed', e))

const _BG_TAG = '[CloudSync/BG]'
const _bgLog = (action, detail) => {}
const _bgWarn = (action, detail) => {}
const _bgErr = (action, err) => console.error(`${_BG_TAG} ✗ ${action}`, err || '')

// Service Worker 启动时输出环境信息
_bgLog('Service Worker 启动', (() => {
  try {
    const manifest = chrome.runtime.getManifest()
    const info = {
      extensionId: chrome.runtime.id,
      name: manifest.name,
      version: manifest.version,
      manifestVersion: manifest.manifest_version,
      // update_url 仅 Web Store 安装的扩展才有；开发版/未打包没有
      hasUpdateUrl: 'update_url' in manifest,
      installType: '(unknown)'
    }
    info.isFromWebStore = info.hasUpdateUrl
    info.isDev = !info.hasUpdateUrl

    // chrome.management.getSelf 可获取 installType
    // 但需要 management 权限，因此包在 try/catch 里
    if (chrome.management && chrome.management.getSelf) {
      chrome.management.getSelf().then(selfInfo => {
        _bgLog('installType', { installType: selfInfo.installType })
        if (selfInfo.installType === 'development') {
          _bgWarn('当前为开发版扩展 (development)', {
            note: 'chrome.storage.sync 在开发版扩展中行为受限',
            impact: '可能无法真正同步到 Google 账户云端，仅表现为本地持久存储',
            advice: '数据可能在卸载扩展时丢失，需要从 Chrome Web Store 安装才能使用真正的云同步'
          })
        }
      }).catch(e => _bgWarn('getSelf 失败', e.message))
    }
    return info
  } catch (e) {
    return { error: e.message }
  }
})())

// 监听 storage.onChanged 事件，输出 storage 变化日志
chrome.storage.onChanged.addListener((changes, areaName) => {
  const interestingKeys = ['salesforce_environments', 'salesforce_groups']
  const relevant = Object.keys(changes).filter(k => interestingKeys.includes(k))
  if (relevant.length === 0) return

  for (const key of relevant) {
    const change = changes[key]
    _bgLog(`storage.onChanged (${areaName})`, {
      key,
      oldValueCount: Array.isArray(change.oldValue) ? change.oldValue.length : (change.oldValue ? 'object' : '(empty)'),
      newValueCount: Array.isArray(change.newValue) ? change.newValue.length : (change.newValue ? 'object' : '(empty)'),
      newValueIds: Array.isArray(change.newValue) ? change.newValue.map(e => e.id) : null
    })
  }
})

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (error) {
    // 静默失败
  }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

// ========== 工具独立窗口（不随 Side Panel 关闭）==========
/** toolId -> chrome.windows windowId */
const toolWindowIds = Object.create(null)

async function resolvePageEnvContext(hostname) {
  const host = normalizeSfHostname(hostname || '')
  if (!host) return { hostname: '', orgId: '' }
  let orgId = ''
  try {
    const session = await getSession(host)
    if (session?.key && String(session.key).includes('!')) {
      orgId = String(session.key).split('!')[0]
    }
  } catch (e) {
    // 解析失败时仍按 hostname 匹配
  }
  return { hostname: host, orgId }
}

function notifyToolPreferEnvironment(toolId, ctx) {
  if (!toolId || (!ctx?.hostname && !ctx?.orgId)) return
  try {
    chrome.runtime
      .sendMessage({
        action: 'toolPreferEnvironment',
        toolId,
        hostname: ctx.hostname || '',
        orgId: ctx.orgId || ''
      })
      .catch(() => {})
  } catch {
    /* ignore */
  }
}

async function openToolWindow(toolId, options = {}) {
  const def = TOOL_WINDOW_DEFS[toolId]
  if (!def) {
    return { success: false, error: '未知工具：' + toolId }
  }

  const ctx = await resolvePageEnvContext(options.hostname || '')
  const extra = {}
  if (ctx.hostname) extra.hostname = ctx.hostname
  if (ctx.orgId) extra.orgId = ctx.orgId

  const existingId = toolWindowIds[toolId]
  if (existingId != null) {
    try {
      await chrome.windows.update(existingId, { focused: true })
      notifyToolPreferEnvironment(toolId, ctx)
      return { success: true, focused: true, windowId: existingId, ...ctx }
    } catch (e) {
      delete toolWindowIds[toolId]
    }
  }

  const pageUrl =
    buildToolWindowUrl(toolId, extra) ||
    chrome.runtime.getURL(def.page) + (def.query ? `?${def.query}` : '')
  try {
    const win = await chrome.windows.create({
      url: pageUrl,
      type: def.type || 'popup',
      width: def.width,
      height: def.height,
      focused: true
    })
    if (win?.id != null) {
      toolWindowIds[toolId] = win.id
    }
    return { success: true, created: true, windowId: win?.id, url: pageUrl, ...ctx }
  } catch (e) {
    console.error('[ToolWindow] 打开失败', toolId, pageUrl, e)
    return { success: false, error: e.message || String(e), url: pageUrl }
  }
}

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [toolId, id] of Object.entries(toolWindowIds)) {
    if (id === windowId) {
      delete toolWindowIds[toolId]
      break
    }
  }
})

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (handleApexLogMessage(request, sender, sendResponse)) {
    return true
  }

  if (request.action === 'openToolWindow') {
    openToolWindow(request.toolId, { hostname: request.hostname || '' })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }))
    return true
  }

  // Content 浮动栏：打开 Object Detail（须带 object + hostname，可选 id）
  if (request.action === 'openObjectDetailTab') {
    const objectName = request.object || request.objectName || ''
    const hostname = request.hostname || ''
    const recordId = request.id || request.recordId || ''
    if (!objectName) {
      sendResponse({ success: false, error: '缺少 object 参数' })
      return true
    }
    if (!hostname) {
      sendResponse({ success: false, error: '缺少 hostname 参数' })
      return true
    }
    openObjectDetailTab({ objectName, hostname, recordId: recordId || undefined })
      .then((tab) => sendResponse({ success: true, tabId: tab?.id }))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }))
    return true
  }

  // Content 对象搜索：Global Describe / describeSObject
  if (request.action === 'sfGetSObjects') {
    sfRestViaSession(request.hostname || '', '/sobjects/')
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }))
    return true
  }

  if (request.action === 'sfDescribeSObject') {
    const name = request.object || request.objectName || ''
    if (!name) {
      sendResponse({ success: false, error: '缺少 object 参数' })
      return true
    }
    sfRestViaSession(
      request.hostname || '',
      `/sobjects/${encodeURIComponent(name)}/describe/`
    )
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }))
    return true
  }

  if (request.action === 'listSfEnvironments') {
    listLoggedInSfEnvironments()
      .then((environments) => sendResponse({ success: true, environments }))
      .catch((error) =>
        sendResponse({ success: false, error: error.message || String(error), environments: [] })
      )
    return true
  }

  if (request.action === 'getSfSession') {
    const hostname = normalizeSfHostname(request.hostname || '')
    if (!hostname) {
      sendResponse({ success: false, error: 'hostname 为空' })
      return true
    }
    getSession(hostname)
      .then((session) => {
        if (!session?.key) {
          sendResponse({ success: false, error: '未找到 sid Cookie' })
          return
        }
        sendResponse({
          success: true,
          session: {
            sessionId: session.key,
            hostname: session.hostname,
            instanceUrl: `https://${session.hostname}`
          }
        })
      })
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }))
    return true
  }

  if (request.action === 'captureVisibleTab') {
    chrome.tabs.captureVisibleTab({ format: 'png' })
      .then((dataUrl) => sendResponse({ success: true, dataUrl }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'startAreaQR') {
    handleStartAreaQR();
    return; // 无需 sendResponse，结果通过 qrScanResult/qrScanError 推送
  }

  if (request.action === 'areaSelected') {
    chrome.runtime.sendMessage({ action: 'qrScanResult', dataUrl: request.dataUrl }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'areaCancelled') {
    chrome.runtime.sendMessage({ action: 'qrScanCancelled', reason: request.reason || 'cancelled' }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'login') {
    handleLoginAction(request, sendResponse);
    return true;
  }

  if (request.action === 'soapLogin') {
    handleSoapLogin(request, sendResponse);
    return true;
  }

  if (request.action === 'formPostLogin') {
    handleFormPostLogin(request, sendResponse);
    return true;
  }

  // ========== Passkey 凭证与环境管理（v3 架构：Content 直接发给 Side Panel）==========
  // Background 不再转发 Passkey 消息，content.js 直接通过 chrome.runtime.sendMessage 发给 Side Panel
  // Side Panel 的 usePasskeyBridge.js 监听 bg:* 动作并处理

  // ========== Session Storage 回退（当 content script 无法直接访问时）==========
  if (request.action === '__sf_sessionGet') {
    (async () => {
      try {
        const result = await chrome.storage.session.get(request.keys);
        _bgLog('__sf_sessionGet', { keys: request.keys, foundKeys: Object.keys(result) });
        
        if (request.keys.includes('sf_isLoggedIn') && !result.sf_isLoggedIn) {
           const localData = await chrome.storage.local.get(['__sf_supabase_session']);
           if (localData.__sf_supabase_session) {
             _bgLog('__sf_sessionGet 从 local storage 恢复登录状态');
             result.sf_isLoggedIn = true;
           }
        }
        
        sendResponse(result);
      } catch (e) {
        console.error('[BG] sessionGet 失败', e);
        sendResponse({});
      }
    })();
    return true;
  }

  if (request.action === '__sf_sessionSet') {
    chrome.storage.session.set(request.data)
      .then(() => sendResponse({ success: true }))
      .catch((e) => { console.error('[BG] sessionSet 失败', e); sendResponse({ success: false }); });
    return true;
  }

  // ========== Local Storage 读取（供 page-world 回退使用）==========
  if (request.action === '__sf_localGet') {
    chrome.storage.local.get(request.keys)
      .then((result) => {
        _bgLog('__sf_localGet', { keys: request.keys, foundKeys: Object.keys(result) });
        sendResponse(result);
      })
      .catch((e) => { console.error('[BG] localGet 失败', e); sendResponse({}); });
    return true;
  }

})

async function handleStartAreaQR() {
  try {
    // 遍历所有普通浏览器窗口的所有标签，找到第一个 active 标签
    const windows = await chrome.windows.getAll({
      populate: true,
      windowTypes: ['normal']
    });
    
    let tab = null;
    let targetWindow = null;
    for (const win of windows) {
      if (win.tabs) {
        const activeTab = win.tabs.find(t => t.active);
        if (activeTab) {
          tab = activeTab;
          targetWindow = win;
          break;
        }
      }
    }
    
    if (!tab || !tab.id) {
      chrome.runtime.sendMessage({ action: 'qrScanError', error: '未找到活动标签页' }).catch(() => {});
      return;
    }

    const url = tab.url || '';
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('edge://') || url === '') {
      chrome.runtime.sendMessage({ action: 'qrScanError', error: '当前页面不支持截屏操作' }).catch(() => {});
      return;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(targetWindow.id, { format: 'png' });

    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'startAreaSelect',
        dataUrl: dataUrl
      });
    } catch (sendError) {
      if (sendError.message && sendError.message.includes('Receiving end does not exist')) {
        // 从 manifest 动态获取 content script 路径（CRXJS 打包后文件名带 hash）
        const contentScripts = chrome.runtime.getManifest().content_scripts;
        const contentJsFile = contentScripts && contentScripts[0] && contentScripts[0].js[0]
          ? contentScripts[0].js[0]
          : 'content.js';
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [contentJsFile]
        });
        await chrome.tabs.sendMessage(tab.id, {
          action: 'startAreaSelect',
          dataUrl: dataUrl
        });
      } else {
        throw sendError;
      }
    }
    // 成功启动框选，结果将通过 areaSelected/areaCancelled → qrScanResult/qrScanCancelled 推送
  } catch (error) {
    let errorMsg = error.message;
    if (errorMsg.includes('activeTab') || errorMsg.includes('Cannot access') || errorMsg.includes('Receiving end does not exist')) {
      errorMsg = '当前页面不支持截屏操作';
    }
    chrome.runtime.sendMessage({ action: 'qrScanError', error: errorMsg }).catch(() => {});
  }
}

async function handleLoginAction(request, sendResponse) {
  try {
    const { env } = request;
    if (!env || !env.username || !env.password) {
      sendResponse({ success: false, error: '缺少登录信息' });
      return;
    }

    let loginUrl;
    if (env.type === 'custom') {
      loginUrl = env.customUrl || 'https://login.salesforce.com';
    } else if (env.type === 'sandbox') {
      loginUrl = 'https://test.salesforce.com';
    } else {
      loginUrl = 'https://login.salesforce.com';
    }

    const tab = await chrome.tabs.create({ url: loginUrl });
    const tabId = tab.id;

    await waitForTabLoaded(tabId);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitHiddenForm,
      args: [loginUrl, env.username, env.password]
    });

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleSoapLogin(request, sendResponse) {
  try {
    const { type, username, password, url } = request;

    let soapUrl;
    if (type === 'production') {
      soapUrl = 'https://login.salesforce.com/services/Soap/c/64.0/';
    } else if (type === 'sandbox') {
      soapUrl = 'https://test.salesforce.com/services/Soap/c/64.0/';
    } else if (type === 'custom' && url) {
      const domainMatch = url.match(/https?:\/\/[^/]+/);
      if (!domainMatch) {
        sendResponse({ success: false, error: '自定义环境地址格式不正确' });
        return;
      }
      const domain = domainMatch[0];
      soapUrl = `${domain}/services/Soap/c/64.0/`;
    } else {
      sendResponse({ success: false, error: '不支持的环境类型' });
      return;
    }

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
    <env:Body>
        <n1:login xmlns:n1="urn:enterprise.soap.sforce.com">
            <n1:username>${username}</n1:username>
            <n1:_password>${password}</n1:_password>
        </n1:login>
    </env:Body>
</env:Envelope>`;

    const response = await fetch(soapUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'SOAPAction': 'login'
      },
      body: soapBody
    });

    const xmlText = await response.text();

    const result = {
      success: true,
      ok: response.ok,
      xmlText: xmlText
    };
    sendResponse(result);

  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleFormPostLogin(request, sendResponse) {
  try {
    const { loginUrl, username, password, totpCode } = request;

    const tab = await chrome.tabs.create({ url: loginUrl });
    const tabId = tab.id;

    await waitForTabLoaded(tabId);

    await chrome.scripting.executeScript({
      target: { tabId },
      func: submitHiddenForm,
      args: [loginUrl, username, password]
    });

    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

function submitHiddenForm(loginUrl, username, password) {
  const form = document.createElement("form");
  form.setAttribute("method", "POST");
  form.setAttribute("action", loginUrl);
  form.setAttribute("target", "_self");

  const unInput = document.createElement("input");
  unInput.setAttribute("type", "hidden");
  unInput.setAttribute("name", "un");
  unInput.setAttribute("value", username);

  const pwInput = document.createElement("input");
  pwInput.setAttribute("type", "hidden");
  pwInput.setAttribute("name", "pw");
  pwInput.setAttribute("value", password);

  const startUrlInput = document.createElement("input");
  startUrlInput.setAttribute("type", "hidden");
  startUrlInput.setAttribute("name", "startUrl");
  startUrlInput.setAttribute("value", loginUrl);

  form.appendChild(unInput);
  form.appendChild(pwInput);
  form.appendChild(startUrlInput);
  document.body.appendChild(form);
  form.submit();
}

function waitForTabLoaded(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeout);

    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 500);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}


