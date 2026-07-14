# MYIO Store Dashboard — Planos (v2)

> **Status**: proposta v2 (draft 2026-07-13), baseada em [MYIO_Dashboard_Plans.md](./MYIO_Dashboard_Plans.md)
> **Escopo**: Single Dashboard (RFC-0053, rota `/single-customer/:customerId`) · **Companion visual**: [PLANS.html](./PLANS.html)

Quatro planos, cada um respondendo a uma pergunta do cliente:

| Plano | Pergunta que responde | Persona típica |
|---|---|---|
| **MYIO Essential** | "Quanto eu consumi?" | Restaurante pequeno, clínica, farmácia, mercadinho |
| **MYIO Business** | "O que aconteceu e onde?" | Loja com gestor operacional dedicado |
| **MYIO Enterprise** | "Como otimizar minha operação?" | Operação crítica (câmara fria, alimentação), franquia madura |
| **MYIO Corporate** | "Como gerencio minha rede inteira?" | Grupo/holding, shopping, rede de franquias |

---

## 1. MYIO Essential — *"Quanto eu consumi?"*

**Público-alvo**: pequenos restaurantes, clínicas, farmácias, pequenos mercados.

**Consumo**
- Mês corrente (dia 1 → hoje) e **mês anterior fechado**.
- **Somente totais** de energia (kWh) e água (m³) — sem quebra por dia/hora.
- Variação % vs mesmo ponto do mês anterior.

**Temperatura e reservatórios**
- **Média, mínima e máxima** do período, por sensor (reservatórios renderizam no grupo Água).

**Entrega**
- **Relatório mensal em PDF** (automático).
- **Retenção de 12 meses** de histórico.
- **Multiusuário** (até 3) e **acesso mobile**.
- Cards V6 por sensor com status online/offline e saúde operacional básica.

**Fora do plano**: alarmes, quebra horária/diária, insights, metas, KPIs.

---

## 2. MYIO Business — *"O que aconteceu e onde?"*

Tudo do Essential, mais:

**Relatórios e análise**
- Relatórios personalizados de **até 90 dias**, com quebra **por hora e por dia**.
- Tendências de consumo e **análise comparativa entre períodos**.
- Export **PDF, Excel e CSV**.
- **API REST** (leitura) para integrar BI/planilhas do cliente.

**KPI dashboard**
- **kWh/m²** · **kWh por cliente atendido** · **litros por cliente**
- **% de conformidade de temperatura** (tempo dentro da faixa)
- **Estimativa de autonomia do reservatório** (horas até esvaziar no ritmo atual)
- Pico de demanda e horário do pico; consumo fora do expediente.

**Alarmes**
- Até **5 alarmes ativos** (prioridade CRITICAL–LOW, dedup/cooldown), notificação e-mail/Telegram.

**Colaboração**
- Anotações por dispositivo + consolidado (tab Anotações) e Chamados (tab Chamados).

**Limites sugeridos**: 10 sensores por tipo · 10 usuários · retenção 24 meses.

---

## 3. MYIO Enterprise — *"Como otimizar minha operação?"*

Tudo do Business, mais:

**Alarmes e confiabilidade**
- Até **20 alarmes** + alarmes ativos em tempo quase real via orquestrador (ack, escalonamento, janelas de manutenção).
- **Monitoramento de SLA dos sensores** (uptime/latência de reporte por dispositivo).

**Inteligência (AI Insights)**
- Possível **vazamento de água** (fluxo na madrugada)
- **HVAC consumindo acima do baseline**
- **Degradação de refrigeração** detectada (runtime crescente, recuperação lenta)
- **Oportunidade de otimização de pico de demanda**
- Cada insight com impacto estimado (R$/kWh/m³) e ação sugerida.

**Gestão**
- **Metas e targets** (RFC-0046) com margem ajustada (RFC-0052) e projeção de fechamento do mês.
- **Performance score** e **health score operacional** explicável por componente.
- **Benchmarking** e **ranking de equipamentos** (quem mais consome/desvia).
- **Manutenção preditiva** (alerta antes da falha, integrado a OS/Chamados).
- **Visualização Digital Twin** da loja (planta com sensores ao vivo).

**Limites sugeridos**: sensores ilimitados (fair use) · usuários ilimitados · retenção 36 meses · webhooks.

---

## 4. MYIO Corporate — *"Como gerencio minha rede inteira?"*

Tudo do Enterprise, mais a camada de rede:

- **Gestão multi-site**: visão consolidada de todas as lojas em um painel.
- **Benchmarking de rede** e **ranking de lojas** (kWh/m², m³/m², score de eficiência).
- **Comparação cross-site** (mesma métrica, N lojas, mesmo período).
- **Dashboards executivos** (C-level: tendência, outliers, savings YTD).
- **Score ESG** (energia/água/emissões estimadas, exportável para relatório de sustentabilidade).
- **Metas corporativas** (top-down: meta da rede → distribuída por loja).
- White-label, RBAC granular por rede/regional/loja, auditoria completa, SLA de suporte dedicado.

**Limites sugeridos**: lojas ilimitadas · retenção 48 meses ou custom · contrato enterprise.

---

## 5. Matriz comparativa

| Recurso | Essential | Business | Enterprise | Corporate |
|---|:---:|:---:|:---:|:---:|
| Totais mês corrente + mês fechado (energia/água) | ✅ | ✅ | ✅ | ✅ |
| Média/mín/máx (temperatura/reservatório) | ✅ | ✅ | ✅ | ✅ |
| Relatório mensal PDF | ✅ | ✅ | ✅ | ✅ |
| Acesso mobile + multiusuário | ✅ (3) | ✅ (10) | ✅ (∞) | ✅ (∞) |
| Quebra por hora/dia | — | ✅ (90 dias) | ✅ (90 dias) | ✅ (90 dias) |
| KPIs (kWh/m², kWh/cliente, conformidade, autonomia) | — | ✅ | ✅ | ✅ |
| Tendências + comparativo entre períodos | — | ✅ | ✅ | ✅ |
| Export PDF/Excel/CSV | PDF mensal | ✅ | ✅ | ✅ |
| API REST (leitura) | — | ✅ | ✅ + webhooks | ✅ + webhooks |
| Alarmes | — | até 5 | até 20 | até 20/loja |
| Alarmes ativos em tempo real (orquestrador) | — | — | ✅ | ✅ |
| Anotações + Chamados | — | ✅ | ✅ | ✅ |
| AI Insights (vazamento, baseline, degradação, pico) | — | — | ✅ | ✅ |
| Metas + margem + projeção | — | — | ✅ | ✅ + corporativas |
| Performance score + benchmarking + ranking de equipamentos | — | — | ✅ | ✅ |
| Manutenção preditiva | — | — | ✅ | ✅ |
| Digital Twin | — | — | ✅ | ✅ |
| SLA de sensores | — | — | ✅ | ✅ |
| Multi-site + ranking de lojas + cross-site | — | — | — | ✅ |
| Dashboards executivos + score ESG | — | — | — | ✅ |
| Sensores por tipo | 5 | 10 | ∞* | ∞* |
| Retenção de histórico | 12 meses | 24 meses | 36 meses | 48 meses/custom |

\* fair use.

**Add-ons (qualquer plano)**: sensores extras em pacotes de 5 · retenção estendida · WhatsApp Business nas notificações · onboarding assistido (instalação/calibração).

---

## 6. Layout do dashboard (estado atual do produto)

Área central em **3 grupos operacionais** — *nota: reservatórios/caixas d'água renderizam dentro de Água desde 2026-07-13 (grupo `tanks` foi absorvido pelo `water`)*:

1. **Energia** 2. **Água** (hidrômetros, solenóides, caixas d'água, bombas) 3. **Temperatura**

Cada grupo: cards V6 por dispositivo, indicadores de status, ações rápidas (⋮ Gráfico/Relatório/Config); sidebar com saúde operacional.

**Tabs**: Dashboard · Insights · **Alarmes** · **Anotações** · **Chamados** · Relatórios · Performance · Configurações
*(as tabs visíveis/upsell dependem do plano)*

## 7. Implementação técnica (proposta)

- Plano em `customer.settings.singleDashboard.plan: 'essential' | 'business' | 'enterprise' | 'corporate'` + `PLAN_LIMITS` versionado no backend.
- **Enforcement no backend**, não só na UI: o `GET /single-dashboard` devolve `plan` + `limits`; criação de regra valida teto (5/20); relatórios validam janela ≤ 90 dias e granularidade; tabs bloqueadas mostram *upsell state* ("Disponível no Business →").
- Ingestion (RFC-0053 Q1) em fases: **fase 1** = agregados mensais do Essential (2 números por medidor); **fase 2** = séries hora/dia do Business+.
- Upgrade instantâneo (troca de settings); retenção é política de acesso, não de coleta.
- Corporate: consolidado multi-loja é rota própria (proposta: `/network-dashboard`), fora do escopo do RFC-0053.

## 8. Questões em aberto

1. Preço por loja/mês vs por sensor — fora deste doc.
2. Trial de Enterprise (14 dias) ao ativar a loja?
3. Downgrade com regras acima do teto: desabilitar excedentes começando pelas de menor prioridade?
4. ESG score: metodologia de fator de emissão (kgCO₂/kWh) — validar com time de dados.
5. Digital Twin: escopo mínimo viável (planta 2D com pins de sensor) vs 3D.
