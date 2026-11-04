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

En `/docs`, **Authorize** pide una key del seed; después, **Try it out** en cualquier endpoint envía el header `X-API-Key`. `GET /api/health` aparece sin candado porque no requiere key.

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
