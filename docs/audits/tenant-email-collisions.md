# Auditoria de colisões `(tenantId, email)` — RFC-0059 §1 / RFC-0060 Fase 0.1

**Status:** template — aguardando execução de
`scripts/db/ops/audit-tenant-email-collisions.sql` contra dados reais (dev e produção).

## Como preencher

1. Rodar `npm run db:ops scripts/db/ops/audit-tenant-email-collisions.sql` contra o ambiente
   desejado (local via Docker, ou manualmente via `psql`/client de BI contra produção — o
   runner `db:ops` só fala com o container Docker local, não com produção).
2. Colar o resultado na tabela abaixo, uma linha por email colidido.
3. Classificar cada colisão: **Legítima** (pessoa real com relação de negócio em mais de um
   tenant) ou **Acidental/teste** (dado de teste, duplicata sem motivo real).
4. Depois de classificar todas as linhas, preencher a seção "Decisão" com a opção escolhida
   (a) ou (b) do RFC-0059 §1, e atualizar a seção "Unresolved questions" do RFC-0059 e do
   RFC-0060 com o resultado.

## Resultado

| Email (normalizado) | Tenants envolvidos | Usuários (id / status / tipo) | Classificação | Observação |
|---|---|---|---|---|
| _(preencher após rodar o script)_ | | | | |

## Resumo

- Total de emails com colisão: _(preencher)_
- Colisões legítimas: _(preencher)_
- Colisões acidentais/teste: _(preencher)_

## Decisão (RFC-0059 §1)

- [ ] Opção (a) — uma Auth0 Connection por tenant
- [ ] Opção (b) — uma Connection só, email globalmente único (recomendação do RFC-0059)

**Justificativa:** _(preencher)_

**Aprovado por (Produto/Segurança):** _(preencher)_
