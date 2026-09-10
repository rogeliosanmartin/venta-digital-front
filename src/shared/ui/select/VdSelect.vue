<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

export type VdSelectOption = {
  value: string | number | null;
  label: string;
  hint?: string;
};

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null;
    options: VdSelectOption[];
    placeholder?: string;
    disabled?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    /** Si hay búsqueda vacía, muestra estas opciones en vez de toda la lista. */
    defaultOptions?: VdSelectOption[];
  }>(),
  {
    placeholder: 'Selecciona',
    disabled: false,
    searchable: false,
    searchPlaceholder: 'Buscar…',
    defaultOptions: () => [],
  },
);

const emit = defineEmits<{
  'update:modelValue': [value: string | number | null];
}>();

const open = ref(false);
const query = ref('');
const rootEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const panelStyle = ref<Record<string, string>>({});

const selected = computed(
  () =>
    props.options.find((opt) => sameValue(opt.value, props.modelValue)) ?? null,
);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (q) {
    return props.options.filter((opt) =>
      `${opt.label} ${opt.hint ?? ''}`.toLowerCase().includes(q),
    );
  }
  if (!props.defaultOptions.length) return props.options;
  const pinned = [...props.defaultOptions];
  if (
    selected.value &&
    !pinned.some((opt) => sameValue(opt.value, selected.value?.value))
  ) {
    pinned.unshift(selected.value);
  }
  return pinned;
});

function sameValue(a: unknown, b: unknown) {
  if (a == null && (b == null || b === '')) return true;
  if (b == null && (a == null || a === '')) return true;
  return a === b || String(a) === String(b);
}

function placePanel() {
  const el = rootEl.value;
  if (!el) return;
  const box = el.getBoundingClientRect();
  const gap = 6;
  const pad = 8;
  const needed = panelEl.value?.scrollHeight ?? 260;
  const spaceBelow = window.innerHeight - box.bottom - pad;
  const spaceAbove = box.top - pad;
  const openUp = spaceBelow < Math.min(needed, 220) && spaceAbove > spaceBelow;
  const available = (openUp ? spaceAbove : spaceBelow) - gap;
  const left = Math.max(
    pad,
    Math.min(box.left, window.innerWidth - box.width - pad),
  );
  panelStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    width: `${box.width}px`,
    zIndex: '1100',
    maxHeight: `${Math.min(360, Math.max(168, available))}px`,
    top: openUp ? 'auto' : `${box.bottom + gap}px`,
    bottom: openUp ? `${window.innerHeight - box.top + gap}px` : 'auto',
  };
}

async function openMenu() {
  if (props.disabled) return;
  open.value = true;
  query.value = '';
  await nextTick();
  placePanel();
  requestAnimationFrame(placePanel);
  searchEl.value?.focus();
}

function closeMenu() {
  open.value = false;
  query.value = '';
}

function toggle() {
  if (open.value) closeMenu();
  else void openMenu();
}

function pick(opt: VdSelectOption) {
  emit('update:modelValue', opt.value);
  closeMenu();
}

function onDocPointer(event: PointerEvent) {
  const target = event.target as Node;
  if (rootEl.value?.contains(target) || panelEl.value?.contains(target)) return;
  closeMenu();
}

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  closeMenu();
}

watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener('pointerdown', onDocPointer, true);
    window.addEventListener('resize', placePanel);
    window.addEventListener('scroll', placePanel, true);
    window.addEventListener('keydown', onKey, true);
    return;
  }
  document.removeEventListener('pointerdown', onDocPointer, true);
  window.removeEventListener('resize', placePanel);
  window.removeEventListener('scroll', placePanel, true);
  window.removeEventListener('keydown', onKey, true);
});

onBeforeUnmount(closeMenu);
</script>

<template>
  <div ref="rootEl" class="vd-select" :class="{ open, disabled }">
    <button
      type="button"
      class="vd-select__trigger"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggle"
    >
      <span :class="{ muted: !selected }">
        {{ selected?.label || placeholder }}
      </span>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="currentColor"
          d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"
        />
      </svg>
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelEl"
        class="vd-select__panel"
        :style="panelStyle"
        @keydown.esc.stop.prevent="closeMenu"
      >
        <input
          v-if="searchable"
          ref="searchEl"
          v-model="query"
          class="vd-select__search"
          type="search"
          :placeholder="searchPlaceholder"
          autocomplete="off"
        />
        <ul class="vd-select__list" role="listbox">
          <li v-for="opt in filtered" :key="String(opt.value ?? 'empty')">
            <button
              type="button"
              class="vd-select__option"
              :class="{ on: sameValue(opt.value, modelValue) }"
              role="option"
              :aria-selected="sameValue(opt.value, modelValue)"
              @click="pick(opt)"
            >
              <strong>{{ opt.label }}</strong>
              <small v-if="opt.hint">{{ opt.hint }}</small>
            </button>
          </li>
        </ul>
        <p v-if="!filtered.length" class="vd-select__empty">Sin coincidencias</p>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.vd-select {
  width: 100%;
  min-width: 0;
}

.vd-select__trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  width: 100%;
  min-height: 46px;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--vd-line);
  border-radius: 10px;
  background: #fff;
  color: var(--vd-ink);
  font: inherit;
  font-size: 16px;
  text-align: left;
  cursor: pointer;
}

.vd-select__trigger span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vd-select__trigger span.muted {
  color: var(--vd-muted);
}

.vd-select__trigger svg {
  flex-shrink: 0;
  color: var(--vd-muted);
  transition: transform 0.15s ease;
}

.vd-select.open .vd-select__trigger {
  border-color: var(--gsm-blue);
  box-shadow: 0 0 0 3px rgba(53, 100, 125, 0.12);
}

.vd-select.open .vd-select__trigger svg {
  transform: rotate(180deg);
  color: var(--gsm-blue);
}

.vd-select.disabled .vd-select__trigger {
  opacity: 0.65;
  cursor: default;
}

.vd-select__panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  z-index: 1100;
  padding: 0.35rem;
  border: 1px solid var(--vd-line);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 14px 32px rgba(2, 53, 125, 0.14);
}

.vd-select__search {
  width: 100%;
  min-height: 40px;
  margin: 0 0 0.3rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--vd-line);
  border-radius: 8px;
  font: inherit;
  font-size: 15px;
  box-sizing: border-box;
}

.vd-select__search:focus {
  outline: none;
  border-color: var(--gsm-blue);
}

.vd-select__list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
  min-height: 0;
  flex: 1;
}

.vd-select__option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  width: 100%;
  padding: 0.55rem 0.65rem;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.vd-select__option strong {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--vd-ink);
}

.vd-select__option small {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--vd-muted);
}

.vd-select__option:hover,
.vd-select__option.on {
  background: #eef5f8;
}

.vd-select__option.on strong {
  color: var(--gsm-blue);
}

.vd-select__empty {
  margin: 0.35rem 0.4rem;
  color: var(--vd-muted);
  font-size: 0.82rem;
}
</style>
