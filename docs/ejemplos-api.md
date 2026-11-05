# Ejemplos de uso de la API

Con la aplicación levantada ([README](../README.md#instalación)), la API responde en `http://localhost:3000` y la documentación OpenAPI interactiva está en `http://localhost:3000/docs`.

## API keys de desarrollo

El seed crea tres servicios. Son valores de desarrollo, no secretos.

| Servicio       | API key                 | Estado                    |
| -------------- | ----------------------- | ------------------------- |
| `payments-api` | `dev-key-payments-0001` | activo                    |
| `orders-api`   | `dev-key-orders-0002`   | activo                    |
| `legacy-batch` | `dev-key-legacy-0003`   | inactivo (responde `401`) |

## Swagger UI

Swagger UI no pide usuario ni contraseña: la autenticación es solo el header `X-API-Key`.

1. Abrir `http://localhost:3000/docs`.
2. Click en **Authorize** (arriba a la derecha).
3. En el campo **Value** de `apiKey (apiKey)` pegar `dev-key-payments-0001` (o `dev-key-orders-0002` para actuar como `orders-api`).
4. Click en **Authorize** y después en **Close**. Los candados de los endpoints quedan cerrados.
5. En cualquier endpoint, **Try it out** -> completar parámetros -> **Execute**. Swagger envía el header `X-API-Key` con la key elegida.

`GET /api/health` aparece sin candado porque no requiere key. Para probar el `401`, repetir el paso 3 con `dev-key-legacy-0003` (servicio inactivo) o con cualquier valor inventado. Para cambiar de key: **Authorize** -> **Logout** -> pegar la nueva.

### Fechas en Swagger

Swagger UI no tiene selector de fecha: `from` y `to` son campos de texto. El formato es ISO 8601 con zona horaria, por ejemplo `2026-11-01T10:00:00Z` o `2026-11-01T07:00:00-03:00`. Sin zona (`2026-11-01T10:00:00`) o solo con fecha (`2026-11-01`) responde `400 VALIDATION_ERROR`.

Los campos vienen precargados con `from=2026-11-01T00:00:00Z` y `to=2026-11-01T23:59:59Z`. Ese rango cubre todos los logs de ejemplo del seed, que tienen fechas fijas entre `2026-11-01T10:00:00Z` y `2026-11-01T11:57:00Z` (no dependen de cuándo corrió el seed). Un test unitario verifica que sigan dentro del rango. Los logs que se ingesten después con otra fecha quedan fuera: para verlos hay que ajustar el rango o vaciar `from`/`to`.

## curl

### Health

```sh
curl http://localhost:3000/api/health
```

### Ingestar un log

El servicio sale de la key, nunca del body. Responde `201` con el log creado.

```sh
curl -X POST http://localhost:3000/api/logs \
  -H 'X-API-Key: dev-key-payments-0001' \
  -H 'Content-Type: application/json' \
  -d '{
    "level": "ERROR",
    "timestamp": "2026-11-01T10:00:00Z",
    "message": "Database query timed out after 5000 ms",
    "traceId": "trace-demo-1",
    "metadata": { "timeoutMs": 5000 }
  }'
```

### Listar logs

Responde `{ items, nextCursor, hasMore }`. Para la página siguiente se reenvía `nextCursor` en `cursor=`. Los filtros están en [Selección de logs a analizar por filtros](../ARCHITECTURE.md#selección-de-logs-a-analizar-por-filtros).

```sh
curl 'http://localhost:3000/api/logs?level=ERROR&limit=10' \
  -H 'X-API-Key: dev-key-payments-0001'
```

### Estadísticas

Cuenta los logs por servicio y nivel: `{ total, groups: [{ service: { id, name }, level, count }] }`.

```sh
curl 'http://localhost:3000/api/logs/stats?level=ERROR&level=FATAL' \
  -H 'X-API-Key: dev-key-payments-0001'
```

### Crear un análisis

Usa los mismos filtros que el listado, en el body. Responde `202 { id, hasMore, nextCursor }`.

```sh
curl -X POST http://localhost:3000/api/logs/analyze \
  -H 'X-API-Key: dev-key-payments-0001' \
  -H 'Content-Type: application/json' \
  -d '{ "level": ["ERROR", "FATAL"], "limit": 50 }'
```

### Consultar un análisis

Con el `id` anterior, hasta que el estado pase de `PROCESSING` a `COMPLETED` o `FAILED`.

```sh
curl http://localhost:3000/api/analysis/<id> \
  -H 'X-API-Key: dev-key-payments-0001'
```

### Errores esperados

Con la key del servicio inactivo, la respuesta es `401`:

```sh
curl http://localhost:3000/api/logs \
  -H 'X-API-Key: dev-key-legacy-0003'
```

Un segundo `POST /api/logs/analyze` mientras otro análisis está en `PROCESSING` responde `409 ANALYSIS_IN_PROGRESS`, con el id del análisis en curso en `details`. Todos los códigos están en [Formato de error de la API](../ARCHITECTURE.md#formato-de-error-de-la-api).
