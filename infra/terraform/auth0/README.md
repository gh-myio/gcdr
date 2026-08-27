# infra/terraform/auth0

Terraform para os tenants Auth0 do GCDR — RFC-0059 (§1, §3) / RFC-0060 (Fase 0.4).

## Status

Scaffolding escrito, **não aplicado**. Escrito num ambiente sem o binário `terraform`
instalado e sem credenciais Auth0/AWS — `init`/`validate`/`plan`/`apply` ainda não rodaram.
Antes do primeiro `apply` real, confira os nomes de recurso/argumento contra a documentação
atual do provider (`registry.terraform.io/providers/auth0/auth0`), já que a API do provider
pode ter mudado desde que isto foi escrito.

## Pré-requisitos externos (fora deste repositório)

1. **Tenant Auth0** — confirmar/criar os tenants (dev e prod) no
   [Auth0 Dashboard](https://manage.auth0.com/).
2. **Machine-to-Machine Application da Management API** — criar manualmente no Auth0
   Dashboard, autorizada para a Management API com os escopos que este Terraform usa (criar
   connections, clients, actions, resource servers). **O Terraform não pode criar as próprias
   credenciais que usa para se autenticar** — isso é sempre um passo manual, uma vez por
   tenant.
3. **Backend de state** — bucket S3 + tabela DynamoDB de lock (ou workspace Terraform Cloud).
   Ver `backend.tf` — hoje comentado, local-state only.
4. **Decisão do modelo multi-tenant (RFC-0059 §1)** — rodar
   `scripts/db/ops/audit-tenant-email-collisions.sql` contra dados reais, preencher
   `docs/audits/tenant-email-collisions.md`, e só então fixar `var.tenant_model` (`"single"`
   ou `"per_tenant"`) antes do primeiro `apply`.

## Uso (uma vez que os pré-requisitos acima existirem)

```bash
cd infra/terraform/auth0

terraform init

terraform plan \
  -var="auth0_domain=myio-dev.us.auth0.com" \
  -var="auth0_management_client_id=<do passo 2>" \
  -var="auth0_management_client_secret=<do passo 2>" \
  -var="environment=dev" \
  -var="tenant_model=single"
```

Nunca commitar `*.tfvars` com segredos reais — passar via `-var`/`TF_VAR_*` ou um `.tfvars`
git-ignored.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `provider.tf` | Provider Auth0, versão fixada |
| `backend.tf` | Backend de state remoto (comentado — infra ainda não existe) |
| `variables.tf` | Variáveis, incluindo `tenant_model` (decisão do §1) |
| `connections.tf` | `auth0_connection` — 1 global ou N por tenant, conforme `tenant_model` |
| `clients.tf` | App humano (PKCE) + client M2M do `Auth0ProvisioningService` (usado só na Fase 4) |
| `actions.tf` | Action que injeta `tid` de `app_metadata` no token (RFC-0059 §1) |
| `resource_server.tf` | API/audience para os tokens RS256 (Fase 1 e Fase 4) |
