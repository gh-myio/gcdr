# CI Build → GHCR → Dokploy (mover o build para fora do EC2)

> **Objetivo:** parar de buildar as imagens Docker no host EC2 (onde o Dokploy
> roda). Hoje o `docker build`/`npm run build` do deploy estoura a RAM do
> `t3.medium` (4 GB, sem swap) e dispara o **OOM killer**, matando `journald` e
> containers de produção — o host "congela". A solução: **buildar no GitHub
> Actions** (runner com 7 GB+), publicar a imagem no **GHCR** e o Dokploy apenas
> **puxar a imagem pronta** (pull ≈ RAM irrisória).
>
> **Branch de deploy = `desenv`.** É a branch que o Dokploy está conectado; a
> `main` está **sem uso**. Todos os workflows disparam em push na `desenv`.
>
> **Regra de ouro:** o build/deploy **só acontece se o quality gate passar**
> (typecheck + lint + testes). No workflow isso é garantido por `needs: quality`.

Referência do incidente: `logs/EC2..Actions.MonitorTroubleshoot.GetSystemLog-i-05b7745e3c9ccacf5.log`
(`systemd invoked oom-killer … global_oom` → `Out of memory: Killed process … (node)`;
`Total swap = 0kB`; `Hardware name: Amazon EC2 t3.medium`).

---

## Antes × depois

**Hoje (problema):**
```
push desenv → GitHub Actions → chama Dokploy redeploy
                               └─ Dokploy roda `docker build` NO EC2  ← pico de RAM → OOM → freeze
```

**Depois (alvo):**
```
push desenv → Actions: [quality gate] → [build + push imagem] → dispara Dokploy redeploy → Dokploy: PULL da imagem
             (typecheck/lint/test)      (build no runner, 7 GB+)                            (sem build no EC2 → sem OOM)
                  │ falhou? aborta tudo — nada é publicado nem deployado
```

**Estado dos repos:**
| Repo | Quality CI | Deploy/Build image | Ação |
|------|-----------|--------------------|------|
| `gcdr` (backend) | ✅ `pr-quality.yml` | ❌ (Dokploy builda no EC2) | criar `build-and-deploy.yml` (push desenv) |
| `gcdr-frontend` | ✅ criado (`pr-quality.yml` + `.eslintrc.cjs`) | ⚠️ `deploy.yml` só disparava redeploy | trocado por build+push+deploy (push desenv) |

---

## Pré-requisitos comuns (uma vez)

### PC1. Registry: GitHub Container Registry (GHCR)
Sem provisionamento. Imagens:
- Frontend → `ghcr.io/gh-myio/gcdr-frontend`
- Backend  → `ghcr.io/gh-myio/gcdr`

Push autenticado pelo `GITHUB_TOKEN` do Actions (`permissions: packages: write`). Nenhum secret extra para publicar.

### PC2. Secrets / variables do GitHub (por repositório)
| Nome | Tipo | Usado por | Observação |
|------|------|-----------|------------|
| `DOKPLOY_URL` | secret | ambos | ex.: `https://dokploy.SEU-DOMINIO` |
| `DOKPLOY_API_TOKEN` | secret | ambos | token de API do Dokploy |
| `DOKPLOY_APP_ID` | secret | **por repo** | id do app no Dokploy (frontend ≠ backend) |
| `APP_URL` | variable | ambos (healthcheck) | ex.: `https://gcdr-web.a.myio-bas.com` |
| `VITE_TURNSTILE_SITE_KEY` | variable | frontend (opcional) | **site key pública** do Turnstile (não é secret) |
| `SLACK_WEBHOOK` | variable | opcional | notificação |

### PC3. Dokploy: virar o provider para "imagem" (manual, por app)
1. Dokploy → o app → **General / Provider** → **Docker (image)**.
2. **Image:** `ghcr.io/gh-myio/gcdr-frontend:latest` (frontend) ou `ghcr.io/gh-myio/gcdr:latest` (backend).
3. Salvar. A partir daí "redeploy" = **pull + recreate**, sem build.

### PC4. Credencial do GHCR no Dokploy (só se o pacote for privado)
Pacotes GHCR nascem **privados**. Ou:
- **Público:** GitHub → repo → *Packages* → pacote → *Package settings* → *Change visibility* → Public. **(mais simples)**
- **Privado + login:** Dokploy → **Registry** → adicionar `ghcr.io` com usuário GitHub + **PAT (classic)** com escopo `read:packages`.

### PC5. Rede de segurança
Manter o **swap de 4 GB** no EC2 até tudo estar rodando por imagem.

---

## ⚙️ Cutover (ordem importa!)
O corte é feito **na `desenv`** (não há PR pra main). Sequência correta:

1. **Merge/push na `desenv`** com os workflows → o `Build & Deploy` roda: quality →
   **builda e publica a imagem no GHCR** (`:latest` + `:sha-…`). *(Neste 1º deploy o
   Dokploy ainda builda no EC2 uma última vez — inofensivo, o swap protege.)*
2. **Conferir** a imagem no GHCR (aba *Packages* do repo).
3. **No Dokploy**, virar o provider do app → **Docker (image)** → `:latest` (PC3) + credencial se privado (PC4).
4. **Próximo push na `desenv`** → o Dokploy só faz **pull**. **Fim do build no EC2.**

⚠️ **Não vire a chave no Dokploy (passo 3) antes do passo 1**, senão ele tenta puxar uma imagem inexistente e o deploy falha.

---

## Seção A — Frontend (`gcdr-frontend`) — ✅ arquivos já criados

**Imagem:** `ghcr.io/gh-myio/gcdr-frontend` · Dockerfile multi-stage (Node build → Nginx).
**Atenção:** as `VITE_*` são **embutidas no build** → vão como `build-args` no CI
(config pública, não secrets).

Arquivos entregues neste repo:
- `.eslintrc.cjs` — config ESLint (Vite+React+TS) com regras iniciais lenientes
  (`npm run lint` = **0 errors**, ~37 warnings). Fecha a paridade com o backend.
- `.github/workflows/pr-quality.yml` — gate em **PRs** (typecheck + lint + vitest).
- `.github/workflows/deploy.yml` — em **push `desenv`**: job `quality` → `build-deploy`
  (`needs: quality`) que builda, publica no GHCR e dispara o redeploy no Dokploy.

Trigger e tags do `deploy.yml`:
```yaml
on:
  push:
    branches: [desenv]
  workflow_dispatch: {}
# ...
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}   # gcdr-frontend
          tags: |
            type=raw,value=latest       # último build da desenv (Dokploy segue :latest)
            type=sha,format=long        # tag imutável p/ rollback
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/amd64
          build-args: |
            VITE_API_BASE_URL=https://gcdr-api.a.myio-bas.com
            VITE_DEFAULT_TENANT_ID=11111111-1111-1111-1111-111111111111
            VITE_TURNSTILE_SITE_KEY=${{ vars.VITE_TURNSTILE_SITE_KEY }}
```

**Checklist frontend:**
- [ ] GitHub: conferir `DOKPLOY_URL`/`DOKPLOY_API_TOKEN`/`DOKPLOY_APP_ID` (já existiam) e `APP_URL`.
- [ ] (opcional) variable `VITE_TURNSTILE_SITE_KEY` se usar Turnstile.
- [ ] Cutover (acima): push desenv → conferir GHCR → virar provider no Dokploy.

---

## Seção B — Backend (`gcdr`)

**Imagem:** `ghcr.io/gh-myio/gcdr` · Dockerfile multi-stage (target `production`).
**Migrations** rodam **sozinhas no start** do container (`CMD` chama
`node dist/scripts/migrate.js`) → o **build no CI não precisa de banco nem secrets**;
`DATABASE_URL`/`JWT_SECRET`/`S3_*` seguem vindo do Dokploy em runtime.
**Já existe** `pr-quality.yml` guardando PRs — mantém.

Criar `.github/workflows/build-and-deploy.yml`:

```yaml
name: Build & Deploy (backend)

on:
  push:
    branches: [desenv]        # Dokploy está conectado na desenv; main sem uso
  workflow_dispatch: {}

env:
  IMAGE: ghcr.io/${{ github.repository }}   # ghcr.io/gh-myio/gcdr
  APP_NAME: gcdr-api

jobs:
  quality:
    name: Quality gate
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - name: Jest + coverage
        run: npm run test:ci
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/test
          WO_PIN_PEPPER: ci-test-pepper-32-chars-min-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

  build-deploy:
    name: Build image + deploy
    needs: quality
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.IMAGE }}
          tags: |
            type=raw,value=latest
            type=sha,format=long
      - uses: docker/build-push-action@v6
        with:
          context: .
          target: production            # multi-stage: estágio de produção
          push: true
          platforms: linux/amd64
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Trigger Dokploy redeploy
        run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.DOKPLOY_API_TOKEN }}" \
            -H "Content-Type: application/json" \
            "${{ secrets.DOKPLOY_URL }}/api/application.redeploy" \
            -d '{"applicationId":"${{ secrets.DOKPLOY_APP_ID }}"}'
      - name: Health check
        run: |
          for i in $(seq 1 15); do
            code=$(curl -s -o /dev/null -w "%{http_code}" "${{ vars.APP_URL }}/health" || echo 000)
            [ "$code" = "200" ] && { echo "✅ healthy"; exit 0; }
            echo "tentativa $i: $code — aguardando 10s"; sleep 10
          done
          echo "::warning::health check não passou"
```

**Checklist backend:**
- [ ] Criar `.github/workflows/build-and-deploy.yml` (acima).
- [ ] Secret `DOKPLOY_APP_ID` do backend + `DOKPLOY_URL`/`DOKPLOY_API_TOKEN` + variable `APP_URL` (`https://gcdr-api.a.myio-bas.com`).
- [ ] `pr-quality.yml` do backend hoje roda em `push` **e** `pull_request`; ao adicionar o gate no deploy, opcionalmente restrinja o `pr-quality.yml` a `pull_request` para não rodar qualidade 2× no push da `desenv`.
- [ ] Cutover: push desenv → conferir GHCR → Dokploy provider → **Docker (image)** → `ghcr.io/gh-myio/gcdr:latest` + runtime envs (`DATABASE_URL`, `JWT_SECRET`, `S3_*`).

**Nota compose (backend):** se o app no Dokploy usa o `docker-compose.yml` do repo,
o serviço `api` tem `build: { context: ., target: production }`. Troque para
`image: ghcr.io/gh-myio/gcdr:latest` para **puxar** em vez de buildar; Postgres/MinIO
seguem por `image:` como já estão.

---

## Rollback
Tags imutáveis por **SHA** (`type=sha`). Para voltar:
1. Dokploy → app → Image = `ghcr.io/gh-myio/<img>:sha-<commit>`.
2. Redeploy. (`latest` sempre aponta pro último build da `desenv`.)

## Verificação pós-corte
- Actions: workflow verde com `quality` **antes** de `build-deploy`.
- GHCR: novos tags `sha-…` + `latest` no pacote.
- **No EC2 durante o deploy:** `docker stats` **sem** `node/esbuild/buildx` de build;
  só `docker pull`. Memória estável (confirmar com o tracker em `/var/log/deploy-tracker/`).
- App respondendo em `/health`.

## Ganhos
- **Zero build no EC2** → fim do OOM/freeze de deploy (causa raiz).
- Deploy mais rápido (cache de layers via `type=gha`).
- Imagens versionadas, rollback trivial.
- **Nada some pra produção sem passar no quality gate.**

## Relacionados
- `scripts/ops/deploy-resource-tracker.sh` + `.service` — monitor de recursos p/ post-mortem.
- Paliativo de swap (manter): ver runbook de OOM.
