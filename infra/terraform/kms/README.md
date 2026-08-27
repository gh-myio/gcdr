# infra/terraform/kms

Terraform proposto para a chave KMS de assinatura do Grant Service — RFC-0059 §5 / RFC-0060
Fase 0.3. **PROPOSTA, não aplicada.**

## Duas vias candidatas — escolher UMA

Este repositório já tem um caminho de IaC AWS (`serverless.yml`, CloudFormation via Serverless
Framework), mas não ficou confirmado se ele ainda está ativo em produção — a produção real hoje
roda como container Docker via Dokploy (`dokploy.yml`), não como Lambda. Por isso a chave está
proposta nos dois formatos:

1. **CloudFormation** — bloco comentado em `serverless.yml`, logo após o recurso
   `GcdrEventBus`, marcado `PROPOSED, NOT ACTIVE`.
2. **Terraform** (este diretório) — módulo independente, provider AWS puro (não usa o provider
   Auth0 de `infra/terraform/auth0/`).

**Aplicar só uma das duas.** A decisão de qual (RFC-0060 Fase 0, "Fora do GCDR": "Dono da
infra AWS — confirmar se o caminho Lambda/serverless.yml ainda está ativo") ainda não foi
tomada.

## Pré-requisitos externos

- Confirmar conta/região AWS (região sugerida: `sa-east-1`, default do `serverless.yml`).
- Confirmar se `serverless.yml` segue ativo (define qual das duas vias usar).
- Backend de state — mesmo backend S3+DynamoDB de `infra/terraform/auth0/backend.tf`, ou um
  próprio; não provisionado ainda.

## Uso (se esta via for a escolhida)

```bash
cd infra/terraform/kms
terraform init
terraform plan -var="environment=dev" -var="aws_region=sa-east-1"
```

Depois de aplicado, o ARN da chave e o alias saem como `output` — usar para preencher
`GRANT_KMS_KEY_ID`/`GRANT_KMS_REGION` em `.env.example`/`dokploy.yml` e no cofre de secrets do
Dokploy.
