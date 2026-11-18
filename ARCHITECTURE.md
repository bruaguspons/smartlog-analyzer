# Arquitectura — SmartLog Analyzer

## Contexto y alcance

SmartLog Analyzer es una herramienta interna que recibe logs de varios microservicios, los almacena y usa un LLM para detectar patrones y sugerir acciones, según el [enunciado del desafío](docs/Desafio_tecnico_SmartLog_Analyzer_Abstracta.md).

Es un prototipo pensado para construirse en 10 a 15 horas. Las decisiones priorizan que se pueda levantar con un solo comando y que falle de forma controlada, no escalar a volúmenes de producción. Donde una decisión no escalaría, se indica cómo evolucionaría.

Supuestos:

- Los únicos consumidores de la API son los microservicios registrados. No hay usuarios humanos ni frontend.
- Todos los endpoints requieren la API key de un servicio, salvo `GET /api/health`.
- Los servicios se dan de alta por seed. No hay endpoints para administrarlos.
- Cualquier servicio autenticado puede listar y analizar logs de todos los servicios y consultar cualquier análisis: la API key autentica, pero no hay autorización por recurso.

## Vista de componentes

Diagrama: [Vista de componentes](docs/diagrams/components.md).

| Componente                              | Responsabilidad                                                        |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Middleware de autenticación             | Resuelve el servicio a partir de `X-API-Key`; `401` si no corresponde. |
| Rutas y controladores                   | Validan la entrada con zod, llaman al servicio y serializan la salida. |
| Servicio de logs                        | Ingesta, listado con filtros y agregación.                             |
| Servicio de análisis                    | Crea el análisis, selecciona los logs y expone el resultado.           |
| Ejecutor de análisis (`AnalysisRunner`) | Arma el prompt, llama al LLM, valida la respuesta y persiste.          |
| `LlmClient`                             | Interfaz única hacia el LLM; la implementación se elige por entorno.   |

### Endpoints

| Método | Ruta                 | Descripción                                                 | Origen                                                        |
| ------ | -------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| POST   | `/api/logs`          | Ingestar un log                                             | Enunciado                                                     |
| GET    | `/api/logs`          | Listar logs con filtros y paginado por cursor               | Enunciado                                                     |
| GET    | `/api/logs/stats`    | Conteo de logs por servicio y nivel, con los mismos filtros | Extra ([por qué](#agregación-expuesta-como-get-apilogsstats)) |
| POST   | `/api/logs/analyze`  | Crear un análisis sobre una página de logs filtrados        | Enunciado                                                     |
| GET    | `/api/analysis/{id}` | Obtener estado y resultado de un análisis                   | Enunciado                                                     |
| GET    | `/api/health`        | Estado del servicio y de la base (público)                  | Enunciado                                                     |

## Flujos principales

### Ingesta de un log

El servicio emisor se toma de la `X-API-Key`, nunca del body, así que un servicio no puede escribir logs a nombre de otro.

### Análisis

Diagrama: [Secuencia del análisis](docs/diagrams/analysis-sequence.md).

Respuesta de `GET /api/analysis/{id}` (un id que no es UUID responde `400`; uno desconocido, `404`):

```json
{
  "id": "0192f1c0-...",
  "status": "COMPLETED",
  "createdAt": "2026-11-04T10:00:00.000Z",
  "durationMs": 2500,
  "logCount": 3,
  "provider": "gemini",
  "model": "gemini-3.6-flash",
  "summary": "Overall summary of the batch",
  "findings": [
    {
      "id": 1,
      "category": "DATABASE",
      "severity": "HIGH",
      "description": "...",
      "suggestions": ["..."],
      "logIds": ["0192f1c0-..."]
    }
  ],
  "tokens": { "prompt": 120, "completion": 45 },
  "error": null
}
```

En `PROCESSING`, `summary`, `durationMs`, `tokens` y `error` son `null` y `findings` es `[]`. En `FAILED`, `error` es `{ code, message }`. `logCount` se calcula desde `analysis_logs` y `raw_response` nunca se expone.

## Modelo de datos

Diagrama, columnas y claves en [docs/MER.md](docs/MER.md).

Los logs de `finding_logs` de un hallazgo tienen que pertenecer a los `analysis_logs` de su análisis. La base no lo garantiza: lo valida la aplicación.

### Tipos y columnas derivadas

- `services.id`, `analysis_findings.id`, las columnas de tokens y `duration_ms` son `Int` y no `Long`: `BigInt` rompe la serialización JSON y esos valores salen por la API o no necesitan más rango.
- `logs` no tiene `received_at`: el id es UUIDv7 y ya codifica el momento de inserción. `logs.timestamp` es la hora que informa el servicio.
- `analyses` no tiene `log_count`: se obtiene contando `analysis_logs`, para no duplicar un dato que podría desincronizarse.

### Índices

Cada índice responde a una consulta concreta:

| Tabla               | Índice                                                | Consulta que lo usa                                                                                                               |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `services`          | único sobre `api_key`                                 | Autenticación, en cada request.                                                                                                   |
| `logs`              | `(timestamp DESC, id DESC)`                           | Listado sin filtros y [paginado por cursor](#paginado-por-cursor-sobre-timestamp-id).                                             |
| `logs`              | `(service_id, timestamp DESC, id DESC)`               | Listado y análisis filtrados por servicio, que es el filtro más común. También lo usa `stats` cuando se filtra por servicio.      |
| `logs`              | `(level, timestamp DESC)`                             | Filtro por nivel, por ejemplo "todos los ERROR recientes".                                                                        |
| `logs`              | `(trace_id)`                                          | Reconstruir una traza completa.                                                                                                   |
| `analysis_logs`     | PK `(analysis_id, log_id)` y un índice sobre `log_id` | Obtener los logs de un análisis y, a la inversa, los análisis de un log.                                                          |
| `analysis_findings` | `(analysis_id)`                                       | Cargar los hallazgos de un análisis.                                                                                              |
| `finding_logs`      | PK `(finding_id, log_id)`                             | Cargar los logs afectados de cada hallazgo.                                                                                       |
| `analyses`          | único parcial `WHERE status = 'PROCESSING'`           | Garantizar que haya [un solo análisis en curso](#un-solo-análisis-en-curso-a-la-vez). También lo usa la recuperación al arrancar. |

Sin índice, a propósito:

- `search` sobre `message`: un `ILIKE '%texto%'` no puede usar un índice B-tree y a esta escala alcanza un recorrido secuencial. La evolución sería `pg_trgm` o búsqueda full-text.
- `metadata`: no se filtra por su contenido. Si se agregara ese filtro, correspondería un índice GIN.

La consulta de agregación está en [Agregación expuesta como `GET /api/logs/stats`](#agregación-expuesta-como-get-apilogsstats).

## Decisiones técnicas

### Node + TypeScript + Express 5

- **Descartado:** Fastify, Express 4, NestJS.
- **Por qué:** Express es el framework que cualquier revisor ya conoce y su flujo se lee de arriba abajo: el router, el middleware y el controlador. Express 5 propaga a `next` los errores de los handlers async, así que no hace falta una librería extra para eso. Con tres recursos y seis rutas, la estructura de Fastify (plugins encapsulados, type provider, hooks) agregaba más indirección que valor.
- **Qué se pierde y cómo se compensa:**
  - Serialización por esquema integrada: cada controlador pasa su respuesta por el esquema zod de respuesta (`sendJson`), que descarta claves desconocidas y evita filtrar campos como `apiKey` o `raw_response`. Si la respuesta no cumple el esquema, es un `500` registrado.
  - Encapsulación de plugins: la autenticación y el parseo del body se aplican por ruta en cada router (ver [Autenticación y parseo por ruta](#autenticación-y-parseo-por-ruta)), no por scope.
  - `app.inject()`: los tests usan `supertest` sobre la app (ver [Cómo se prueba](#cómo-se-prueba)).
- **Descartado:**
  - Fastify: rinde más por request y trae validación y serialización integradas, pero a esta escala el rendimiento no pesa y la indirección sí.
  - Express 4: no propaga los errores de handlers async y exigiría `express-async-errors` o un envoltorio propio.
  - NestJS: aporta inyección de dependencias y estructura que no se justifican para este alcance.
- **Consecuencias:** la validación, la serialización y el orden de los middlewares los armamos nosotros (unos pocos archivos chicos en `src/middlewares/` y `src/controllers/request-io.ts`). Un test de contrato con la respuesta de cada caso guardada en un archivo (`tests/integration/api/api-contract.golden.json`) fija el comportamiento externo de la API.

### zod como única fuente de validación y tipos

- **Descartado:** `express-validator` y `celebrate` (Joi).
- **Por qué:** con zod el mismo esquema da el tipo de TypeScript y la validación en runtime, y también valida la respuesta del LLM, que es tan poco confiable como un input externo. Además es la fuente del documento OpenAPI.
- **Consecuencias:** el controlador llama a `parseRequest` con el esquema y obtiene un valor tipado; no hay un middleware genérico de validación que deje el dato como `any`. La diferencia de velocidad frente a otros validadores es irrelevante a esta escala.

### PostgreSQL

- **Descartado:** MongoDB, Elasticsearch/Loki.
- **Por qué:** el modelo tiene relaciones N:M y agregaciones por servicio, nivel y fecha, que se expresan naturalmente en SQL. `JSONB` cubre la parte semiestructurada (`metadata`, `suggestions`). Un motor especializado en logs sería la opción a escala, pero agrega un componente más para operar.
- **Consecuencias:** a gran volumen habría que particionar `logs` por fecha o usar un motor de logs.

### Análisis asíncrono en el mismo proceso

- **Descartado:** procesamiento síncrono; cola externa (RabbitMQ, BullMQ + Redis).
- **Por qué:** una llamada al LLM puede tardar decenas de segundos y no debería mantener abierto el request. `POST` responde `202` con el id y el cliente consulta el estado. Una cola externa daría reintentos y durabilidad, pero suma infraestructura que no se justifica en el prototipo.
- **Consecuencias:**
  - Cierre ordenado: el ejecutor lleva el registro de los análisis en curso. Al recibir `SIGTERM`, aborta cada llamada al LLM (sin más reintentos) y espera a que cada análisis quede en `FAILED` con `error_code = INTERRUPTED`; recién entonces se cierra el pool de la base. `src/server.ts` fija ese orden dentro del callback de `close-with-grace`: primero `server.close()`, luego `analysisRunner.shutdown()` y al final la desconexión de la base. Cada paso va en su propio `try/catch` con log, así que una falla no impide los siguientes, y `close-with-grace` ejecuta el callback una sola vez aunque llegue una segunda señal (solo la registra). Ambas garantías salen de la estructura del código y no tienen un test unitario propio; `tests/integration/server.test.ts` levanta el servidor real en un proceso aparte y verifica el orden de arranque, los códigos de salida y el cierre con `SIGTERM`.
  - Caídas: si el proceso muere sin pasar por el cierre ordenado, esos trabajos se pierden. Al arrancar, y antes de aceptar requests, los análisis que quedaron en `PROCESSING` se marcan `FAILED` con `INTERRUPTED`. Así ninguno queda colgado bloqueando nuevos análisis (ver [un solo análisis en curso](#un-solo-análisis-en-curso-a-la-vez)).
  - Escrituras condicionales: toda transición a un estado final es un compare-and-set (`WHERE status = 'PROCESSING'`), así que si compiten el cierre, la recuperación y el ejecutor, gana la primera escritura.

### LLM detrás de una interfaz, implementación elegida por entorno

- **Descartado:** acoplar el código a un SDK de un proveedor.
- **Por qué:** permite testear con un cliente que fija cada respuesta (válida, formato inválido, timeout) y que `docker compose up` funcione sin API key.
- **Implementaciones:**
  - Gemini (`LLM_PROVIDER=gemini`), con el SDK oficial `@google/genai`. Se le pide salida estructurada (`responseMimeType: application/json` con un esquema de respuesta, con categorías y severidades como enumeraciones), lo que reduce los casos de formato inválido aunque no los elimina: la validación con zod se mantiene. Se eligió frente a OpenAI y Anthropic por su capa gratuita (el enunciado no exige gastar dinero) y por soportar salida con esquema.
  - Mock (`LLM_PROVIDER=mock`, valor por defecto): devuelve una respuesta realista y determinística a partir de los logs recibidos, sin API key.
- **Consecuencias:** los tokens de completion de Gemini son `candidatesTokenCount + thoughtsTokenCount`, porque el razonamiento se factura como salida. Los reintentos los maneja nuestra capa (ver [Llamada al LLM](#llamada-al-llm)), así que el cliente de Gemini se crea sin `retryOptions` para que el SDK no multiplique los intentos.

### Selección de logs a analizar por filtros

- **Descartado:** lista explícita de IDs.
- **Por qué:** quien analiza piensa en términos de "los errores del servicio X en la última hora", no de IDs. Los filtros (`serviceId`, `level`, `from`/`to`, `traceId`, `search`, combinables con AND) reutilizan el esquema de `GET /api/logs`, así que hay una sola definición de qué significa cada uno. Solo `level` admite varios valores.
- **Límites de entrada:** `serviceId` se acota a un entero de 1 a 2147483647 (el rango de `INT` de Postgres) y los textos (`search`, `traceId` y, en la ingesta, `message` y `metadata`) no admiten el carácter NUL, que Postgres no puede guardar. Fuera de esos límites la respuesta es `400 VALIDATION_ERROR`, nunca `500`. Se rechaza en lugar de recortar, para no alterar en silencio lo que envió el cliente.
- **Consecuencias:** cada análisis cubre una página del mismo paginado que el listado, que es el lote que se envía al LLM. El máximo de `limit` (200) es el tope de logs por análisis y controla tokens y costo. Si los filtros devuelven más, la respuesta lo indica con `hasMore` y `nextCursor` para lanzar otro análisis con la página siguiente.

### API key por servicio, guardada en texto plano

- **Descartado:** guardar un hash de la key; JWT u OAuth2 client credentials.
- **Por qué:** para el alcance alcanza con identificar al servicio emisor. Se prioriza la simplicidad del seed y de las pruebas manuales.
- **Consecuencias:** si se filtra la base, se filtran las keys. El paso siguiente sería guardar un SHA-256: alcanza porque es un valor aleatorio de alta entropía, no una contraseña. La key se busca por columna única en cada request, sin caché y sin `timingSafeEqual`, porque la comparación la hace el índice de la base y la key es de alta entropía. Las de más de 256 caracteres se rechazan sin consultar la base, y una key faltante, desconocida o inactiva produce el mismo `401`.

### UUIDv7 para los ids de `logs` y `analyses`

- **Descartado:** id autoincremental; UUIDv4.
- **Por qué:** son los ids que salen por la API. No son enumerables y no revelan volumen. A diferencia de UUIDv4, son ordenables por tiempo, lo que mantiene el índice compacto.
- **Consecuencias:** `services` mantiene id autoincremental. Ese id sale por la API (`serviceId` en los logs y los filtros, `service.id` en `stats`), pero conocerlo no da acceso: los servicios se dan de alta por seed y se autentican con su API key, que nunca se expone.

### Prisma para acceso a datos y migraciones

- **Descartado:** Kysely o Drizzle con migraciones en SQL plano; `pg` sin capa intermedia.
- **Por qué:** el `schema.prisma` es una traducción casi directa del MER, genera las migraciones SQL y los tipos del cliente. `groupBy` cubre agregaciones simples.
- **Consecuencias:** las relaciones N:M son tablas explícitas (`analysis_logs`, `finding_logs`) y no las implícitas de Prisma, para controlar nombres e índices. Agregaciones por intervalos de tiempo requerirían `$queryRaw`.

### Validación de la respuesta del LLM: estructura estricta, contenido tolerante

- **Descartado:** aceptar la respuesta sin validar; fallar el análisis ante cualquier valor inesperado.
- **Por qué:** la respuesta del LLM se trata como input externo y se valida con zod. Si la estructura es inválida (no es JSON, faltan campos o los tipos no coinciden), no hay nada confiable para guardar y el análisis pasa a `FAILED`. Si la estructura es válida pero el contenido es inesperado, se tolera y el hallazgo se conserva, porque descartar todo por una etiqueta perdería información útil:
  - Una categoría desconocida se mapea a `OTHER`.
  - Una severidad desconocida queda en `MEDIUM`.
  - Los ids de logs que no estaban en el lote enviado al modelo se descartan del hallazgo. Si un hallazgo queda sin logs, se conserva igual.
- **Contrato de la respuesta:** `{ summary: string, findings: [{ category: string, severity: string, description: string, suggestions: string[], logRefs: number[] }] }`. Un `findings` vacío es válido.
- **Referencias a logs:** los logs se envían numerados de 1 a N, dentro de `<logs>...</logs>` y declarados como datos no confiables. El modelo devuelve esos números en `logRefs` y la aplicación los traduce a los UUID del lote.
- **Idioma:** el prompt y todo lo que genera el sistema en ejecución (salida del modelo, del mock, mensajes de error de la API) están en inglés. Solo la documentación está en español.
- **Consecuencias:**
  - `raw_response` se persiste siempre, también en las fallas, para diagnosticar qué devolvió el modelo.
  - El valor por defecto de severidad puede subestimar un problema real (un `CRITICAL` mal escrito queda como `MEDIUM`). Por eso cada mapeo por defecto se registra como warning y el valor original queda en `raw_response`.

### Paginado por cursor sobre `(timestamp, id)`

- **Descartado:** paginado por offset (`page` / `offset`).
- **Por qué:** los logs llegan todo el tiempo. Con offset, cada inserción nueva corre las páginas y el cliente ve logs repetidos o se saltea otros. Con un cursor, la página siguiente empieza exactamente después del último log visto. Además, offset obliga a recorrer y descartar todas las filas anteriores.
- **Detalle:** orden por `timestamp` descendente con `id` como desempate, porque dos logs pueden tener el mismo timestamp. El cursor es opaco: el cliente reenvía `nextCursor` sin interpretarlo. `limit` es 50 por defecto y 200 como máximo.
- **Consecuencias:** no se puede saltar a "la página 7" ni mostrar un total de páginas. Para una herramienta que recorre logs recientes no es una pérdida relevante.

### Agregación expuesta como `GET /api/logs/stats`

- **Descartado:**
  - Un archivo `.sql` suelto en `db/`: cumple el enunciado, pero nadie lo usa.
  - Calcular la agregación solo dentro del análisis, como contexto para el prompt: no es consultable por sí sola.
- **Por qué:** el enunciado pide al menos una consulta de agregación. Exponerla como endpoint la hace usable y testeable.
- **Detalle:** recibe los mismos filtros que `GET /api/logs`, sin paginado (`limit` y `cursor` responden `400`), y agrupa por servicio y nivel con un `groupBy` de Prisma sobre `(service_id, level)`. Como `groupBy` no hace joins, los nombres se resuelven con una segunda consulta (`ServiceRepository.findNamesByIds`). Responde `total` y una lista de grupos `{ service: { id, name }, level, count }`, ordenados por id de servicio y severidad.
- **Consecuencias:**
  - La agrupación es fija. Elegir dimensiones o agrupar por intervalos de tiempo requeriría `$queryRaw` y queda como evolución.
  - Sin filtro de servicio ni de fechas, el conteo recorre todos los logs que coinciden y su costo crece con la tabla. A gran volumen convendría precalcular conteos o exigir un rango de fechas.

### Migraciones y seed al arrancar la aplicación

- **Descartado:** un servicio `migrate` separado en el compose, que corre una vez y termina.
- **Por qué:** es lo más simple que cumple "`docker compose up` levanta todo sin pasos adicionales". El contenedor ejecuta `prisma migrate deploy`, luego el seed y recién después inicia el servidor.
- **Consecuencias:**
  - Con varias réplicas, todas intentarían migrar al mismo tiempo. Ahí convendría el servicio separado o un job previo al despliegue.
  - El seed es idempotente: crea los servicios si no existen y carga logs de ejemplo solo si la tabla está vacía. Se puede desactivar con `SEED_ON_START=false`.
  - Esa comprobación y la inserción no son atómicas, y no hace falta un lock: el seed corre una sola vez por arranque y en una sola instancia. En el peor caso quedarían logs de ejemplo duplicados, sin romper ninguna restricción. Es distinto del [análisis único en curso](#un-solo-análisis-en-curso-a-la-vez), que protege un invariante y por eso usa un índice único.

### Tests de integración contra un Postgres real con Testcontainers

- **Descartado:**
  - Mockear Prisma: los tests verificarían el mock y no el SQL, las constraints, las transacciones ni el paginado por cursor, que es donde suelen estar los bugs.
  - Una base de test dentro del compose: obliga a levantarla antes de correr los tests y comparte estado entre corridas.
  - Jest en lugar de Vitest: Vitest tiene soporte nativo de TypeScript y ESM, sin configuración extra de transpilación.
- **Por qué:** Testcontainers levanta un Postgres descartable desde el propio test, así que `npm run test:integration` funciona sin pasos previos y cada corrida empieza con una base limpia. `npm test` corre solo los tests unitarios y no necesita Docker.
- **Detalle:** la app real (`src/app.ts`) se ejercita con `supertest` y con un cliente de LLM programable (`ScriptedLlmClient`) que reemplaza al módulo `src/llm/llm.ts` y fija la respuesta de cada intento. Además, un test arranca `src/server.ts` en un proceso aparte contra la misma base.
- **Consecuencias:** la primera corrida de integración es más lenta porque descarga la imagen de Postgres. En CI sirve cualquier runner con Docker.

### Un solo análisis en curso a la vez

- **Regla:** mientras exista un análisis en `PROCESSING`, `POST /api/logs/analyze` responde `409 ANALYSIS_IN_PROGRESS` con el id del análisis en curso. El bloqueo dura hasta que ese análisis termina en `COMPLETED` o `FAILED`, con reintentos incluidos.
- **Por qué:**
  - Controla el costo: no puede haber varios análisis consumiendo tokens a la vez.
  - Protege los límites de tasa del proveedor, que en la capa gratuita de Gemini son bajos.
  - Evita que dos servicios lancen casi a la vez el mismo análisis sobre los mismos logs.
- **Cómo se garantiza:** un índice único parcial en la base, declarado en `schema.prisma` con la función preview `partialIndexes` de Prisma:

  ```prisma
  @@unique([status], map: "analyses_single_processing", where: raw("status = 'PROCESSING'"))
  ```

  El índice solo contiene las filas en `PROCESSING` y todas tienen la misma clave, así que la base rechaza un segundo `INSERT` en ese estado. El error de unicidad se traduce a `409`.

- **Descartado:**
  - Consultar si hay uno en curso y después insertar: dos requests simultáneos pueden pasar ambos el chequeo antes de que alguno inserte.
  - Un flag en memoria: el estado queda duplicado entre la memoria y la base, y deja de servir con más de una réplica.
  - Un advisory lock de Postgres: hay que mantenerlo tomado durante todo el análisis, lo que ata una conexión del pool hasta 2 minutos.
- **Consecuencias:**
  - `partialIndexes` es una función preview: si cambia su comportamiento al actualizar Prisma, el cambio aparece en la migración generada. Se descartó el índice escrito a mano sobre `((true))` porque Prisma no lo ve en `schema.prisma`. El test de integración compara las migraciones con `schema.prisma` (`migrate diff --exit-code`) y detecta cualquier desvío.
  - La garantía depende de que todo análisis termine en un estado final. El ejecutor envuelve el procesamiento en un `try/finally`: cualquier error no previsto termina en `FAILED` con `INTERNAL_ERROR`, conservando `raw_response` y los tokens si el modelo ya había respondido. La [recuperación al arrancar](#análisis-asíncrono-en-el-mismo-proceso) cubre el caso en que el proceso muere.
  - El throughput es de un análisis a la vez: con los valores por defecto, el peor caso ronda los 2 minutos (ver [Llamada al LLM](#llamada-al-llm)), y los demás pedidos reciben `409` y tienen que reintentar.

### Librerías del ecosistema Express: adoptadas y descartadas

- **Adoptadas:** `pino-http` (log por request con el `x-request-id` del cliente o un UUID), `@asteasolutions/zod-to-openapi` y `swagger-ui-express` (OpenAPI en `/docs`, generado desde los esquemas zod; cada router registra su documentación OpenAPI junto a sus rutas, así que ambas viven en el mismo archivo y no se desincronizan) y `close-with-grace` (apagado ordenado ante señales y errores no capturados, con timeout forzado de 8 s).
- **Esquemas recursivos en OpenAPI:** el `metadata` JSON es un esquema recursivo; se registra con un id (`JsonValue`) para que se publique como componente. Sin él, el documento queda con referencias que no resuelven y `/docs` falla.
- **Documento OpenAPI:** se sirve en `/docs` (interfaz) y `/docs/json`. No hay `/docs/yaml`.
- **Descartadas**, cada una por una razón concreta:
  - `express-rate-limit`: sin un productor de `429` en el alcance; queda como evolución (ver [Limitaciones y evolución](#limitaciones-y-evolución)).
  - `express-async-errors`: Express 5 ya propaga los errores async.
  - `zod-express-middleware` y `express-zod-api`: la primera oculta el parseo y la segunda es un framework encima de Express; `parseRequest` son pocas líneas visibles.
  - `tsoa` y `express-openapi-validator`: el primero exige decoradores y el segundo parte del documento OpenAPI escrito a mano, cuando acá la fuente son los esquemas zod.
  - `env-schema`: la configuración ya se valida con zod al arrancar.
  - `helmet` y `cors`: es una API interna que consumen servicios, no navegadores.

### Autenticación y parseo por ruta

El middleware de `X-API-Key` y el parseo del body se aplican ruta por ruta en los routers de `src/routes/` (`logs.routes.ts`, `analysis.routes.ts`, `health.routes.ts`); solo `GET /api/health` es pública. La cadena de cada ruta es: autenticación, parseo de JSON (solo si tiene body) y controlador.

- **Descartado:** `app.use('/api', auth)` o autenticar a nivel del router, y un `express.json()` global. Un middleware de router convertiría una ruta desconocida bajo `/api` en `401` en lugar de `404`, y un parseo global correría antes de autenticar, con lo que un body inválido o demasiado grande ganaría al `401`.
- **Consecuencias:** una ruta desconocida responde `404` sin autenticar, y la autenticación siempre precede a la validación del body (`401` antes que `400`, `413` o `415`). Lo que se monta fuera de `/api` (`/docs`) es público.

### JSON en camelCase en toda la API

- **Por qué:** todos los campos JSON van en `camelCase` (`serviceId`, `traceId`, `nextCursor`). Coincide con los nombres de los tipos TypeScript y con el JSON nativo de JavaScript, y evita convertir nombres en cada borde. Las columnas siguen en `snake_case` y Prisma las mapea con `@map`.
- **Descartado, `snake_case`:** lo recomiendan algunas guías de API y aparece en el legado de OpenTelemetry (`trace_id`). Obliga a mapear nombres en cada request y response, y mezclar ambas convenciones sería peor que cualquiera de las dos.
- **Consecuencia:** el body de `POST /api/logs` es estricto. Un `trace_id` o un `serviceId` en el body se rechaza con `400`.

### Módulos singleton en lugar de inyección de dependencias

- **Decisión:** `logsService`, `analysisService`, los repositorios, `llmClient` (`src/llm/llm.ts`), `config` y `prisma` son instancias únicas creadas al importar el módulo. Cada archivo importa lo que usa, igual que en una app Express convencional, y no hay una función que arme el grafo de dependencias.
- **Descartado:** inyección explícita de dependencias, con `createApp(deps)` y una raíz de composición (`createRuntime`) que cableaba servicios, ejecutor y servidor y cerraba todo en orden. Daba repositorios en memoria y un test de contrato sin base de datos, y las dependencias de cada pieza se leían en su firma.
- **Por qué:** para quien revisa el código pesó más la legibilidad: seguir un request pasaba por fábricas, interfaces y un cableado que no existe en una API Express típica, y el costo no se justificaba con tres recursos. Se prefirió un código tan llano como el de cualquier app Express.
- **Consecuencias:**
  - Los tests no inyectan dobles: los que tocan datos corren contra Postgres (ver [Cómo se prueba](#cómo-se-prueba)) y los de LLM reemplazan el módulo `src/llm/llm.ts` con `vi.mock`.
  - Los repositorios en memoria y sus contratos compartidos desaparecieron; los unitarios cubren solo módulos puros.
  - El test de contrato fija los ids y el reloj con `vi.mock('node:crypto')` y un `Date` falso, porque ya no puede inyectarlos.
  - Importar un módulo con cableado valida la configuración (`DATABASE_URL`), así que no se puede importar desde un test unitario sin una base.

### Estructura del proyecto: capas por tipo de archivo (routes, controllers, services, repositories)

- **Decisión:** el código está organizado en carpetas planas por capa, con un archivo por recurso en cada una:

  | Carpeta                 | Contenido                                                                                                                           |
  | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | `src/routes/`           | Un router por recurso con su cadena de middlewares y su documentación OpenAPI al lado, y `openapi.ts` que arma el documento.        |
  | `src/controllers/`      | Un controlador por recurso (`logs`, `analysis`, `health`) y `request-io.ts` (`parseRequest`, `sendJson`).                           |
  | `src/middlewares/`      | Autenticación por API key, parseo de JSON y manejo de errores.                                                                      |
  | `src/schemas/`          | Esquemas zod de entrada y salida de la API, y sus helpers.                                                                          |
  | `src/services/`         | `logsService`, `analysisService`, el ejecutor de análisis (`AnalysisRunner`) y `process-analysis`. No conocen Express.                |
  | `src/repositories/`     | Un archivo por entidad con las consultas Prisma. No conocen Express ni los servicios.                                                |
  | `src/models/`           | Tipos y constantes de las entidades (`Log`, `Analysis`, `Service`).                                                                 |
  | `src/llm/`              | `LlmClient`, clientes Gemini y mock, prompt, validación de la respuesta y política de reintentos.                                   |
  | `src/seed/`             | Código del seed.                                                                                                                    |
  | `src/shared/`           | Configuración, errores de la aplicación, cursor y cliente de Prisma.                                                                |
  | `src/app.ts`            | La app de Express: ajustes, logger, `/docs`, routers y manejo de errores. No abre ningún puerto.                                    |
  | `src/server.ts`         | Punto de entrada: recuperación al arrancar, `listen` y cierre ordenado con `close-with-grace`.                                      |

  Las dependencias van hacia abajo: controladores y rutas usan servicios; servicios usan interfaces de repositorio y modelos; los repositorios usan modelos. Servicios y repositorios no importan Express, ni controladores, rutas o middlewares, y los repositorios tampoco importan servicios. Se divide un archivo solo cuando lo comparte código de otra capa; si no, tipos y constantes viven en el archivo que los usa. Se prioriza la legibilidad por sobre un límite rígido de tamaño. Los servicios, repositorios, el cliente de LLM y el cliente de Prisma son módulos singleton que se importan directamente (ver [Módulos singleton en lugar de inyección de dependencias](#módulos-singleton-en-lugar-de-inyección-de-dependencias)). Los tests replican el árbol de `src/` y los dobles de prueba viven en `tests/support/`.
- **Imports:** `@/` apunta a `src/` (y `@tests/` a `tests/`) mediante `paths` de TypeScript; en el build, `tsc-alias` los reescribe a rutas relativas, y Vitest y `tsx` los resuelven por su cuenta. Dentro de una misma carpeta se usa `./`; nunca `../`. No hay archivos `index.ts` que reexporten.
- **Por qué:** quien ya conoce una API en capas encuentra cada cosa donde espera, y seguir un request es recorrer cuatro carpetas conocidas. Con tres recursos, cada archivo sigue siendo corto sin necesidad de más subdivisiones.
- **Descartado:**
  - Módulos hexagonales (`domain`, `application`, `http`, `infrastructure`) con una carpeta por caso de uso: era la estructura anterior, con unos 145 archivos de pocas líneas. Separaba bien las responsabilidades, pero seguir un request obligaba a abrir muchos archivos y las carpetas y puertos pesaban más que la lógica que contenían.
  - Carpetas por funcionalidad (`logs/`, `analysis/`) con capas adentro: con tres recursos, no justifica el nivel extra y los servicios se referencian entre sí igual.
  - Un archivo por símbolo exportado: el diff mostraba cada cambio con precisión, pero repartía una sola idea en varios archivos.
  - Tests junto al código: complica el `include` de Vitest y el build, que tendría que excluirlos de `dist/`.
  - Tipos en archivos `.d.ts` propios: `skipLibCheck` los omite en la verificación, así que los errores pasarían sin avisar.
  - Imports nativos `#/` (campo `imports` de `package.json`): exigen condiciones personalizadas en `tsc`, `tsx` y Vitest para apuntar a `src/` en desarrollo y a `dist/` en producción; el alias con `tsc-alias` es más simple.
- **Consecuencias:** los niveles de pino se llaman `PINO_LOG_LEVELS` y `PinoLogLevel` (en `shared/config/load-config.ts`) para no confundirlos con `LOG_LEVELS` y `LogLevel` (`DEBUG..FATAL`, en `models/log.ts`).

## Manejo de fallas

### Formato de error de la API

Todas las respuestas de error tienen la misma forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "body/level Invalid option: expected one of \"DEBUG\"|\"INFO\"|\"WARN\"|\"ERROR\"|\"FATAL\"",
    "details": [
      {
        "instancePath": "/level",
        "keyword": "invalid_value",
        "message": "Invalid option: expected one of \"DEBUG\"|\"INFO\"|\"WARN\"|\"ERROR\"|\"FATAL\""
      }
    ]
  }
}
```

`code` es estable, para que el cliente lo use en un `switch`; `message` es para humanos. `details` es opcional: se incluye en errores de validación, como una lista `{ instancePath, keyword, message }` por problema, y en `409`, con el id del análisis en curso.

**Descartado:** RFC 9457 (`application/problem+json`). Sería la opción en una API pública, pero para consumidores internos agrega ceremonia (`type` como URI, `title`, `instance`) sin aportar más que un `code` estable.

Un único middleware de errores de Express (`src/middlewares/error-handler.ts`) traduce cada error a esta forma. Los errores del parseo de JSON se mapean al mismo sobre: un JSON mal formado es `400` y un body mayor al límite es `413`. Un 4xx que no es de la aplicación y no tiene código propio (por ejemplo `415` por un `content-type` no soportado) conserva su status y usa `VALIDATION_ERROR`. La ruta desconocida pasa por un handler de `404` que lanza `NOT_FOUND` hacia ese mismo middleware. Los errores no previstos responden `500` con un mensaje genérico: el detalle y el stack trace van solo al log de la aplicación.

| HTTP | `code`                 | Cuándo                                                                                                                                |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`     | Body, query o path inválidos según zod. Incluye un id que no es un UUID válido y un JSON mal formado.                                 |
| 401  | `UNAUTHORIZED`         | Falta `X-API-Key`, no existe o el servicio está inactivo. Se usa el mismo código en los tres casos para no revelar si una key existe. |
| 404  | `NOT_FOUND`            | Análisis inexistente o ruta desconocida.                                                                                              |
| 413  | `PAYLOAD_TOO_LARGE`    | El body supera el límite configurado.                                                                                                 |
| 409  | `ANALYSIS_IN_PROGRESS` | Ya hay [un análisis en curso](#un-solo-análisis-en-curso-a-la-vez). `details` incluye su id.                                          |
| 422  | `NO_LOGS_TO_ANALYZE`   | Los filtros de un análisis no devuelven ningún log.                                                                                   |
| 500  | `INTERNAL_ERROR`       | Error no previsto.                                                                                                                    |
| 503  | `SERVICE_UNAVAILABLE`  | Health check con la base caída.                                                                                                       |

### Llamada al LLM

Cada intento tiene un timeout configurable (`LLM_TIMEOUT_MS`, 30 segundos por defecto), implementado con `AbortController` para que la request se cancele de verdad. Se reintenta hasta `LLM_MAX_RETRIES` veces (3 por defecto, 4 intentos en total) con backoff exponencial más jitter (aproximadamente 1 s, 2 s, 4 s), para que varios análisis que fallaron a la vez no reintenten en el mismo instante.

`Retry-After` no se respeta: el `ApiError` de `@google/genai` no expone los headers de la respuesta. Un `429` usa el mismo backoff que los demás errores reintentables y, si se agotan los reintentos, el análisis termina en `LLM_RATE_LIMITED`.

| Error                          | ¿Se reintenta? | Motivo                                                                      |
| ------------------------------ | -------------- | --------------------------------------------------------------------------- |
| Timeout                        | Sí             | Puede ser una demora puntual.                                               |
| Error de red                   | Sí             | Transitorio.                                                                |
| `429` del proveedor            | Sí             | Límite de tasa, se libera con el tiempo.                                    |
| `5xx` del proveedor            | Sí             | Falla del lado del proveedor.                                               |
| `401` / `403` del proveedor    | No             | Es un error de configuración (key inválida). Reintentar no cambia nada.     |
| Otros `4xx`                    | No             | El request está mal armado. Reintentar repite el mismo error.               |
| Respuesta con formato inválido | No             | Lo más probable es que el modelo vuelva a responder mal y se gasten tokens. |

En el peor caso, con los valores por defecto, un análisis tarda unos 2 minutos (4 intentos de 30 s más las esperas). Como el [análisis es asíncrono](#análisis-asíncrono-en-el-mismo-proceso), no bloquea a ningún cliente.

Códigos de falla persistidos en `analyses.error_code`:

| `error_code`           | Cuándo                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `LLM_TIMEOUT`          | Se agotaron los reintentos y el último intento fue un timeout.                                                                |
| `LLM_RATE_LIMITED`     | Se agotaron los reintentos por `429`.                                                                                         |
| `LLM_UNAVAILABLE`      | Se agotaron los reintentos por errores de red o `5xx`.                                                                        |
| `LLM_REQUEST_REJECTED` | El proveedor rechazó el request (`401`, `403` u otro `4xx`).                                                                  |
| `LLM_INVALID_RESPONSE` | La respuesta no cumple la [estructura esperada](#validación-de-la-respuesta-del-llm-estructura-estricta-contenido-tolerante). |
| `INTERRUPTED`          | La aplicación se reinició con el análisis en curso.                                                                           |
| `INTERNAL_ERROR`       | Cualquier otro error inesperado.                                                                                              |

`error_message` guarda un texto legible para diagnóstico, sin API keys ni datos sensibles. Si el proveedor informó uso de tokens, se persiste también cuando el análisis falla, porque una respuesta con formato inválido igual consumió tokens.

### Consistencia de los datos

- Crear el análisis y sus filas en `analysis_logs` ocurre en una misma transacción. Nunca queda un análisis sin sus logs.
- Guardar el resultado (estado `COMPLETED`, resumen, hallazgos y `finding_logs`) ocurre en una misma transacción. Nunca queda un análisis completado con hallazgos a medias.
- Si falla incluso el guardado del estado `FAILED` (por ejemplo, porque se cayó la base), el error se registra en el log de la aplicación. La [recuperación al arrancar](#análisis-asíncrono-en-el-mismo-proceso) termina marcando ese análisis como `INTERRUPTED`.

### Health check

`GET /api/health` ejecuta `SELECT 1` contra la base. Si responde, devuelve `200` con `{ "status": "ok", "database": "ok" }`. Si no responde, o tarda más de 2 segundos, devuelve `503` con el [formato de error de la API](#formato-de-error-de-la-api) (`SERVICE_UNAVAILABLE`, `details: { "database": "unreachable" }`); el motivo va solo al log. Se descartó un body propio (`{ "status": "error", ... }`) porque sería la única respuesta de error fuera de ese formato.

### Cómo se prueba

Hay dos grupos de tests, que replican el árbol de `src/`:

- **Unitarios (`npm test`):** solo módulos puros (esquemas, cursor, configuración, construcción del prompt, política de reintentos con timers falsos, normalización de la respuesta del LLM, middlewares y utilidades de controladores). No necesitan Docker ni `DATABASE_URL`: el proyecto de Vitest la deja vacía, así que importar por error un módulo con cableado falla en lugar de llegar a una base.
- **Integración (`npm run test:integration`):** requiere Docker y concentra casi toda la cobertura HTTP. Usa un Postgres de Testcontainers con las migraciones reales y `supertest` sobre `src/app.ts`; ver [Tests de integración contra un Postgres real con Testcontainers](#tests-de-integración-contra-un-postgres-real-con-testcontainers).

Tres piezas del grupo de integración merecen detalle:

- **Test de contrato:** `tests/integration/api/api-contract.test.ts` ejecuta una matriz de requests (éxitos, `401`, `404`, validación, JSON mal formado, `413`, `415`, `409`, `422`, `503`) sobre Postgres y compara status, `content-type` y body con `tests/integration/api/api-contract.golden.json`. Los ids de `randomUUIDv7` y el reloj están fijos (`vi.mock('node:crypto')` y un `Date` falso) y el módulo del LLM está reemplazado por el cliente programable, así que la comparación es byte a byte. Cualquier cambio visible de la API aparece como diff en ese archivo. Se grabó antes de migrar de Fastify a Express y el cambio de framework no lo modificó.
- **Servidor real:** `tests/integration/server.test.ts` lanza `src/server.ts` como proceso hijo y verifica el arranque, la salida con código 1 ante una falla y el cierre con `SIGTERM`.
- **Repositorios y servicios:** se prueban contra Postgres, sin dobles en memoria.

Los tres casos que pide el enunciado se cubren con el cliente programable y timers falsos, para que los tests de timeout y backoff no esperen en tiempo real:

| Caso                             | Resultado esperado                                                             |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Respuesta válida                 | `COMPLETED`, con hallazgos y `finding_logs` persistidos.                       |
| Formato inesperado               | `FAILED` con `LLM_INVALID_RESPONSE`, `raw_response` guardado y sin reintentos. |
| Demora excesiva                  | 1 + `LLM_MAX_RETRIES` intentos (4 por defecto) y `FAILED` con `LLM_TIMEOUT`.   |
| Timeout y luego respuesta válida | `COMPLETED`: el reintento recupera.                                            |

Para el [análisis único en curso](#un-solo-análisis-en-curso-a-la-vez), los tests de integración cubren dos `POST /analyze` simultáneos (uno recibe `202` y el otro `409`), la creación de uno nuevo cuando el anterior termina, y que un análisis huérfano en `PROCESSING` deje de bloquear después de la recuperación al arrancar.

## Configuración y despliegue

### Contenedores

Diagrama: [Contenedores](docs/diagrams/containers.md).

| Servicio | Imagen                 | Puerto                       | Notas                                                        |
| -------- | ---------------------- | ---------------------------- | ------------------------------------------------------------ |
| `app`    | Build del `Dockerfile` | `3000` publicado en el host  | Espera a que `db` esté sana, migra, corre el seed y arranca. |
| `db`     | `postgres` oficial     | `5432` solo dentro de la red | Datos persistidos en el volumen `pgdata`.                    |

La base no se publica en el host: solo la app necesita llegar a ella. La imagen final corre con el usuario no-root `node` e incluye el CLI de Prisma, porque `migrate deploy` corre al arrancar el contenedor.

### Variables de entorno

La configuración se valida con zod al arrancar. Si falta algo obligatorio o tiene un valor inválido, la app no inicia y muestra qué variable falló. Por ejemplo, `LLM_PROVIDER=gemini` sin `GEMINI_API_KEY` impide el arranque.

| Variable                                              | Default            | Descripción                                                                   |
| ----------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- |
| `PORT`                                                | `3000`             | Puerto HTTP de la app.                                                        |
| `HOST`                                                | `0.0.0.0`          | Interfaz de escucha. Dentro de un contenedor tiene que ser `0.0.0.0`.         |
| `DATABASE_URL`                                        | — (obligatoria)    | Cadena de conexión a Postgres. En el compose apunta al host `db`.             |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | —                  | Credenciales con las que se inicializa el contenedor de Postgres.             |
| `LLM_PROVIDER`                                        | `mock`             | `mock` o `gemini`.                                                            |
| `GEMINI_API_KEY`                                      | —                  | Obligatoria solo si `LLM_PROVIDER=gemini`.                                    |
| `LLM_MODEL`                                           | `gemini-3.6-flash` | Modelo de Gemini a usar.                                                      |
| `LLM_TIMEOUT_MS`                                      | `30000`            | Timeout por intento.                                                          |
| `LLM_MAX_RETRIES`                                     | `3`                | Reintentos ante errores transitorios (entero de 0 a 10; 0 = un solo intento). |
| `LLM_MOCK_BEHAVIOR`                                   | `normal`           | Solo con `LLM_PROVIDER=mock`: `normal`, `invalid` (respuesta que no es JSON) o `timeout` (no responde hasta abortarse). Sirve para ver las fallas sin Gemini. |
| `SEED_ON_START`                                       | `true`             | Ejecutar el seed idempotente al arrancar.                                     |
| `LOG_LEVEL`                                           | `info`             | Nivel del log de la aplicación.                                               |

`.env.example` contiene todas las variables, sin valores reales. Las API keys de los servicios de ejemplo se crean en el seed y están en [docs/ejemplos-api.md](docs/ejemplos-api.md).

## Limitaciones y evolución

| Limitación                                               | Riesgo                                                                    | Evolución                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Los análisis corren en el mismo proceso.                 | Un reinicio pierde los análisis en curso.                                 | Una cola persistente: `pg-boss` usa el mismo Postgres; BullMQ con Redis si hiciera falta más throughput.            |
| API keys en texto plano y sin rotación.                  | Una filtración de la base expone todas las keys.                          | Guardar un SHA-256 y permitir varias keys activas por servicio.                                                     |
| Sin autorización por recurso.                            | Cualquier servicio lee los logs de todos.                                 | Restringir lecturas al propio servicio, o roles de lectura separados de los de ingesta.                             |
| Los logs se envían tal cual a un proveedor externo.      | Datos sensibles dentro de mensajes o `metadata` salen de la organización. | Enmascarar datos sensibles antes de armar el prompt, o usar un modelo local.                                        |
| Los mensajes de log son texto no confiable en el prompt. | Prompt injection: un log puede contener instrucciones para el modelo.     | Hoy se mitiga delimitando los logs, pidiendo salida con esquema y validando con zod. No es una protección completa. |
| Un solo análisis en curso a la vez.                      | La mayoría de los pedidos recibe `409` y tiene que reintentar.            | Una cola con concurrencia configurable.                                                                             |
| Un análisis cubre una sola página, de hasta 200 logs.    | Un incidente grande no se ve completo en un análisis.                     | Analizar por lotes y combinar los resúmenes en un análisis final.                                                   |
| Ingesta de un log por request y sin límite de tasa.      | Un servicio ruidoso puede saturar la API.                                 | Ingesta por lotes y rate limiting por API key (`express-rate-limit`).                                              |
| Sin política de retención.                               | La tabla `logs` crece sin límite.                                         | Particionar `logs` por fecha y eliminar particiones viejas; a gran volumen, Elasticsearch o Loki.                   |
| Agrupación fija en `stats`.                              | No responde preguntas como "errores por hora".                            | Agrupaciones configurables e intervalos de tiempo con `$queryRaw`.                                                  |
| Observabilidad limitada al log estructurado (pino).      | No hay métricas de latencia, fallas del LLM ni costo acumulado.           | Métricas para Prometheus y trazas con OpenTelemetry; tokens y duración ya están en `analyses`.                      |
