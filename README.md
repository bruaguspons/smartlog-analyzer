# smartlog-analyzer

[![CI](https://github.com/bruaguspons/smartlog-analyzer/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bruaguspons/smartlog-analyzer/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)

Servicio de ingesta de logs y análisis con IA (desafío de Abstracta). Los microservicios envían sus logs por HTTP, se consultan con filtros y paginado por cursor, y un LLM (mock por defecto, Gemini opcional) detecta problemas sobre una página de logs.

## Documentación

| Documento                                                                | Contenido                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md)                                       | Decisiones técnicas, alternativas descartadas y manejo de fallas.                     |
| [docs/MER.md](docs/MER.md)                                               | Modelo de datos (MER, modelo entidad-relación): diagrama, columnas, claves e índices. |
| [docs/ejemplos-api.md](docs/ejemplos-api.md)                             | Ejemplos de requests, uso de Swagger UI y API keys de desarrollo.                     |
| [docs/diagrams/components.md](docs/diagrams/components.md)               | Vista de componentes.                                                                 |
| [docs/diagrams/analysis-sequence.md](docs/diagrams/analysis-sequence.md) | Secuencia del análisis.                                                               |
| [docs/diagrams/containers.md](docs/diagrams/containers.md)               | Contenedores y red.                                                                   |

## Requisitos

- Node.js 24.16 o superior y npm.
- Docker: para `docker compose up` y para los tests de integración.

## Instalación

```sh
cp .env.example .env
docker compose up -d --build
```

Levanta Postgres y la aplicación en `http://localhost:3000`. Los valores por defecto salen de `docker-compose.yml`; todas las variables están en `.env.example` y se describen en [Variables de entorno](ARCHITECTURE.md#variables-de-entorno).

El LLM por defecto es un mock determinista y no necesita key. Para usar Gemini, se cambian estas variables en `.env` y se vuelve a levantar con `docker compose up -d`:

```sh
LLM_PROVIDER=gemini
GEMINI_API_KEY=<api-key>
```

### Cómo obtener la API key de Gemini

La key se genera gratis desde Google AI Studio, con una cuenta de Google:

1. Entrar a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) e iniciar sesión.
2. Aceptar los términos de servicio. En una cuenta sin proyectos de Google Cloud, AI Studio crea un proyecto y una key por defecto. Si la cuenta ya tiene proyectos, hay que importar uno desde **Dashboard > Projects > Import projects** antes de crear la key.
3. Crear la key en la página **API Keys** y copiarla en `GEMINI_API_KEY` dentro de `.env`.

Notas:

- Cada key pertenece a un proyecto de Google Cloud, que define la cuota y la facturación. Sin facturación configurada se usa el nivel gratuito, con límites de requests por minuto y por día; un proyecto importado puede necesitar verificación antes de usarlo. Si se superan los límites, Gemini responde `429` y la aplicación reintenta con backoff (ver [Llamada al LLM](ARCHITECTURE.md#llamada-al-llm)).
- La aplicación lee solo `GEMINI_API_KEY` y se la pasa explícitamente al SDK; `GOOGLE_API_KEY` no se usa.
- `.env` está en `.gitignore`: la key no se commitea. Si se filtra, se crea una nueva, se reemplaza en `.env` y se deshabilita la anterior desde la misma página de AI Studio.

Guía oficial: [Using Gemini API keys](https://aistudio.google.com/docs/api-key).

## Uso de la API

La documentación OpenAPI interactiva está en `/docs` (puerto 3000). Las rutas de la API, salvo `GET /api/health`, requieren el header `X-API-Key`. Los ejemplos de requests y las keys de desarrollo están en [docs/ejemplos-api.md](docs/ejemplos-api.md).

## Pruebas

- `npm test`: tests unitarios, sin Docker.
- `npm run test:integration`: Postgres real con Testcontainers (requiere Docker); aplica las migraciones y falla si difieren de `db/schema.prisma`.
- `npm run lint` y `npm run typecheck`: análisis estático.

## Cómo se usó la IA

Claude Code fue el asistente durante todo el proyecto. El autor definió el alcance y las decisiones de `ARCHITECTURE.md` y revisó cada cambio.

## Trabajo a futuro

- Los análisis corren en el mismo proceso, y un reinicio pierde los que están en curso: se resolvería con una cola persistente.
- Las API keys están en texto plano y sin rotación: se guardaría un hash y se permitirían varias keys por servicio.
- No hay autorización por recurso: cualquier servicio lee los logs de todos. Se restringirían las lecturas al propio servicio o a roles de lectura.
- No hay rate limiting ni ingesta por lotes: se agregaría un endpoint de lotes y `@fastify/rate-limit` por API key.
- No hay política de retención de logs: se particionaría `logs` por fecha.
- La observabilidad se limita al log estructurado: se agregarían métricas y trazas.

El detalle de cada limitación y de cómo evolucionaría está en [Limitaciones y evolución](ARCHITECTURE.md#limitaciones-y-evolución).
