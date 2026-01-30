# Feedback - Exemplo

## Identificacao
- Data: 2026-01-29
- Autor: Joao Silva
- Area/Time: Plataforma / Backend
- Contexto: [ ] feature [x] bug [ ] processo [ ] documentacao [ ] performance [ ] seguranca
- Ambiente: [ ] local [x] dev [ ] staging [ ] production

## Resumo
- O que foi observado: Endpoint de listagem de customers demora acima de 8s em horario de pico.
- Impacto: Dashboard principal fica lento e afeta operacao do time de suporte.
- Evidencias (links, prints, logs): Log APM "customers.list" com p95=8.4s.

## Detalhes
- O que funcionou bem: Resposta correta quando a lista tem poucos itens.
- O que nao funcionou: Paginacao lenta com mais de 10k registros.
- Reproducao (passos):
  1. Acesse o ambiente dev.
  2. Chame GET /customers com limit=50.
  3. Observe latencia acima de 8s.

## Sugestoes
- Proposta de melhoria: Adicionar indice composto em tenant_id + created_at e revisar consulta.
- Alternativas consideradas: Cache por tenant com TTL de 60s.
- Riscos/Trade-offs: Indice pode aumentar tempo de escrita.

## Rastreabilidade
- Issue relacionada: GCDR-1234
- PR relacionado: -
- RFC relacionado: -

## Prioridade
- Urgencia: alta
- Severidade: media
- Prazo sugerido: 2026-02-05

## Acoes
- Responsavel: Time Backend
- Status: pendente
- Data de conclusao:

## Historico
| Data | Autor | Mudanca |
|------|-------|---------|
| 2026-01-29 | Joao Silva | Criacao do feedback |
