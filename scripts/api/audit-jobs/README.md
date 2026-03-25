# audit-jobs

Auditoria de Device Sync Jobs via API GCDR.

## Estrutura

```
audit-jobs/
├── audit-jobs.sh
└── customers/
    └── <customer-name>/
        └── config.env          ← GCDR_CUSTOMER_ID + credenciais
```

## Configuração

Crie a pasta do customer e o `config.env`:

```bash
mkdir -p customers/<customer-name>
```

```bash
# customers/<customer-name>/config.env
GCDR_CUSTOMER_ID=<uuid-do-customer-no-gcdr>
GCDR_API_KEY=gcdr_<customer>_bundle_key_2026
# GCDR_API_URL=https://gcdr-api.a.myio-bas.com   # opcional, sobrepõe o default
```

Customers disponíveis:

| Customer | Pasta |
|---|---|
| Shopping Metrópole Ananindeua | `customers/metropole-ananindeua` |

## Uso

### Listar jobs de um customer

```bash
./audit-jobs.sh --customer metropole-ananindeua
./audit-jobs.sh --customer metropole-ananindeua --status PARTIAL
./audit-jobs.sh --customer metropole-ananindeua --status FAILED --page 2
```

Status válidos: `QUEUED` · `RUNNING` · `DONE` · `PARTIAL` · `FAILED`

Gera o arquivo `customers/<name>/audit-jobs-report-<timestamp>.json`.

### Detalhar um job

```bash
./audit-jobs.sh --job <jobId>
```

### Ver log completo de um job

```bash
./audit-jobs.sh --job <jobId> --log
```

### Ver apenas falhas do log

```bash
./audit-jobs.sh --job <jobId> --log --fails-only
```

## Variáveis de ambiente

| Variável | Default | Descrição |
|---|---|---|
| `GCDR_API_URL` | `https://gcdr-api.a.myio-bas.com` | URL base da API |
| `GCDR_API_KEY` | `gcdr_myio_tenant_bundle_key_2026` | API Key |
| `GCDR_AUTH_MODE` | `apikey` | `apikey` ou `jwt` |
| `GCDR_EMAIL` | — | Email para auth JWT |
| `GCDR_PASSWORD` | — | Senha para auth JWT |
| `GCDR_CUSTOMER_ID` | — | UUID do customer (lido do `config.env`) |

Env vars têm precedência sobre o `config.env`.

## Exit codes

| Código | Significado |
|---|---|
| `0` | Todos os jobs `DONE` |
| `2` | Há jobs `PARTIAL` ou `FAILED` |
| `1` | Erro fatal (API inacessível, customer não encontrado, etc.) |

## Exemplos rápidos

```bash
# Local
GCDR_API_URL=http://localhost:3015 ./audit-jobs.sh --customer metropole-ananindeua

# Prod com JWT
./audit-jobs.sh --customer metropole-ananindeua --auth jwt

# Ver falhas do último job
./audit-jobs.sh --job <jobId> --log --fails-only
```
