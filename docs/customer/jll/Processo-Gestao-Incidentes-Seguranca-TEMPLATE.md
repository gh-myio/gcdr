# MYIO — Processo de Gestão de Incidentes de Segurança da Informação

> TEMPLATE / RASCUNHO — NÃO APROVADO E NÃO IMPLEMENTADO.
> Este documento orienta a elaboração do processo. Sua existência não comprova que há um programa em operação ou recursos disponíveis. Preencher, validar, aprovar, comunicar e testar antes de tratá-lo como processo vigente.

## 1. Controle do documento

| Campo | Preenchimento |
|---|---|
| Versão | 0.1 — template |
| Responsável pelo documento | [Nome / cargo] |
| Aprovador | [Nome / cargo] |
| Data de aprovação | [Não aprovado] |
| Data de vigência | [A definir] |
| Próxima revisão | [A definir] |
| Classificação e acesso | [Definir] |
| Local oficial de publicação | [Definir] |

## 2. Objetivo e escopo

Definir como a MYIO recebe, avalia, responde e aprende com incidentes de segurança que possam afetar seus serviços, dados de clientes e operações.

Preencher os ambientes, sistemas e dados abrangidos: [produção / desenvolvimento / testes / endpoints / dispositivos de campo / serviços AWS / fornecedores].

Relacionar dependências com gestão de mudanças, continuidade, recuperação de desastres, privacidade e contratos: [referências].

## 3. Definições

- **Evento de segurança:** ocorrência que necessita de avaliação; nem todo alerta representa um incidente.
- **Incidente de segurança:** ocorrência confirmada ou suspeita que compromete a confidencialidade, integridade ou disponibilidade de informações ou serviços.
- **Incidente com dados pessoais:** incidente que pode envolver dados de pessoas naturais; encaminhar ao responsável por privacidade para avaliação.

Definir critérios locais para diferenciar falha operacional, vulnerabilidade e incidente: [preencher].

## 4. Responsáveis e recursos

As funções abaixo são propostas; nomear titulares e substitutos e confirmar disponibilidade.

| Função | Responsabilidade proposta | Titular / substituto / contato |
|---|---|---|
| Coordenador do incidente | Classificar, coordenar ações, manter registro e escalar decisões | [Preencher] |
| Equipe técnica | Investigar, preservar evidências, conter e recuperar | [Preencher] |
| Privacidade / jurídico | Avaliar dados pessoais e obrigações de comunicação | [Preencher] |
| Gestão executiva | Aprovar decisões de impacto, prioridades e recursos | [Preencher] |
| Comunicação com clientes | Preparar e enviar comunicações autorizadas | [Preencher] |
| Contato de fornecedores | Acionar suporte e acompanhar dependências externas | [Preencher] |

- Cobertura de atendimento e acionamento fora do expediente: [definir; não presumir 24x7].
- Ferramenta de registro de incidentes: [definir].
- Fontes de logs, alertas e acessos necessários: [definir].
- Repositório restrito de evidências: [definir].
- Canal alternativo se e-mail ou identidade corporativa estiverem comprometidos: [definir].
- Orçamento, suporte externo e autoridade para contratação emergencial: [definir].

## 5. Detecção e reporte

Fontes propostas: alertas técnicos, logs, relatos de colaboradores, clientes e fornecedores. Confirmar as fontes efetivamente disponíveis: [preencher].

Canal oficial para reporte: [endereço / telefone / sistema].

Dados mínimos do reporte:

- Data, hora e fuso da detecção; contato do relator.
- Sistema ou ativo envolvido e descrição do comportamento observado.
- Impacto conhecido e clientes potencialmente afetados.
- Evidências disponíveis e ações já realizadas.

Não incluir senhas, tokens ou cópias desnecessárias de dados de clientes nos chamados. Definir canal restrito para evidências sensíveis.

## 6. Triagem, severidade e escalonamento

Validar o alerta, registrar incertezas e avaliar alcance, sensibilidade dos dados, indisponibilidade, acesso indevido e propagação. Reclassificar conforme novas evidências.

| Severidade proposta | Critérios a validar | Prazo de triagem | Escalonamento |
|---|---|---|---|
| Crítica | Comprometimento ativo com impacto amplo ou grave | [Definir] | [Definir] |
| Alta | Impacto relevante ou risco elevado de propagação | [Definir] | [Definir] |
| Média | Impacto limitado, sem evidência de propagação ampla | [Definir] | [Definir] |
| Baixa | Evento de baixo impacto que requer tratamento | [Definir] | [Definir] |

Definir quem declara um incidente e quem pode mobilizar recursos: [preencher]. Os prazos desta tabela só passam a valer após aprovação.

## 7. Fluxo de resposta

### 7.1 Registrar e investigar

Abrir identificador único; designar coordenador; registrar cronologia, ativos, clientes, fatos confirmados e hipóteses. Verificar possíveis dados pessoais e encaminhar para privacidade quando necessário.

### 7.2 Preservar evidências

Preservar logs e demais evidências relevantes em armazenamento restrito. Registrar origem, coletor, horário, acessos e transferências; utilizar verificações de integridade quando aplicável. Evitar alterações destrutivas desnecessárias antes da coleta, sem atrasar contenção urgente.

Retenção, acesso, integridade e descarte das evidências: [definir com os responsáveis].

### 7.3 Conter

Avaliar medidas como isolar ativos, restringir tráfego, suspender contas ou revogar credenciais comprometidas. Registrar impacto operacional, autorização e resultados.

Autoridade para ações emergenciais, limites e aprovação posterior: [definir].

### 7.4 Remover a causa

Identificar e corrigir a origem do comprometimento, remover persistência e corrigir configurações ou vulnerabilidades pertinentes. Confirmar se outros ativos e credenciais foram afetados.

### 7.5 Recuperar e validar

Restaurar a partir de fontes verificadas, validar integridade e funcionamento, verificar ausência de sinais de comprometimento e monitorar recorrência.

Critérios para retorno, responsável pela aprovação e período de monitoramento reforçado: [definir]. Referenciar o plano de recuperação e seus objetivos, se existentes; não presumir RTO ou RPO definidos.

### 7.6 Encerrar e melhorar

Registrar causa identificada ou limitações da investigação, impacto, ações executadas, validação da recuperação e pendências. Realizar revisão pós-incidente e atribuir responsáveis e prazos às melhorias.

Critério de encerramento e aprovador: [definir]. Prazo da revisão pós-incidente: [definir].

## 8. Comunicação

| Público | Responsável pelo envio | Gatilho / prazo validado | Canal / aprovador |
|---|---|---|---|
| Equipe interna e gestão | [Definir] | [Definir] | [Definir] |
| Clientes afetados | [Definir] | [Validar contrato] | [Definir] |
| Fornecedores | [Definir] | [Definir] | [Definir] |
| Autoridades e titulares, quando aplicável | [Privacidade / jurídico] | [Validar requisitos vigentes] | [Definir] |

Privacidade/jurídico deve avaliar e registrar obrigações aplicáveis, gatilhos, destinatários, prazos e justificativa para comunicar ou não. Este template não estabelece prazos legais.

Modelo de comunicado:

> Identificador: [ID]. Em [data/hora/fuso], identificamos [fatos confirmados]. O impacto conhecido é [descrição], e [aspectos] permanecem sob investigação. Foram tomadas [ações]. A orientação ao destinatário é [ação, se necessária]. Próxima atualização: [data/hora ou condição]. Contato: [canal autorizado].

## 9. Registro de incidente — formulário

| Campo | Valor |
|---|---|
| Identificador / status / severidade | [Preencher] |
| Coordenador / equipe | [Preencher] |
| Detecção / início estimado / fuso | [Preencher] |
| Sistemas, ativos e clientes afetados | [Preencher] |
| Dados envolvidos e avaliação de privacidade | [Preencher] |
| Evidências e localização restrita | [Referências; evitar dados sensíveis no formulário] |
| Cronologia de decisões e ações | [Preencher] |
| Contenção / correção / recuperação | [Preencher] |
| Autorizações e comunicações | [Preencher] |
| Validação e aprovação de encerramento | [Preencher] |
| Causa, lições e ações pendentes | [Responsável / prazo / evidência de conclusão] |

## 10. Treinamento, exercícios e revisão

- Comunicar o processo aos colaboradores e treinar os responsáveis: [plano / evidências].
- Definir periodicidade e cenários de exercícios: [preencher].
- Registrar participantes, resultados, lacunas e ações corretivas de cada exercício.
- Revisar após incidentes relevantes e mudanças de ambiente, além da periodicidade aprovada: [definir].
- Definir métricas, como tempo de triagem, contenção, recuperação e fechamento de ações: [definir responsáveis e fontes].

## 11. Condições para implantação

- [ ] Escopo e critérios aprovados.
- [ ] Responsáveis e substitutos nomeados e disponíveis.
- [ ] Ferramentas, acessos e recursos confirmados.
- [ ] Canais de reporte e escalonamento testados.
- [ ] Regras de evidência e comunicação validadas.
- [ ] Fluxos de contenção e recuperação revisados.
- [ ] Equipe orientada e exercício inicial registrado.
- [ ] Documento aprovado, publicado e com revisão agendada.

## 12. Histórico

| Versão | Data | Alteração | Aprovação |
|---|---|---|---|
| 0.1 | 2026-09-18 | Template inicial; conteúdo pendente de definição | Não aprovado |

## Nota para o questionário JLL — 22.1

Situação informada na elaboração: a empresa ainda não possui este processo. Criar o template não altera essa situação e não sustenta resposta Yes sobre programa implantado e devidamente provido de recursos.

Resposta compatível com o estado informado:

> No. An information security incident management program is not currently in place. A draft process template has been prepared for further development and approval.
