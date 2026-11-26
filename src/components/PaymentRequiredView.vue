<template>
  <div class="payment-required" data-testid="payment-required">
    <div class="payment-status" :class="{ paid: isPaid }">
      <span class="payment-status-text">
        {{ isPaid ? t('payment.statusPaid') : t('payment.statusUnpaid') }}
      </span>
      <span v-if="priceHint" class="payment-price">{{ t('payment.priceOnce') }}</span>
    </div>

    <div class="payment-actions">
      <button
        v-if="!isPaid"
        type="button"
        class="btn btn-primary"
        :disabled="busy"
        @click="onPay"
      >
        <span v-if="checkoutLoading" class="spinner-mini"></span>
        <span>{{ checkoutLoading ? t('payment.openingCheckout') : t('payment.pay') }}</span>
      </button>
      <button
        type="button"
        class="btn btn-outline"
        :disabled="busy"
        @click="onRefresh"
      >
        <span v-if="billingLoading" class="spinner-mini"></span>
        <span>{{ t('payment.refreshPaid') }}</span>
      </button>
    </div>

    <div v-if="errorText" class="payment-error" role="alert">{{ errorText }}</div>

    <PaymentContact />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBilling } from '../composables/useBilling'
import PaymentContact from './PaymentContact.vue'

defineProps({
  /** 未付费时是否展示一次性价格短文案 */
  priceHint: { type: Boolean, default: true }
})

const { t } = useI18n()
const {
  isPaid,
  billingLoading,
  checkoutLoading,
  billingError,
  refreshBilling,
  startCheckout
} = useBilling()

const localError = ref('')

const busy = computed(() => billingLoading.value || checkoutLoading.value)
const errorText = computed(() => localError.value || mapBillingError(billingError.value))

function mapBillingError(code) {
  if (!code) return ''
  if (code === 'supabase_unavailable') return t('payment.errorUnavailable')
  if (code === 'checkout_failed' || /checkout/i.test(code)) return t('payment.errorCheckout')
  if (code === 'billing_fetch_failed') return t('payment.errorRefresh')
  return t('payment.errorGeneric')
}

async function onPay() {
  localError.value = ''
  try {
    await startCheckout()
  } catch {
    if (!billingError.value) localError.value = t('payment.errorCheckout')
  }
}

async function onRefresh() {
  localError.value = ''
  try {
    await refreshBilling()
  } catch {
    if (!billingError.value) localError.value = t('payment.errorRefresh')
  }
}
</script>

<style scoped>
.payment-required {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.payment-status {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: #fff8e1;
  border: 1px solid #ffe082;
  border-radius: 6px;
}

.payment-status.paid {
  background: #e8f5e9;
  border-color: #a5d6a7;
}

.payment-status-text {
  font-size: 13px;
  font-weight: 600;
  color: #0d47a1;
}

.payment-status.paid .payment-status-text {
  color: #1b5e20;
}

.payment-price {
  font-size: 11px;
  color: #5c7a9b;
}

.payment-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  box-sizing: border-box;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: white;
}

.btn-outline {
  background: white;
  color: #1565c0;
  border-color: #90caf9;
}

.payment-error {
  font-size: 12px;
  color: #c62828;
  background: #ffebee;
  border: 1px solid #ffcdd2;
  border-radius: 6px;
  padding: 8px 10px;
}

.spinner-mini {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.35);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.btn-outline .spinner-mini {
  border-color: rgba(21, 101, 192, 0.25);
  border-top-color: #1565c0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
