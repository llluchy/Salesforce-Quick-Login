import { t } from '../i18n'

const isChromeExt = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage

export function useTotp() {
  const generateCode = (secret) => {
    if (!secret) return ''
    const script = document.createElement('script')
    script.src = '/js/totp.js'
    document.head.appendChild(script)

    return new Promise((resolve) => {
      script.onload = async () => {
        if (typeof window.generateTOTP === 'function') {
          try {
            const code = await window.generateTOTP(secret)
            document.head.removeChild(script)
            resolve(code)
          } catch (e) {
            document.head.removeChild(script)
            resolve('')
          }
        } else {
          document.head.removeChild(script)
          resolve('')
        }
      }
      script.onerror = () => {
        document.head.removeChild(script)
        resolve('123456')
      }
    })
  }

  const parseQRCode = (imageData) => {
    return new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = '/lib/jsqr.js'
      document.head.appendChild(script)

      script.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        const img = new Image()

        img.onload = () => {
          canvas.width = img.width
          canvas.height = img.height
          ctx.drawImage(img, 0, 0)
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = window.jsQR
            ? window.jsQR(imgData.data, imgData.width, imgData.height)
            : null
          document.head.removeChild(script)
          resolve(code ? code.data : null)
        }

        img.onerror = () => {
          document.head.removeChild(script)
          resolve(null)
        }

        img.src = imageData
      }

      script.onerror = () => {
        document.head.removeChild(script)
        resolve(null)
      }
    })
  }

  const scanQR = () => {
    if (isChromeExt) {
      return new Promise((resolve, reject) => {
        // 监听 background 推送的扫码结果
        const listener = async (msg) => {
          if (msg.action === 'qrScanResult') {
            chrome.runtime.onMessage.removeListener(listener)
            try {
              const parsed = await parseQRCode(msg.dataUrl)
              const raw = parsed || ''
              const secret = raw.startsWith('otpauth://')
                ? (new URL(raw)).searchParams.get('secret') || ''
                : raw
              if (!secret) {
                resolve({ success: false, error: t('totp.qrNotInArea') })
              } else {
                resolve({ success: true, secret, raw })
              }
            } catch (e) {
              resolve({ success: false, error: t('totp.qrFailed') })
            }
          } else if (msg.action === 'qrScanCancelled') {
            chrome.runtime.onMessage.removeListener(listener)
            reject('cancelled')
          } else if (msg.action === 'qrScanError') {
            chrome.runtime.onMessage.removeListener(listener)
            reject(msg.error || t('totp.scanFailed'))
          }
        }
        chrome.runtime.onMessage.addListener(listener)

        // 启动截图扫码（不依赖回调，结果通过上述 listener 接收）
        chrome.runtime.sendMessage({ action: 'startAreaQR' })
      })
    } else {
      return new Promise((resolve, reject) => {
        const secret = prompt('请输入 TOTP Secret (演示环境):', 'JBSWY3DPEHPK3PXP')
        if (secret) {
          resolve({ success: true, secret, mock: true })
        } else {
          reject(t('totp.cancelled'))
        }
      })
    }
  }

  return {
    generateCode,
    parseQRCode,
    scanQR
  }
}