# Integração de Tickets — Freshdesk × Myio

> **Documento de Entrega** · Apresentação técnica · Myio
>
> Funcionamento, propriedades e proposta de segmentação de visões por perfil de usuário.

---

## 1. Contexto — Objetivo & Introdução

### Objetivo
Apresentar o funcionamento da integração do Freshdesk no painel do cliente.

Demonstrar o escopo de exibição dos chamados, a abertura de novos tickets e o detalhamento do conteúdo no painel.

### Introdução — Estado atual da integração
Os chamados estão sendo exibidos no painel de forma integral. Para finalizar a entrega ao cliente, este documento descreve o escopo de funcionamento, as principais propriedades da integração e a proposta de segmentação por perfil de usuário.

---

## 2. Exibição — Quadro de Chamados

### Painel atual
A integração com os chamados do Freshdesk está ativa para exibição do funcionamento e da estrutura, porém com **todos os tickets sendo exibidos de forma integral**.

| Status | Quantidade |
|---|---|
| Abertos | 48 |
| Pendentes | 23 |
| Aguardando | 43 |
| **Total exibido** | **114** |

**Componentes principais**
- Resumo por status (Abertos, Pendentes, Aguardando)
- Lista de chamados recentes com prioridade e data
- Total agregado de tickets exibidos no painel

---

## 3. Criação — Abertura de Novo Chamado

### Caminhos de abertura
Além do HelpDesk Freshdesk e do e-mail, o cliente pode abrir tickets diretamente pelo painel, selecionando **um ou múltiplos dispositivos**.

O fluxo tem duas etapas: **formulário de abertura** e **seleção de dispositivos** (filtráveis por Energia, Água, Temperatura; com busca e seleção múltipla).

**Campos obrigatórios**
- Assunto
- Tipo de chamado
- Motivo
- Descrição
- E-mail do solicitante

> Anexos são opcionais.

---

## 4. Detalhe — Detalhamento do Chamado

### Visualização completa do ticket
A janela exibe os principais campos preenchidos na abertura do ticket, criado no Freshdesk ou no próprio painel.

| Campo | Conteúdo |
|---|---|
| Solicitante | Identificação + e-mail |
| Status | Pendente / Aberto / Aguardando |
| Prioridade | Baixa / Média / Alta / Urgente |
| Criado em | Data e hora de abertura |
| Atualizado | Data da última atualização |
| Empresa | Unidade associada ao ticket |
| Descrição | Detalhamento + comentários |
| CC | Cópias do chamado |

> Ações disponíveis na janela: **Cancelar Chamado**, **Fechar**, e adicionar comentário/atualização.

---

# Parte II — Proposta de funcionamento

Distribuição dos tickets baseada no **e-mail do solicitante**, com três visões segmentadas por perfil de usuário:

- **04 — Técnico**
- **05 — Supervisor / Coordenador**
- **06 — Holding**

---

## 5. Visão Técnico — Visão individualizada por colaborador

### Atribuição por e-mail do solicitante
A integração atribui os tickets ao e-mail do solicitante, que **também deve estar cadastrado na base de usuários do painel**.

**O que o usuário vê**
- Apenas os tickets que abriu
- Tickets que está tratando como responsável
- Resumo restrito ao seu escopo de atendimento

**Exemplo — Painel do Técnico** (`ana.silva@empresa.com` · Técnico · Unidade A)

| Ticket | Descrição | Visibilidade |
|---|---|---|
| #582 | Revisão de medidor — ana.silva@empresa.com | Visível |
| #601 | Validação de leitura — ana.silva@empresa.com | Visível |
| #612 | Inconsistência hidrômetro — ana.silva@empresa.com | Visível |
| #615 | Aberto por carlos.lima@empresa.com | Oculto para este perfil |
| #618 | Aberto por joao.pereira@empresa.com | Oculto para este perfil |

---

## 6. Visão Supervisor / Coordenador — Visão compartilhada por unidade

### Visão compartilhada da equipe
Todos os chamados da unidade são exibidos, com atribuição de **todos os usuários de visão técnica ao responsável da unidade**.

**O que o usuário vê**
- Todos os tickets abertos da unidade
- Tickets de todos os técnicos atribuídos
- Tickets abertos pelo próprio supervisor

**Exemplo — Painel do Supervisor · Unidade A** (Você · Supervisor; equipe: ana.silva, carlos.lima, joao.pereira)

| Ticket | Descrição | Responsável |
|---|---|---|
| #582 | Revisão de medidor | ana.silva |
| #590 | Visita técnica solicitada | Você (supervisor) |
| #601 | Validação de leitura | ana.silva |
| #608 | Falha de telemetria | carlos.lima |
| #615 | Hidrômetro inoperante | joao.pereira |

> Todos os técnicos da unidade reportam ao supervisor.

---

## 7. Visão Holding — Matriz + unidades, filtradas pelo domínio do e-mail

### Atribuição por domínio do e-mail
Todos os chamados das unidades são exibidos. A atribuição é feita pelo **domínio do e-mail**: todos os tickets cujo solicitante use o domínio do cliente aparecem para este perfil.

**Exemplo — domínio `@empresa.com`**
Inclui `ana.silva@empresa.com`, `gerente.matriz@empresa.com`, `supervisor.lojaSP@empresa.com` — todos os tickets desse domínio ficam visíveis.

**Painel da Holding** — Matriz `@empresa.com` → Unidade A, Unidade B, Unidade C

| Ticket | Origem | Solicitante |
|---|---|---|
| #582 | Unidade A | ana.silva@empresa.com |
| #634 | Unidade B | rafael.costa@empresa.com |
| #651 | Unidade C | marcia.pinto@empresa.com |
| #660 | Matriz | diretor.op@empresa.com |

---

## 8. Comparativo — Quem vê o quê

| Perfil | Regra de atribuição | O que vê no painel |
|---|---|---|
| **04 — Técnico** | Atribuição pelo **e-mail do solicitante** | • Apenas seus próprios tickets<br>• Tickets que está tratando |
| **05 — Supervisor** | Atribuição pelo **responsável da unidade** | • Todos os tickets da unidade<br>• Tickets dos técnicos atribuídos<br>• Tickets abertos pelo próprio |
| **06 — Holding** | Atribuição pelo **domínio do e-mail** | • Tickets de todas as unidades<br>• Tickets da matriz<br>• Filtro por domínio `@empresa.com` |

---

## 9. Resumo — Separação por visão de usuários

Ao associar os perfis aos e-mails já cadastrados no sistema, a distribuição dos tickets entra em consonância com as próximas versões, em que recursos, funcionalidades, dispositivos, ambientes e demais elementos terão ações e exibições subordinadas a determinados perfis de usuários.

- **Segregação clara** — cada perfil vê apenas o que lhe cabe.
- **Base unificada** — e-mails do Freshdesk ↔ usuários do painel.
- **Pronto para evoluir** — alinhado às próximas versões do produto.

---

*Myio · Integração Freshdesk × Myio*
