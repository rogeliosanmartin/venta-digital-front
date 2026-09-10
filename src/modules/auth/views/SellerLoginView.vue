<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const isDev = import.meta.env.DEV;
const step = ref<'phone' | 'pin'>('phone');
const cellphone = ref('');
const nipId = ref<number | null>(null);
const nip = ref('');
const localError = ref<string | null>(null);
const sessionExpired = computed(() => route.query.sesion === 'expirada');

async function requestPin() {
  localError.value = null;
  if (!/^\d{10}$/.test(cellphone.value)) {
    localError.value = 'Ingresa un celular de 10 dígitos';
    return;
  }

  if (isDev) {
    try {
      await auth.loginSellerDev(cellphone.value);
      router.replace({ name: 'vendedor-ventas' });
    } catch {
      localError.value = auth.error;
    }
    return;
  }

  try {
    const data = await auth.requestSellerPin(cellphone.value);
    if (!data.nipId) {
      localError.value = data.message;
      return;
    }
    nipId.value = data.nipId;
    step.value = 'pin';
  } catch {
    localError.value = auth.error;
  }
}

async function verifyPin() {
  localError.value = null;
  if (!nipId.value || !nip.value) {
    localError.value = 'Ingresa el PIN recibido';
    return;
  }

  try {
    await auth.verifySellerPin({
      nipId: nipId.value,
      nip: nip.value,
      cellphone: cellphone.value,
    });
    router.replace({ name: 'vendedor-ventas' });
  } catch {
    localError.value = auth.error;
  }
}
</script>

<template>
  <div class="login-shell">
    <header class="brand-panel">
      <img src="/logo-sanmartin-white.svg" alt="San Martín" class="logo-white" />
      <div class="brand-copy">
        <img src="/icons-palomasanmartin.svg" alt="" class="dove" />
        <h1>Venta Digital</h1>
        <p>
          {{
            isDev
              ? 'Acceso de vendedor (desarrollo: solo celular)'
              : 'Acceso de vendedor con PIN de WhatsApp'
          }}
        </p>
      </div>
      <small>Grupo San Martín</small>
    </header>

    <section class="form-panel">
      <form
        class="login-card"
        @submit.prevent="step === 'phone' ? requestPin() : verifyPin()"
      >
        <img src="/logo-gsm-azul.svg" alt="GSM" class="logo-blue" />
        <h2>{{ step === 'phone' ? 'Tu celular' : 'Código PIN' }}</h2>
        <p class="subtitle">
          {{
            step === 'phone'
              ? isDev
                ? 'En desarrollo entra solo con el celular registrado'
                : 'Te enviaremos un PIN por WhatsApp'
              : `PIN enviado a ${cellphone}`
          }}
        </p>
        <p v-if="sessionExpired" class="session-note" role="status">
          Tu sesión expiró. Inicia sesión de nuevo.
        </p>

        <div v-if="step === 'phone'" class="field">
          <label for="cellphone">Celular (10 dígitos)</label>
          <input
            id="cellphone"
            v-model="cellphone"
            type="tel"
            inputmode="numeric"
            maxlength="10"
            placeholder="6671234567"
            autocomplete="tel"
            required
          />
        </div>

        <div v-else class="field">
          <label for="nip">PIN recibido</label>
          <input
            id="nip"
            v-model="nip"
            type="text"
            inputmode="numeric"
            maxlength="8"
            placeholder="••••"
            autocomplete="one-time-code"
            required
          />
        </div>

        <p v-if="localError" class="error-text" role="alert">{{ localError }}</p>

        <button class="btn btn-primary submit" type="submit" :disabled="auth.loading">
          <span v-if="auth.loading" class="spinner" />
          <template v-if="step === 'phone'">
            {{
              auth.loading
                ? isDev
                  ? 'Entrando…'
                  : 'Enviando…'
                : isDev
                  ? 'Entrar'
                  : 'Enviar PIN'
            }}
          </template>
          <template v-else>
            {{ auth.loading ? 'Validando…' : 'Entrar' }}
          </template>
        </button>

        <button
          v-if="step === 'pin'"
          class="btn btn-ghost back"
          type="button"
          @click="step = 'phone'"
        >
          Cambiar celular
        </button>
        <button
          v-else
          class="btn btn-ghost back"
          type="button"
          @click="router.push({ name: 'home' })"
        >
          Volver
        </button>
      </form>
    </section>
  </div>
</template>

<style scoped>
.login-shell {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--vd-bg);
}

.brand-panel {
  background: var(--gsm-blue);
  color: var(--gsm-white);
  padding: 1.35rem 1.35rem 1.7rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  border-bottom: 3px solid var(--gsm-cafe);
}

.logo-white {
  width: min(150px, 48%);
}

.dove {
  width: 36px;
  margin-bottom: 0.4rem;
  filter: brightness(0) invert(1);
  opacity: 0.9;
}

.brand-copy h1 {
  color: var(--gsm-cafe);
  font-size: clamp(1.85rem, 7vw, 2.4rem);
  margin: 0 0 0.3rem;
  line-height: 1.2;
}

.brand-copy p {
  margin: 0;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 300;
  font-size: 0.98rem;
  max-width: 22rem;
  line-height: 1.4;
}

.brand-panel small {
  opacity: 0.7;
  letter-spacing: 0.04em;
  font-size: 0.78rem;
}

.form-panel {
  flex: 1;
  display: flex;
  justify-content: center;
  padding: 0 1.15rem 1.5rem;
  margin-top: -1.15rem;
}

.login-card {
  width: min(460px, 100%);
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  background: var(--gsm-white);
  border: 1px solid rgba(53, 100, 125, 0.12);
  border-radius: 14px 8px 8px 8px;
  padding: 1.5rem 1.25rem 1.35rem;
  box-shadow: var(--vd-shadow);
  border-top: 3px solid var(--gsm-cafe);
  align-self: flex-start;
}

.logo-blue {
  width: 100px;
}

.login-card h2 {
  font-size: 1.55rem;
  margin: 0;
  color: var(--gsm-blue);
}

.subtitle {
  margin: -0.35rem 0 0.15rem;
  color: var(--vd-muted);
  font-size: 0.95rem;
}

.session-note {
  margin: 0;
  padding: 0.55rem 0.7rem;
  border-radius: var(--vd-radius-sm, 8px);
  background: #fff4e5;
  color: #8a4b00;
  font-size: 0.88rem;
  font-weight: 600;
}

.submit,
.back {
  width: 100%;
}

.submit {
  margin-top: 0.15rem;
  min-height: 48px;
}

@media (min-width: 720px) {
  .brand-panel {
    padding: 1.75rem 2rem 2rem;
    gap: 1rem;
  }

  .logo-white {
    width: min(170px, 40%);
  }

  .dove {
    width: 42px;
  }

  .brand-copy h1 {
    font-size: clamp(2.1rem, 4vw, 2.75rem);
  }

  .form-panel {
    padding: 0 1.5rem 2rem;
    margin-top: -1.35rem;
  }

  .login-card {
    padding: 1.85rem 1.75rem 1.6rem;
  }

  .logo-blue {
    width: 110px;
  }
}

@media (max-width: 600px) {
  .brand-panel {
    padding: 1.1rem 1.1rem 1.4rem;
    gap: 0.7rem;
  }

  .form-panel {
    padding: 0 0.9rem calc(1.25rem + env(safe-area-inset-bottom, 0px));
    margin-top: -1rem;
  }

  .login-card {
    padding: 1.25rem 1.05rem 1.2rem;
  }
}
</style>
