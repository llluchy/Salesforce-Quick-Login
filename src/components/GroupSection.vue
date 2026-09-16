<template>
  <div class="group-section" :class="{ 'group-collapsed': group.collapsed }" ref="groupRef" :data-group-id="group.id">
    <GroupHeader
      :group="group"
      :count="environments.length"
      @toggle="$emit('toggle-collapse', group.id)"
      @edit="$emit('edit-group', group)"
      @delete="$emit('delete-group', group)"
    />

    <div class="group-content" ref="contentRef" v-show="!group.collapsed">
      <EnvCard
        v-for="env in environments"
        :key="env.id"
        :env="env"
        @login="$emit('login', env)"
        @edit="$emit('edit-env', env)"
        @clone="$emit('clone-env', env)"
        @delete="$emit('delete-env', env)"
        @show-totp="$emit('show-totp', env)"
        @copy-success="$emit('copy-success', $event)"
      />

      <div class="empty-group-hint" v-if="environments.length === 0">
        <span>{{ t('group.emptyHint') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Sortable from 'sortablejs'
import GroupHeader from './GroupHeader.vue'
import EnvCard from './EnvCard.vue'

const { t } = useI18n()

const props = defineProps({
  group: {
    type: Object,
    required: true
  },
  environments: {
    type: Array,
    default: () => []
  },
  groups: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'toggle-collapse',
  'edit-group',
  'delete-group',
  'login',
  'edit-env',
  'clone-env',
  'delete-env',
  'show-totp',
  'copy-success',
  'drag-env'
])

const groupRef = ref(null)
const contentRef = ref(null)
let sortableInstance = null

const initSortable = () => {
  if (!contentRef.value) return

  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }

  sortableInstance = new Sortable(contentRef.value, {
    group: {
      name: 'env-cards',
      pull: true,
      put: true
    },
    handle: '.env-drag-handle',
    animation: 150,
    ghostClass: 'env-ghost',
    chosenClass: 'env-chosen',
    dragClass: 'env-drag',
    forceFallback: true,
    fallbackClass: 'env-drag',
    fallbackOnBody: true,
    fallbackTolerance: 0,
    onStart: () => {
      document.body.style.cursor = 'grabbing'
    },
    onEnd: (evt) => {
      document.body.style.cursor = ''

      // 恢复 Sortable 的跨分组 DOM 移动，避免 Vue 响应式更新时出现重复卡片
      if (evt.from !== evt.to) {
        if (evt.oldIndex < evt.from.children.length) {
          evt.from.insertBefore(evt.item, evt.from.children[evt.oldIndex])
        } else {
          evt.from.appendChild(evt.item)
        }
      }

      const fromGroupEl = evt.from.closest('.group-section')
      const toGroupEl = evt.to.closest('.group-section')

      const fromGroupId = fromGroupEl?.dataset?.groupId || props.group.id
      const toGroupId = toGroupEl?.dataset?.groupId || props.group.id

      if (fromGroupId === toGroupId && evt.oldIndex === evt.newIndex) {
        return
      }

      emit('drag-env', {
        fromGroupId,
        toGroupId,
        fromIndex: evt.oldIndex,
        toIndex: evt.newIndex
      })
    }
  })
}

onMounted(() => {
  nextTick(() => {
    initSortable()
  })
})

onBeforeUnmount(() => {
  if (sortableInstance) {
    sortableInstance.destroy()
    sortableInstance = null
  }
})

watch(() => props.environments.length, () => {
  nextTick(() => {
    initSortable()
  })
})

watch(() => props.group.collapsed, (collapsed) => {
  if (!collapsed) {
    nextTick(() => {
      initSortable()
    })
  }
})
</script>

<style scoped>
.group-section {
  margin-bottom: 10px;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.group-content {
  padding: 6px;
  background-color: #f5f9ff;
  border-top: 1px solid #bbdefb;
  min-height: 36px;
}

.empty-group-hint {
  text-align: center;
  padding: 10px;
  color: #bbb;
  font-size: 12px;
}

.group-collapsed .group-content {
  display: none;
}
</style>
