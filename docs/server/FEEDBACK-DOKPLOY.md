# Feedback - Dokploy Loop de Container

## Identificacao
- Data: 2026-01-29
- Autor: (preencher)
- Area/Time: Plataforma / DevOps
- Contexto: [ ] feature [x] bug [ ] processo [ ] documentacao [ ] performance [ ] seguranca
- Ambiente: [ ] local [ ] dev [ ] staging [x] production

## Resumo
- O que foi observado: Container reinicia em loop no Dokploy e morre rapido demais para capturar logs.
- Impacto: Servico indisponivel e diagnostico lento.
- Evidencias (links, prints, logs): (preencher)

## Detalhes
- O que funcionou bem: N/A
- O que nao funcionou: Processo encerra rapidamente apos tentativa de migration/start.
- Reproducao (passos):
  1. Subir a imagem no Dokploy.
  2. Container inicia, tenta executar migration e encerra.
  3. Orquestrador reinicia o container em loop.

## Sugestoes
- Proposta de melhoria: Validar `DATABASE_URL` antes de iniciar e registrar erro claro.
- Alternativas consideradas: Job separado para migrations; start script resiliente; comando de debug com `sleep`.
- Riscos/Trade-offs: Ignorar migration pode mascarar erro real; job separado exige orquestracao adicional.

## Rastreabilidade
- Issue relacionada:
- PR relacionado:
- RFC relacionado:

## Prioridade
- Urgencia: alta
- Severidade: alta
- Prazo sugerido:

## Acoes
- Responsavel:
- Status: pendente
- Data de conclusao:

## Historico
| Data | Autor | Mudanca |
|------|-------|---------|
| 2026-01-29 | (preencher) | Criacao do feedback |
