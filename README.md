# Venta Digital — Frontend

Aplicación Vue 3, TypeScript y Vite.

## Desarrollo

```bash
npm ci
npm run dev
```

## Despliegue en Coolify

1. Crear el recurso desde este repositorio y seleccionar **Dockerfile** como tipo de build.
2. Usar el puerto **80**.
3. Configurar `API_UPSTREAM` como variable de runtime con la URL interna del backend, sin el sufijo `/api` (por ejemplo, `http://UUID-BACKEND:3000`).
4. Desplegar el recurso.

El navegador consulta `/api` en el mismo dominio del frontend y Nginx reenvía
esas solicitudes a `API_UPSTREAM`. Esto evita exponer la red interna y no
requiere CORS entre frontend y backend.

Para construir localmente:

```bash
docker build -t venta-digital-front .
docker run --rm -p 8080:80 \
  -e API_UPSTREAM=http://host.docker.internal:3022 \
  venta-digital-front
```
