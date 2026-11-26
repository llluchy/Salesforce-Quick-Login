<template>
  <Transition name="modal">
    <div
      v-if="visible"
      class="modal-overlay"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <div class="modal-content">
        <div class="modal-header">
          <h2 :id="titleId">{{ t('paymentReminder.title') }}</h2>
        </div>

        <div class="modal-body">
          <p class="intro">{{ t('paymentReminder.fee') }}</p>
          <p class="prompt">{{ t('paymentReminder.prompt') }}</p>

          <div class="choice-block">
            <strong>{{ t('paymentReminder.continueLabel') }}</strong>
            <ul>
              <li v-for="(item, i) in continueItems" :key="`c-${i}`">{{ item }}</li>
            </ul>
          </div>

          <div class="choice-block">
            <strong>{{ t('paymentReminder.deactivateLabel') }}</strong>
            <ul>
              <li v-for="(item, i) in deactivateItems" :key="`d-${i}`">{{ item }}</li>
            </ul>
          </div>

          <div class="contact">
            <span class="contact-label">{{ t('paymentReminder.contact') }}</span>
            <a
              v-for="email in contactEmails"
              :key="email"
              class="contact-email"
              :href="`mailto:${email}`"
            >{{ email }}</a>
          </div>
          <p v-if="error" class="error" role="alert">{{ t('paymentReminder.saveFailed') }}</p>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="btn btn-secondary"
            :disabled="saving"
            @click="onChoose('deactivate')"
          >{{ t('paymentReminder.deactivate') }}</button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="saving"
            @click="onChoose('continue')"
          >{{ t('paymentReminder.continue') }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CONTACT_EMAILS } from '../utils/paymentChoice'

const { t, tm } = useI18n()
const titleId = 'sfql-payment-reminder-title'

function listMessages(key) {
  const items = tm(key)
  return Array.isArray(items) ? items.map((item) => String(item)) : []
}

const continueItems = computed(() => listMessages('paymentReminder.continueItems'))
const deactivateItems = computed(() => listMessages('paymentReminder.deactivateItems'))

defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  saving: {
    type: Boolean,
    default: false
  },
  error: {
    type: [String, Object],
    default: null
  },
  contactEmails: {
    type: Array,
    default: () => [...CONTACT_EMAILS]
  }
})

const emit = defineEmits(['choose'])

function onChoose(choice) {
  emit('choose', choice)
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.modal-content {
  background-color: white;
  border-radius: 8px;
  width: 92%;
  max-width: 440px;
  max-height: 90vh;
  overflow: auto;
  box-shadow: 0 4px 20px rgba(25, 118, 210, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #bbdefb;
  background: linear-gradient(135deg, #1976d2 0%, #1565c0 100%);
  color: #ffffff;
}

.modal-header h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.4;
  color: #ffffff;
}

.modal-body {
  padding: 16px;
  background: #f5f9ff;
}

.intro,
.prompt {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.55;
  color: #334155;
}

.choice-block {
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #bbdefb;
  border-radius: 6px;
  background: #ffffff;
}

.choice-block strong {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #0d47a1;
}

.choice-block ul {
  margin: 0;
  padding-left: 18px;
}

.choice-block li {
  font-size: 12px;
  line-height: 1.5;
  color: #475569;
  margin-bottom: 4px;
}

.choice-block li:last-child {
  margin-bottom: 0;
}

.contact {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.contact-label {
  font-size: 12px;
  color: #546e7a;
}

.contact-email {
  font-size: 13px;
  color: #1565c0;
  word-break: break-all;
}

.error {
  margin: 12px 0 0;
  font-size: 12px;
  color: #c62828;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px;
  border-top: 1px solid #bbdefb;
  background: #f5f9ff;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: #e3f2fd;
  color: #0d47a1;
  border: 1px solid #bbdefb;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #bbdefb;
}

.btn-primary {
  background-color: #1976d2;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #1565c0;
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.3s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.9);
}
</style>
