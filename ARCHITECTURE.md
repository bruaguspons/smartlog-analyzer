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
| Hook de autenticación                   | Resuelve el servicio a partir de `X-API-Key`; `401` si no corresponde. |
| Rutas HTTP                              | Validan la entrada con zod y traducen los errores.                     |
| Módulo logs                             | Ingesta, listado con filtros y agregación.                             |
| Módulo análisis                         | Crea el análisis, selecciona los logs y expone el resultado.           |
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

### Node + TypeScript + Fastify

- **Descartado:** Express, NestJS.
- **Por qué:** Fastify integra validación por esquema, hooks para autenticación y `app.inject()` para tests de integración sin levantar un puerto. Express requiere armar todo eso a mano. NestJS aporta inyección de dependencias y estructura que no se justifican para este alcance.
- **Consecuencias:** la estructura de módulos la definimos nosotros y hay que documentarla.

### zod como única fuente de validación y tipos

- **Descartado:** JSON Schema nativo de Fastify (ajv).
- **Por qué:** con zod el mismo esquema da el tipo de TypeScript y la validación en runtime, y también valida la respuesta del LLM, que es tan poco confiable como un input externo.
- **Consecuencias:** se usa un type provider de zod para Fastify. ajv sería algo más rápido, pero la diferencia es irrelevante a esta escala.

### PostgreSQL

- **Descartado:** MongoDB, Elasticsearch/Loki.
- **Por qué:** el modelo tiene relaciones N:M y agregaciones por servicio, nivel y fecha, que se expresan naturalmente en SQL. `JSONB` cubre la parte semiestructurada (`metadata`, `suggestions`). Un motor especializado en logs sería la opción a escala, pero agrega un componente más para operar.
- **Consecuencias:** a gran volumen habría que particionar `logs` por fecha o usar un motor de logs.

### Análisis asíncrono en el mismo proceso

- **Descartado:** procesamiento síncrono; cola externa (RabbitMQ, BullMQ + Redis).
- **Por qué:** una llamada al LLM puede tardar decenas de segundos y no debería mantener abierto el request. `POST` responde `202` con el id y el cliente consulta el estado. Una cola externa daría reintentos y durabilidad, pero suma infraestructura que no se justifica en el prototipo.
- **Consecuencias:**
  - Cierre ordenado: el ejecutor lleva el registro de los análisis en curso. Al recibir `SIGTERM`, aborta cada llamada al LLM (sin más reintentos) y espera a que cada análisis quede en `FAILED` con `error_code = INTERRUPTED`; recién entonces se cierra el pool de la base. Un único hook `onClose` en la raíz de composición (`createRuntime` en `src/composition/create-runtime.ts`) fija ese orden.
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
- **Detalle:** la app completa se ejercita vía `app.inject()` con la misma raíz de composición que el servidor (`createRuntime`) y con un cliente de LLM programable (`ScriptedLlmClient`) que fija la respuesta de cada intento.
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

### Plugins del ecosistema Fastify: adoptados y descartados

- **Adoptados:** `fastify-type-provider-zod` (valida y serializa con zod), `@fastify/swagger` y `@fastify/swagger-ui` (OpenAPI en `/docs`, generado desde los esquemas zod) y `close-with-grace` (apagado ordenado ante señales y errores no capturados, con timeout forzado de 8 s).
- **Esquemas recursivos en OpenAPI:** la conversión a OpenAPI se hace ruta por ruta y descarta los esquemas zod recursivos que no están registrados, así que el `metadata` JSON se registra con un id (`JsonValue`) para que se publique como componente; sin él, el documento queda con referencias que no resuelven y `/docs` falla.
- **Descartados**, cada uno por una razón concreta:
  - `@fastify/rate-limit`: sin un productor de `429` en el alcance; queda como evolución (ver [Limitaciones y evolución](#limitaciones-y-evolución)).
  - `@fastify/env` y `env-schema`: la configuración ya se valida con zod al arrancar.
  - `@fastify/sensible`: sus helpers de errores HTTP duplican la jerarquía `AppError` y el handler único.
  - `@fastify/auth` y `@fastify/bearer-auth`: hay un solo esquema de autenticación y un hook alcanza.
  - `@fastify/under-pressure`: el [health check](#health-check) cubre el caso.
  - `@fastify/helmet` y `@fastify/cors`: es una API interna que consumen servicios, no navegadores.
  - `@fastify/autoload`: con pocos módulos, el registro explícito es más fácil de seguir.

El hook de `X-API-Key` vive dentro de un plugin con prefijo `/api`. Una ruta desconocida responde `404` sin autenticar, y lo que se registra fuera de ese scope (`/docs`, `GET /api/health`) es público sin un flag por ruta.

### JSON en camelCase en toda la API

- **Por qué:** todos los campos JSON van en `camelCase` (`serviceId`, `traceId`, `nextCursor`). Coincide con los nombres de los tipos TypeScript y con el JSON nativo de JavaScript, y evita convertir nombres en cada borde. Las columnas siguen en `snake_case` y Prisma las mapea con `@map`.
- **Descartado, `snake_case`:** lo recomiendan algunas guías de API y aparece en el legado de OpenTelemetry (`trace_id`). Obliga a mapear nombres en cada request y response, y mezclar ambas convenciones sería peor que cualquiera de las dos.
- **Consecuencia:** el body de `POST /api/logs` es estricto. Un `trace_id` o un `serviceId` en el body se rechaza con `400`.

### Estructura del proyecto: capas hexagonales por módulo, una carpeta por caso de uso

- **Decisión:** cada módulo (`logs`, `analysis`, `services`) se divide en cuatro carpetas: `src/modules/<contexto>/domain/` (entidades, constantes y puertos, sin imports hacia afuera), `application/<caso-de-uso>/` (la lógica de cada caso de uso, por ejemplo `ingest-log`, `start-analysis`, `run-analysis`), `http/<caso-de-uso>/` (ruta, esquema zod y constantes propias del adaptador HTTP, con el mismo nombre de carpeta que su caso de uso) e `infrastructure/` (Prisma, LLM, seed). Lo que comparten varios casos de uso va en una carpeta propia por funcionalidad: `application/cursor/`, `application/llm-response/`, `http/log-filters/`, `http/pagination/`, `http/validation/` y `http/log-response/`. Lo que usa un solo caso de uso queda dentro de él (`application/run-analysis/prompt/` y `retry/`). Las dependencias van hacia adentro: `application/` nunca importa de `http/`, `http/` e `infrastructure/` pueden importar de `application/` y `domain/`, y `domain/` no importa de ninguna otra capa. Cada archivo exporta una sola función o clase, con el nombre del símbolo en kebab-case, y los sufijos `.types.ts`, `.const.ts`, `.schema.ts` y `.route.ts` separan tipos, constantes, esquemas zod y rutas. Los tests replican el árbol de `src/` y los dobles de prueba viven en `tests/support/`.
- **Imports:** `@/` apunta a `src/` (y `@tests/` a `tests/`) mediante `paths` de TypeScript; en el build, `tsc-alias` los reescribe a rutas relativas, y Vitest y `tsx` los resuelven por su cuenta. Dentro de una misma carpeta se usa `./`; nunca `../`.
- **Por qué:** separar el caso de uso de su adaptador HTTP permite probar la lógica sin Fastify y cambiar el transporte sin tocarla, y el nombre de cada caso de uso sigue visible en las dos capas. Un archivo corto por símbolo hace que el diff de una revisión muestre exactamente lo que cambió.
- **Descartado:**
  - Capas en el primer nivel (`controllers/`, `services/`, `repositories/`): dispersa un mismo caso de uso en varias carpetas y mezcla contextos distintos.
  - Una sola carpeta por caso de uso con lógica, ruta y esquema juntos: la lógica quedaba acoplada al adaptador HTTP y no se veía qué dependencia apunta hacia dónde.
  - Casos de uso planos dentro de `application/`: mezcla en una sola carpeta archivos de responsabilidades distintas; por eso cada uno tiene su subcarpeta.
  - Tests junto al código: complica el `include` de Vitest y el build, que tendría que excluirlos de `dist/`.
  - Tipos en archivos `.d.ts` propios: `skipLibCheck` los omite en la verificación, así que los errores pasarían sin avisar. Se usan `.types.ts`.
  - Imports nativos `#/` (campo `imports` de `package.json`): exigen condiciones personalizadas en `tsc`, `tsx` y Vitest para apuntar a `src/` en desarrollo y a `dist/` en producción; el alias con `tsc-alias` es más simple.
- **Consecuencias:** hay más archivos y carpetas; a cambio, cada archivo tiene una sola razón para cambiar. Los dos `LOG_LEVELS` (niveles de pino en `shared/config/env.const.ts` y `DEBUG..FATAL` en `modules/logs/domain/log.const.ts`) conservan su nombre y se distinguen por la ruta.

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

Un único error handler de Fastify traduce cada error a esta forma. Un 4xx que no es de la aplicación y no tiene código propio (por ejemplo `415` por un `content-type` no soportado) conserva su status y usa `VALIDATION_ERROR`. Los errores no previstos responden `500` con un mensaje genérico: el detalle y el stack trace van solo al log de la aplicación.

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
| Ingesta de un log por request y sin límite de tasa.      | Un servicio ruidoso puede saturar la API.                                 | Ingesta por lotes y rate limiting por API key (`@fastify/rate-limit`).                                              |
| Sin política de retención.                               | La tabla `logs` crece sin límite.                                         | Particionar `logs` por fecha y eliminar particiones viejas; a gran volumen, Elasticsearch o Loki.                   |
| Agrupación fija en `stats`.                              | No responde preguntas como "errores por hora".                            | Agrupaciones configurables e intervalos de tiempo con `$queryRaw`.                                                  |
| Observabilidad limitada al log estructurado (pino).      | No hay métricas de latencia, fallas del LLM ni costo acumulado.           | Métricas para Prometheus y trazas con OpenTelemetry; tokens y duración ya están en `analyses`.                      |
