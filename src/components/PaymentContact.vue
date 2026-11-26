<template>
  <div class="payment-contact" role="group" :aria-label="t('payment.contactLabel')">
    <div class="payment-contact-label">{{ t('payment.contactLabel') }}</div>
    <ul class="payment-contact-list">
      <li v-for="email in emails" :key="email">
        <a class="payment-contact-link" :href="mailtoHref(email)">{{ email }}</a>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { PAYMENT_CONTACT_EMAILS, mailtoHref } from '../utils/paymentContact'

const { t } = useI18n()
const emails = PAYMENT_CONTACT_EMAILS
</script>

<style scoped>
.payment-contact {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #e3f2fd;
}

.payment-contact-label {
  font-size: 11px;
  color: #5c7a9b;
  margin-bottom: 4px;
}

.payment-contact-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.payment-contact-link {
  font-size: 12px;
  color: #1565c0;
  text-decoration: none;
  word-break: break-all;
}

.payment-contact-link:hover {
  text-decoration: underline;
}
</style>
