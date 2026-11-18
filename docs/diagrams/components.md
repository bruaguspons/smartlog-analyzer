# Vista de componentes

Se describe en la sección [Vista de componentes](../../ARCHITECTURE.md#vista-de-componentes) de `ARCHITECTURE.md`.

```mermaid
flowchart LR
    subgraph Clientes
        S1[Microservicio A]
        S2[Microservicio B]
    end

    subgraph App["smartlog-analyzer (Node + Express)"]
        AUTH[Middleware de autenticación<br/>X-API-Key]
        ROUTES[Rutas y controladores<br/>validación con zod]
        LOGS[Servicio de logs]
        ANA[Servicio de análisis]
        RUNNER["Ejecutor de análisis (AnalysisRunner)<br/>asíncrono en proceso"]
        LLM{{LlmClient}}
        GEMINI[GeminiClient]
        MOCK[MockClient]
    end

    DB[(PostgreSQL)]
    GAPI[API de Gemini]

    S1 & S2 -->|HTTP + X-API-Key| AUTH --> ROUTES
    ROUTES --> LOGS
    ROUTES --> ANA
    ANA --> RUNNER
    RUNNER --> LLM
    LLM -.->|LLM_PROVIDER=gemini| GEMINI
    LLM -.->|LLM_PROVIDER=mock| MOCK
    GEMINI -->|HTTPS| GAPI
    LOGS --> DB
    ANA --> DB
    RUNNER --> DB
```
