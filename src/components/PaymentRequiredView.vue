<template>
  <section class="pay-required" role="region" :aria-label="t('payment.requiredTitle')">
    <h1 class="pay-title">{{ t('payment.requiredTitle') }}</h1>
    <p class="pay-price">{{ t('payment.priceOnce') }}</p>

    <button
      type="button"
      class="pay-btn"
      :disabled="busy"
      @click="onPay"
    >
      {{ t('payment.payCta') }}
    </button>

    <button
      type="button"
      class="pay-refresh"
      :disabled="busy"
      @click="onRefresh"
    >
      {{ t('payment.refreshStatus') }}
    </button>

    <p v-if="notice" class="pay-notice" role="status">{{ notice }}</p>

    <div class="pay-contact">
      <p class="pay-contact-label">{{ t('payment.contactLabel') }}</p>
      <a
        v-for="email in emails"
        :key="email"
        class="pay-email"
        :href="`mailto:${email}`"
      >{{ email }}</a>
    </div>
  </section>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PAYMENT_CONTACT_EMAILS } from '../utils/paymentContacts.js'
import { usePaymentGate } from '../composables/usePaymentGate.js'

const { t } = useI18n()
const { openCheckout, refreshPaidStatus } = usePaymentGate()

const emails = PAYMENT_CONTACT_EMAILS
const busy = ref(false)
const notice = ref('')

async function onPay() {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    await openCheckout()
  } catch {
    notice.value = t('payment.checkoutFailed')
  } finally {
    busy.value = false
  }
}

async function onRefresh() {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    const paid = await refreshPaidStatus()
    notice.value = paid ? t('payment.paidUnlocked') : t('payment.stillUnpaid')
  } catch {
    notice.value = t('payment.refreshFailed')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pay-required {
  box-sizing: border-box;
  width: 100%;
  max-width: 360px;
  margin: 0 auto;
  padding: 24px 16px;
  text-align: center;
}

.pay-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 700;
  color: #1a237e;
}

.pay-price {
  margin: 0 0 20px;
  font-size: 14px;
  color: #455a64;
}

.pay-btn {
  display: block;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: 8px;
  background: #1565c0;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.pay-btn:disabled,
.pay-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.pay-refresh {
  display: block;
  width: 100%;
  margin-top: 10px;
  padding: 8px 14px;
  border: 1px solid #90caf9;
  border-radius: 8px;
  background: #fff;
  color: #1565c0;
  font-size: 13px;
  cursor: pointer;
}

.pay-notice {
  margin: 12px 0 0;
  padding: 8px;
  border-radius: 6px;
  background: #e3f2fd;
  color: #0d47a1;
  font-size: 12px;
  line-height: 1.4;
}

.pay-contact {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e0e0e0;
}

.pay-contact-label {
  margin: 0 0 8px;
  font-size: 12px;
  color: #607d8b;
}

.pay-email {
  display: block;
  margin: 4px 0;
  font-size: 13px;
  color: #1565c0;
  text-decoration: none;
  word-break: break-all;
}

.pay-email:hover {
  text-decoration: underline;
}
</style>
