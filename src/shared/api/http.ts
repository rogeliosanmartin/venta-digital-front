import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { trackHttpLoadingStart, trackHttpLoadingStop } from './http-loading';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** No muestra el loading global de pantalla completa. */
    skipGlobalLoading?: boolean;
  }
}

function trackLoading(config?: InternalAxiosRequestConfig) {
  if (config?.skipGlobalLoading) return;
  trackHttpLoadingStart();
}

function untrackLoading(config?: InternalAxiosRequestConfig) {
  if (config?.skipGlobalLoading) return;
  trackHttpLoadingStop();
}

const STORAGE_ACCESS = 'vd_access_token';
const STORAGE_REFRESH = 'vd_refresh_token';

/** Rutas públicas: no llevan Bearer ni disparan refresh en 401. */
const PUBLIC_AUTH_PATHS = [
  '/auth/monitor/login',
  '/auth/vendedor/solicitar-pin',
  '/auth/vendedor/verificar-pin',
  '/auth/vendedor/login-dev',
  '/auth/refresh',
];

function isPublicAuthRequest(url?: string): boolean {
  if (!url) return false;
  return PUBLIC_AUTH_PATHS.some((path) => url.includes(path));
}

function isLoginRoute(path: string): boolean {
  return path === '/' || path.startsWith('/login');
}

export function extractApiError(
  error: unknown,
  fallback = 'Ocurrió un error',
): string {
  const data = (error as AxiosError<any>)?.response?.data;
  const message = data?.message;

  if (Array.isArray(message)) {
    return message.join('. ');
  }
  if (typeof message === 'string' && message.trim()) {
    return message;
  }
  if ((error as AxiosError)?.code === 'ERR_NETWORK') {
    return 'No se pudo conectar con el API. ¿Está corriendo en el puerto 3022?';
  }
  if ((error as AxiosError)?.code === 'ECONNABORTED') {
    return 'La operación tardó demasiado. Si el dato ya quedó guardado, recarga la lista.';
  }
  return fallback;
}

export const tokenStorage = {
  getAccess: () => localStorage.getItem(STORAGE_ACCESS),
  getRefresh: () => localStorage.getItem(STORAGE_REFRESH),
  setTokens(access: string, refresh?: string | null) {
    localStorage.setItem(STORAGE_ACCESS, access);
    if (refresh) {
      localStorage.setItem(STORAGE_REFRESH, refresh);
    } else if (refresh === null) {
      localStorage.removeItem(STORAGE_REFRESH);
    }
  },
  clear() {
    localStorage.removeItem(STORAGE_ACCESS);
    localStorage.removeItem(STORAGE_REFRESH);
    localStorage.removeItem('vd_user');
    localStorage.removeItem('vd_expires_at');
  },
};

const apiBaseUrl = import.meta.env.VITE_API_URL || '/api';

export const http = axios.create({
  baseURL: apiBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  trackLoading(config);

  if (isPublicAuthRequest(config.url)) {
    return config;
  }

  const token = tokenStorage.getAccess();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;
let sessionExpiredHandling = false;

/** Cierra sesión local y manda al login (vendedor / monitor / home). */
export async function redirectToLoginOnSessionExpired() {
  if (sessionExpiredHandling) return;
  const path = window.location.pathname;
  if (isLoginRoute(path)) {
    tokenStorage.clear();
    return;
  }

  sessionExpiredHandling = true;

  let userType: string | null = null;
  try {
    const raw = localStorage.getItem('vd_user');
    if (raw) userType = (JSON.parse(raw) as { type?: string }).type ?? null;
  } catch {
    /* ignore */
  }

  try {
    const { useAuthStore } = await import('../../modules/auth/stores/auth.store');
    useAuthStore().clearSession();
  } catch {
    tokenStorage.clear();
  }

  try {
    const { default: router } = await import('../../router');
    const name =
      userType === 'VENDEDOR' || path.startsWith('/vendedor')
        ? 'login-vendedor'
        : userType === 'MONITOR' ||
            userType === 'ADMIN' ||
            path.startsWith('/monitor') ||
            path.startsWith('/admin')
          ? 'login-monitor'
          : 'home';
    await router.replace({ name, query: { sesion: 'expirada' } });
  } finally {
    sessionExpiredHandling = false;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStorage.getRefresh();
  if (!refreshToken) {
    return null;
  }

  try {
    const { data } = await axios.post(`${apiBaseUrl}/auth/refresh`, {
      refreshToken,
    });
    tokenStorage.setTokens(data.accessToken, data.refreshToken);
    localStorage.setItem('vd_user', JSON.stringify(data.user));
    localStorage.setItem('vd_expires_at', data.expiresAt);
    try {
      const { useAuthStore } = await import('../../modules/auth/stores/auth.store');
      const auth = useAuthStore();
      auth.user = data.user;
      auth.expiresAt = data.expiresAt;
    } catch {
      /* store aún no montado */
    }
    return data.accessToken as string;
  } catch {
    return null;
  }
}

http.interceptors.response.use(
  (response) => {
    untrackLoading(response.config);
    return response;
  },
  async (error: AxiosError) => {
    untrackLoading(error.config);

    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // El login/PIN no deben intentar refresh: el 401 es credencial inválida.
    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isPublicAuthRequest(original.url)
    ) {
      original._retry = true;
      refreshing = refreshing ?? refreshAccessToken();
      const newToken = await refreshing;
      refreshing = null;

      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return http(original);
      }

      // Sin refresh (vendedor) o refresh vencido → login
      await redirectToLoginOnSessionExpired();
    }

    return Promise.reject(error);
  },
);
