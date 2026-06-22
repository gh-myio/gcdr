# URLs da API GCDR

## URLs disponíveis

| Recurso       | URL                                                              |
|---------------|------------------------------------------------------------------|
| Swagger UI    | https://gcdr-server.apps.myio-bas.com/docs                       |
| OpenAPI JSON  | https://gcdr-server.apps.myio-bas.com/docs/openapi.json          |
| Health Check  | https://gcdr-server.apps.myio-bas.com/health                     |
| DB Admin      | https://gcdr-server.apps.myio-bas.com/admin/db                   |
| Simulator     | https://gcdr-server.apps.myio-bas.com/admin/simulator            |

### A documentacao inclui

- Autenticacao JWT (Bearer token) e API Key
- Endpoints de Customers (CRUD, hierarquia, tree, move)
- Endpoints de Partners (registro, aprovacao, API keys, OAuth, webhooks)
- Endpoints de Authorization (roles, policies, assignments, check)
- Endpoints de Assets (CRUD, hierarquia)
- Endpoints de Devices (CRUD, conectividade)
- Endpoints de Rules (CRUD, evaluate, toggle, maintenance windows)
- Endpoints de Alarm Bundles (full e simplified para Node-RED)
- Endpoints de Customer API Keys (CRUD para autenticacao M2M)
- Endpoints de Audit Logs (consulta de logs de auditoria - RFC-0009)
- Endpoints de Groups (CRUD, membros, hierarquia)
- Endpoints de Integrations (packages, subscriptions, marketplace)
- Endpoints de Centrals (CRUD, heartbeat, status)
- Endpoints de Themes (CRUD, compile, effective)
- Endpoints de Users (CRUD, MFA, convites, password reset)
- Endpoints de Simulator (RFC-0010)
- Endpoints de Registration (RFC-0011)
- Health checks
- Schemas completos (140+ endpoints documentados)

## Ambientes

| Ambiente    | URL                                                              |
|-------------|------------------------------------------------------------------|
| Production  | https://gcdr-server.apps.myio-bas.com                            |
| Local Dev   | http://localhost:3015                                            |

## Headers obrigatorios

**Autenticacao JWT (usuarios):**
```http
Content-Type: application/json
x-tenant-id: <uuid-do-tenant>
Authorization: Bearer <jwt-token>
```

**Autenticacao API Key (M2M - Node-RED, sistemas externos):**
```http
Content-Type: application/json
x-tenant-id: <uuid-do-tenant>
X-API-Key: gcdr_cust_<api-key>
```

**Autenticacao API Key (parceiros):**
```http
X-API-Key: <api-key-do-partner>
```
