function sendApex(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('非扩展环境'))
      return
    }
    chrome.runtime.sendMessage({ action, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      resolve(response || { success: false, error: '无响应' })
    })
  })
}

export function useApexLogApi() {
  return {
    discover: () => sendApex('apexLog:discover'),
    getState: () => sendApex('apexLog:getState'),
    switchEnv: (envId) => sendApex('apexLog:switchEnv', { envId }),
    fetchLogs: (limit = 100) => sendApex('apexLog:fetchLogs', { limit }),
    fetchLogBody: (logId) => sendApex('apexLog:fetchLogBody', { logId }),
    renewTraceFlag: (durationMinutes = 60) =>
      sendApex('apexLog:renewTraceFlag', { durationMinutes }),
    traceWatch: (envId, viewerId) =>
      sendApex('apexLog:traceWatch', { envId, viewerId }),
    traceUnwatch: (viewerId) =>
      sendApex('apexLog:traceUnwatch', { viewerId }),
    trackProcessAutomated: (durationMinutes = 60) =>
      sendApex('apexLog:trackProcessAutomated', { durationMinutes }),
    searchUsers: (filters, limit = 40) =>
      sendApex('apexLog:searchUsers', { filters, limit }),
    trackUser: (user, durationMinutes = 60, extras = {}) =>
      sendApex('apexLog:trackUser', { user, durationMinutes, ...extras }),
    startPolling: (intervalMs = 3000) =>
      sendApex('apexLog:startPolling', { intervalMs }),
    stopPolling: () => sendApex('apexLog:stopPolling')
  }
}
