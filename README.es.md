# CF ActivityPub MCP

[English](README.md) | **Español**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/github/v/tag/manalejandro/cf-activitypub-mcp?label=version)](https://github.com/manalejandro/cf-activitypub-mcp/releases)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/manalejandro/cf-activitypub-mcp/pulls)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-6E56CF)](https://modelcontextprotocol.io/)

> Un servidor remoto de [Model Context Protocol](https://modelcontextprotocol.io/) que permite a los asistentes de IA administrar una instancia de [CF ActivityPub](https://github.com/manalejandro/cf-activitypub-next) a través de su API de administración — totalmente alojado en Cloudflare Workers.

## Descripción general

**CF ActivityPub MCP** es el compañero de administración de [CF ActivityPub Next](https://github.com/manalejandro/cf-activitypub-next), el servidor ActivityPub compatible con Mastodon construido para Cloudflare Workers.

Apunta el worker a tu instancia con el mismo secreto de operador `ADMIN_TOKEN`, conecta cualquier asistente compatible con MCP y gestiona cuentas, reportes, reglas de federación, relays, caché de medios, ajustes y mucho más mediante conversación natural. El worker:

- Expone toda la superficie de administración como **35 herramientas MCP bien descritas**.
- Incluye **Centinela**, un vigilante de IA que se ejecuta en **Durable Objects de Cloudflare**, revisa la instancia periódicamente, pide un análisis a **Workers AI** y puede proponer o ejecutar acciones con guardarraíles.
- Habla **Streamable HTTP** (`/mcp`, respuestas JSON) y un **endpoint con formato SSE** (`/sse`) para clientes que lo requieran.
- Exige su propio **token bearer** (`MCP_AUTH_TOKEN`) en cada petición MCP, independiente del token de la instancia.
- Publica una **página de inicio pública** y un **informe JSON en `/health`** con métricas en vivo, incluido el estado del Centinela.
- Funciona con la **observabilidad de Cloudflare** (traces, logs e issues en tiempo real) habilitada.
- Se despliega en un **dominio personalizado** con un solo `wrangler deploy`.

> El MCP nunca almacena datos de la instancia: cada llamada a herramienta es un proxy autenticado y ligero hacia la API de administración de CF ActivityPub, que mantiene su propia auditoría. Centinela solo guarda su propia configuración, historial de ejecuciones y decisiones dentro de su Durable Object.

## Arquitectura

| Capa | Tecnología |
|---|---|
| Runtime | Cloudflare Workers |
| Transporte MCP | [Agents SDK](https://developers.cloudflare.com/agents/) `createMcpHandler` (sin estado, MCP SDK v2) |
| Protocolos | Streamable HTTP + formato SSE, JSON-RPC 2.0 |
| Autenticación | Token bearer (`MCP_AUTH_TOKEN`) con comparación de tiempo constante |
| Upstream | API de administración de CF ActivityPub (`ADMIN_TOKEN`) |
| Centinela de IA | Cloudflare Durable Objects (SQLite) + planificación del Agents SDK + Workers AI |
| Observabilidad | Workers Logs, Traces e Issues |
| Lenguaje | TypeScript, esquemas Zod |

## Endpoints

| Ruta | Método | Autenticación | Descripción |
|---|---|---|---|
| `/` | GET | Pública | Página de inicio con métricas de salud en vivo |
| `/health` | GET | Pública | Informe de salud JSON (worker + instancia) |
| `/mcp` | POST | Bearer | Endpoint MCP Streamable HTTP; JSON por defecto, SSE cuando se necesita |
| `/sse` | POST | Bearer | Endpoint MCP con formato SSE para clientes que lo prefieren |
| `/mcp`, `/sse` | OPTIONS | Pública | Preflight CORS gestionado por el handler MCP |

Las revisiones modernas del protocolo (`2026-07-28`) reciben respuestas JSON; los clientes legacy se atienden mediante el carril de compatibilidad sin estado. El transporte HTTP+SSE obsoleto (un stream `GET /sse` de larga duración más `POST /messages`) no se implementa a propósito: apunta los clientes legacy a `/mcp` (o usa un proxy como [`mcp-remote`](https://www.npmjs.com/package/mcp-remote)).

## Requisitos

- Una instancia de **CF ActivityPub Next** desplegada con `ADMIN_TOKEN` configurado (`wrangler secret put ADMIN_TOKEN` en ese proyecto).
- Una **cuenta de Cloudflare** con el dominio que quieras usar. Centinela usa además **Workers AI** (disponible en el plan gratuito con una asignación diaria de neuronas) y un **Durable Object**.
- **Node.js 20+** y npm.

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar la URL de la instancia (y opcionalmente el dominio personalizado)
#    Edita `vars` en wrangler.jsonc: ACTIVITYPUB_URL=https://social.example.com

# 3. Crear los dos secretos
npx wrangler secret put ADMIN_TOKEN      # el mismo valor que el ADMIN_TOKEN de la instancia
npx wrangler secret put MCP_AUTH_TOKEN   # openssl rand -hex 32

# 4. Desarrollo local
npm run dev

# 5. Desplegar
npm run deploy
```

Para desarrollo local, copia `.dev.vars.example` a `.dev.vars` y rellena ambos tokens.

## Configuración

### Variables de texto plano (`vars` en `wrangler.jsonc`)

| Variable | Obligatoria | Descripción |
|---|---|---|
| `ACTIVITYPUB_URL` | Sí | URL pública base de la instancia CF ActivityPub, p. ej. `https://social.example.com` |
| `MCP_SERVER_NAME` | No | Nombre que reporta el servidor MCP (por defecto `cf-activitypub-mcp`) |
| `MCP_SERVER_VERSION` | No | Versión que reporta el servidor MCP (por defecto `1.0.0`) |
| `MCP_ALLOWED_HOSTNAMES` | No | Lista de Hosts permitidos separados por comas para los endpoints MCP. Localhost y `workers.dev` siempre se aceptan si no se define |
| `MCP_ALLOWED_ORIGINS` | No | Lista de Origins de navegador permitidos separados por comas, o `*` cuando una capa superior valida los orígenes. Solo es necesario para clientes MCP basados en navegador |

Las variables `SENTINEL_*` que siembran la configuración de Centinela se documentan en [Centinela (AI Sentinel)](#centinela-ai-sentinel).

### Secretos (`wrangler secret put`)

| Secreto | Descripción |
|---|---|
| `ADMIN_TOKEN` | El secreto de operador de la instancia CF ActivityPub. Otorga acceso de administrador completo a su API |
| `MCP_AUTH_TOKEN` | Token bearer que los clientes MCP deben presentar en `/mcp` y `/sse`. Genera uno con `openssl rand -hex 32` |

## Autenticación

Hay dos credenciales independientes:

1. **Clientes MCP → este worker.** Cada petición a `/mcp` o `/sse` debe incluir `Authorization: Bearer <MCP_AUTH_TOKEN>`. En caso contrario se responde `401`, y el endpoint se cierra con `503` cuando el secreto no está configurado. La comparación de tokens hashea ambos valores antes de compararlos para evitar filtraciones de tiempo.
2. **Este worker → la instancia ActivityPub.** Las llamadas a herramientas envían `Authorization: Bearer <ADMIN_TOKEN>` a la API de administración de la instancia. La instancia lo valida con su propia lógica de `admin-auth` y registra cada mutación en el log de moderación.

Rota cada token de forma independiente: cambiar `MCP_AUTH_TOKEN` solo afecta el acceso MCP; cambiar `ADMIN_TOKEN` debe hacerse en ambos workers.

## Conectar un cliente MCP

### Claude Desktop (mediante `mcp-remote`)

```json
{
	"mcpServers": {
		"cf-activitypub": {
			"command": "npx",
			"args": [
				"mcp-remote",
				"https://mcp.example.com/mcp",
				"--header",
				"Authorization: Bearer <MCP_AUTH_TOKEN>"
			]
		}
	}
}
```

### Clientes con transporte remoto nativo (Cursor, VS Code y otros)

```json
{
	"mcpServers": {
		"cf-activitypub": {
			"url": "https://mcp.example.com/mcp",
			"headers": {
				"Authorization": "Bearer <MCP_AUTH_TOKEN>"
			}
		}
	}
}
```

Usa `https://mcp.example.com/sse` en lugar de `/mcp` cuando un cliente exija explícitamente un endpoint SSE.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
# Transport: Streamable HTTP
# URL:       https://mcp.example.com/mcp
# Header:    Authorization: Bearer <MCP_AUTH_TOKEN>
```

## Herramientas

El servidor expone 35 herramientas, agrupadas por dominio administrativo. Las acciones destructivas (`delete`, `reject`, `suspend`, `demote`, `purge`, `clear_all`, `remove`, `dismiss`) requieren un argumento explícito `confirm: true`, de modo que un asistente no puede destruir datos por accidente.

### Resumen y salud

| Herramienta | Descripción |
|---|---|
| `check_instance_health` | Alcanzabilidad y latencia de la instancia más sus metadatos públicos |
| `get_instance_info` | Payload público completo de la instancia (versión, idiomas, límites, política de registro) |
| `get_instance_overview` | Resumen combinado: metadatos, totales de cuentas/reportes/moderación/federación/relays y estadísticas de la caché de medios |

### Ajustes de instancia

| Herramienta | Descripción |
|---|---|
| `get_instance_settings` | Reglas, políticas, idiomas y ajustes de registro |
| `update_instance_settings` | Actualiza cualquier subconjunto de los ajustes anteriores |

### Cuentas y moderación

| Herramienta | Descripción |
|---|---|
| `list_accounts` | Busca/filtra cuentas locales y remotas (estado, rol, localidad, consulta) |
| `get_account` | Una cuenta con sus flags de moderación, rol y perfil |
| `moderate_account` | approve, unapprove, reject, silence, unsilence, suspend, unsuspend, promote, demote, delete |
| `verify_account` | Fuerza un refresco de verificación `rel="me"` |
| `search` | Búsqueda federada de cuentas, estados, hashtags y colecciones |

### Reportes

| Herramienta | Descripción |
|---|---|
| `list_reports` | Reportes de abuso con estados, cuentas y notas |
| `get_report` | Un ticket de reporte |
| `manage_report` | resolve, dismiss, reopen, delete, add_note |

### Federación

| Herramienta | Descripción |
|---|---|
| `list_domain_blocks` | Bloqueos de dominio a nivel de instancia |
| `manage_domain_block` | block / unblock de un dominio (severidad, rechazo de medios/reportes, comentarios) |
| `list_instances` | Registro de federación con filtros por estado |
| `manage_instance` | add, refresh, reset, suspend, unsuspend, purge |
| `list_relays` | Relays ActivityPub suscritos |
| `manage_relay` | add, enable, disable, remove |

### Contenido y políticas

| Herramienta | Descripción |
|---|---|
| `list_licenses` | Catálogo de licencias (FEP-6757) |
| `manage_license` | add, update, delete |
| `list_emojis` | Emojis personalizados, incluidos los deshabilitados |
| `manage_emoji` | upload (URL o base64), habilitar/deshabilitar, delete |
| `manage_announcement` | create / delete de anuncios de instancia |

### Operaciones

| Herramienta | Descripción |
|---|---|
| `get_media_cache` | Estadísticas de caché, entradas más servidas y configuración efectiva |
| `manage_media_cache` | enforce_budget, purge |
| `list_email_blocks` | Buzones bloqueados (hashes canónicos de email) |
| `manage_email_block` | block / unblock de un buzón |
| `get_moderation_log` | Auditoría con filtros por objetivo/acción |
| `manage_moderation_log` | delete_entry, clear_all |

### Centinela (AI Sentinel)

| Herramienta | Descripción |
|---|---|
| `get_sentinel_status` | Configuración, libro de uso de IA, última ejecución, próximo chequeo y totales de decisiones |
| `configure_sentinel` | Modo, intervalo, modelo, umbrales, allow-list, dominios protegidos, webhook |
| `run_sentinel_check` | Ejecuta un análisis inmediato (respeta el modo actual) |
| `get_sentinel_decisions` | Historial de decisiones con estado, objetivo, confianza y resultado |
| `clear_sentinel_decisions` | Borra el historial de decisiones y ejecuciones (requiere confirmación) |

### Limitaciones conocidas

- `manage_report` con `action: "add_note"` necesita un token OAuth propiedad de un actor local; el `ADMIN_TOKEN` compartido no puede crear notas y la instancia responde `401`.
- El listado de anuncios en la instancia es solo para actores autenticados, por lo que este MCP puede crear y eliminar anuncios, pero no listarlos.
- El MCP nunca accede directamente a la base de datos de la instancia; se limita a lo que permite la API de administración.

## Centinela (AI Sentinel)

Centinela es un vigilante autónomo que vive en un **Durable Object con SQLite** y despierta según una planificación gestionada por el [Agents SDK](https://developers.cloudflare.com/agents/) (basada en alarmas de Durable Objects).

En cada chequeo:

1. Recopila un snapshot compacto a través de la API de administración: salud de la instancia, contadores, registros pendientes, reportes abiertos, instancias federadas problemáticas, bloqueos de dominio, presión de la caché de medios y el log de moderación reciente.
2. Pide a **Workers AI** (modo JSON) un análisis estructurado: resumen, severidad, hallazgos y acciones propuestas.
3. Aplica **guardarraíles deterministas** en código — no en el prompt — y después registra, propone o ejecuta las acciones que sobreviven según el modo configurado.

### Modos

| Modo | Comportamiento |
|---|---|
| `observe` | Solo analiza y registra hallazgos. No propone ni ejecuta nada. |
| `suggest` | Registra las acciones propuestas para que el operador las revise, pero nunca llama a la API de la instancia. |
| `enforce` | Ejecuta las acciones que superan todos los guardarraíles. |

`enforce` es potente: empieza en `observe`, revisa el historial de decisiones, pasa a `suggest` y solo después a `enforce` con una allow-list estrecha.

### Guardarraíles

- **Allow-list de acciones.** Solo existen `resolve_report`, `dismiss_report`, `silence_account`, `suspend_account`, `block_domain` y `enforce_media_cache`, y el operador elige cuáles están habilitadas.
- **Umbrales de confianza por acción** combinados con `minConfidence` (por ejemplo, suspender una cuenta o bloquear un dominio exige ≥ 0.9 por defecto).
- **Presupuesto por ejecución.** Como máximo se ejecutan `maxActionsPerRun` acciones por chequeo.
- **Presupuesto diario de neuronas.** El Centinela estima el coste en neuronas de cada llamada a Workers AI a partir de los tokens que devuelve el proveedor y de las tarifas oficiales por modelo. Cuando se alcanza `dailyNeuronBudget` (día UTC, igual que el reinicio de Cloudflare a las 00:00 UTC), los chequeos programados se omiten y quedan registrados hasta el día siguiente. Usa `0` para consumo ilimitado.
- **Enfriamiento (cooldown).** La misma acción contra el mismo objetivo no se repite dentro de `cooldownHours` (24 por defecto).
- **Objetivos protegidos.** Los administradores y moderadores nunca pueden ser silenciados ni suspendidos; los dominios protegidos nunca se bloquean; los dominios ya bloqueados y las cuentas ya moderadas se omiten.
- **Defensa contra inyección de prompt.** Los comentarios de reportes, motivos de registro y nombres visibles se tratan como datos no confiables, y los guardarraíles se ejecutan en código, así que un modelo manipulado no puede exceder su mandato.
- **Auditoría.** Cada ejecución y decisión se guarda en el Durable Object con estado `observed`, `proposed`, `blocked`, `executed` o `failed`.

### Configuración

El agente se siembra en el primer arranque desde las variables de `wrangler.jsonc` y luego puede reconfigurarse en vivo con `configure_sentinel`:

| Variable | Por defecto | Descripción |
|---|---|---|
| `SENTINEL_ENABLED` | `false` | Inicia la planificación periódica |
| `SENTINEL_MODE` | `observe` | `observe`, `suggest` o `enforce` |
| `SENTINEL_INTERVAL_SECONDS` | `900` | Segundos entre chequeos (60 – 86400) |
| `SENTINEL_MODEL` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Modelo de Workers AI |
| `SENTINEL_MAX_ACTIONS` | `3` | Límite duro de acciones ejecutadas por ejecución |
| `SENTINEL_MIN_CONFIDENCE` | `0.8` | Confianza mínima del modelo |
| `SENTINEL_COOLDOWN_HOURS` | `24` | Ventana de enfriamiento por acción+objetivo |
| `SENTINEL_DAILY_NEURON_BUDGET` | `10000` | Presupuesto de Workers AI en neuronas por día UTC (`0` = ilimitado) |
| `SENTINEL_ALLOWED_ACTIONS` | todas | Allow-list separada por comas |
| `SENTINEL_PROTECTED_DOMAINS` | vacío | Dominios contra los que el Centinela nunca debe actuar |
| `SENTINEL_NOTIFY_WEBHOOK` | vacío | Webhook HTTPS que recibe un resumen JSON tras cada ejecución |

Una primera configuración típica desde un cliente MCP:

```text
configure_sentinel { "enabled": true, "mode": "suggest", "interval_seconds": 3600, "daily_neuron_budget": 10000 }
run_sentinel_check {}
get_sentinel_decisions { "limit": 20 }
```

`get_sentinel_status` informa del libro de uso en vivo: `usage.neuronsUsed`, `usage.dailyNeuronBudget`, `usage.remaining`, `usage.runs` y totales de tokens del día UTC actual. El presupuesto es una válvula de seguridad, no una factura exacta: el uso se estima a partir de los tokens que devuelve el modelo (o de la longitud del texto cuando no los incluye) y de las tarifas publicadas por modelo.

> **Desarrollo local:** el simulador local no puede ejecutar bindings de Workers AI, así que los chequeos del Centinela en `wrangler dev` se registran como errores y no consumen neuronas. Despliega el worker (o usa `wrangler dev --remote` con una `ACTIVITYPUB_URL` públicamente accesible) para probar el modelo.

> Centinela complementa al **Guardian** de la propia instancia: el Guardian modera contenido dentro de CF ActivityPub, mientras que Centinela observa la instancia como lo haría un operador y actúa a través de la API de administración. Ambos mantienen sus propias auditorías.

## Salud y página de inicio

- `GET /` renderiza una página pública que enlaza ambos repositorios y muestra métricas en vivo (estado del worker, estado de la instancia, latencia, usuarios activos, número de herramientas y modo del Centinela).
- `GET /health` devuelve los mismos datos en JSON, apto para monitores de disponibilidad:

```json
{
	"status": "ok",
	"service": { "name": "cf-activitypub-mcp", "version": "1.0.0", "tools": 35, "authentication": "bearer" },
	"instance": { "url": "https://social.example.com", "reachable": true, "latency_ms": 42, "users": 128 },
	"sentinel": { "enabled": true, "mode": "suggest", "last_run_at": "2026-10-04T04:00:00.000Z", "last_run_status": "ok", "decisions_total": 12, "neurons_today": 843, "daily_neuron_budget": 10000 }
}
```

Ninguno de los dos endpoints expone secretos ni detalles administrativos. La sección del Centinela se lee de su Durable Object y se cachea un minuto para que el sondeo de salud no mantenga al agente despierto.

## Seguridad

- **Fallo cerrado.** Los endpoints MCP se niegan a servir cuando falta `MCP_AUTH_TOKEN`.
- **Mínimo privilegio.** El MCP solo conoce la API de administración de la instancia; no puede acceder a recursos de la cuenta de Cloudflare.
- **Auditoría.** Cada mutación realizada a través del MCP queda registrada por la instancia en su log de moderación; el Centinela mantiene su propio historial de decisiones.
- **Guardas de confirmación.** Las herramientas destructivas requieren `confirm: true`; el modelo debe recibir la orden explícita.
- **Guardarraíles del Centinela.** La IA nunca ejecuta una acción fuera de la allow-list, por debajo del umbral de confianza, por encima del presupuesto por ejecución ni contra cuentas y dominios protegidos. Los guardarraíles se ejecutan en código, no en el prompt.
- **Defensa contra inyección de prompt.** El contenido del snapshot se trata como datos no confiables y nunca como instrucciones.
- **Comparación de tokens en tiempo constante.** El token candidato y el esperado se hashean y se comparan con un acumulador XOR.
- **Listas de Origin/Host.** `MCP_ALLOWED_ORIGINS` / `MCP_ALLOWED_HOSTNAMES` permiten restringir el acceso de navegadores y Hosts.
- **Source maps.** `upload_source_maps` mantiene legibles las trazas en el panel sin enviarlas a los clientes.

Si encuentras un problema de seguridad, abre un reporte privado a través de GitHub en lugar de un issue público.

## Desarrollo

| Script | Propósito |
|---|---|
| `npm run dev` | Inicia el servidor local de desarrollo de Workers |
| `npm run deploy` | Despliega en Cloudflare (dominio personalizado desde `wrangler.jsonc`) |
| `npm test` | Ejecuta la suite de Vitest dentro del runtime de Workers |
| `npm run test:watch` | Modo watch |
| `npm run typecheck` | Comprobación estricta de TypeScript |
| `npm run cf-typegen` | Regenera `worker-configuration.d.ts` tras cambios en bindings |

### Estructura del proyecto

```
src/
  index.ts                  Entrada del worker: rutas, auth, endpoints, export del DO
  config.ts                 Parseo de entorno y valores por defecto
  auth.ts                   Autenticación bearer y comparación de secretos
  activitypub/
    client.ts               Cliente autenticado para la API de la instancia
    types.ts                Formas compartidas de los payloads de la API
  mcp/
    server.ts               Fábrica del servidor MCP y catálogo de herramientas
    context.ts              Contexto de herramientas por petición (clientes + env)
    result.ts               Utilidades de resultado de herramientas
    tools/                  Un módulo por dominio administrativo
  sentinel/
    agent.ts                Centinela: agente en Durable Object con SQLite
    analyze.ts              Prompt de Workers AI y análisis estructurado
    snapshot.ts             Recopilación del snapshot de la instancia
    policy.ts               Guardarraíles deterministas y validación de ajustes
    defaults.ts             Configuración sembrada desde el entorno
    types.ts                Tipos del Centinela y catálogo de acciones
  web/
    health.ts               Recopilación del informe de salud (incluye el Centinela)
    index-page.ts           Renderizador de la página de inicio pública
test/
  index.spec.ts             Pruebas de rutas del worker y del protocolo MCP
  config.spec.ts            Pruebas unitarias de configuración y auth
  client.spec.ts            Pruebas unitarias del cliente de ActivityPub
  sentinel.spec.ts          Pruebas de política, análisis y Durable Object del Centinela
```

## Notas de despliegue

1. Define `routes[0].pattern` en `wrangler.jsonc` con tu subdominio (por ejemplo `mcp.example.com`). Wrangler crea el registro DNS y el certificado automáticamente al desplegar.
2. Define `ACTIVITYPUB_URL` con la URL pública de tu instancia.
3. Configura ambos secretos con `wrangler secret put`.
4. Ejecuta `npm run deploy` y abre `https://mcp.example.com/` para verificar las métricas de salud.
5. La observabilidad ya está habilitada: traces, logs e issues en tiempo real están disponibles en el panel de Cloudflare, en la pestaña **Observability** del worker.

El primer despliegue aplica la migración `v1` y crea la clase Durable Object `SentinelAgent` con almacenamiento SQLite. Los endpoints MCP siguen siendo sin estado y funcionan enteramente a través de la API de la instancia; solo Centinela usa almacenamiento de Durable Objects, Workers AI y alarmas.

## Licencia

[MIT](LICENSE) © 2026 manalejandro

CF ActivityPub MCP no está afiliado a Cloudflare, Inc. ni al proyecto Mastodon. El autor no se responsabiliza del uso de este software ni de los cargos que Cloudflare pueda aplicar.
