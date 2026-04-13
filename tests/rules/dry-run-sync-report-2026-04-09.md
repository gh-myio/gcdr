# Dry-Run Sync Report — Mont Serrat → 5 Customers
**Date:** 2026-04-09  
**Master:** Mont Serrat (14 rules)  
**Script:** `tests/rules/dry-run-sync-rules-from-mont-serrat.sh`

---

## Summary

| Customer | Rules | ✓ In Sync | ≠ Diverge | ✗ No Match | + Orphan |
|---|---|---|---|---|---|
| Mestre Álvaro | 19 | 0 | 9 | 5 | 10 |
| Metrópole Ananindeua | 17 | 0 | 9 | 5 | 9 |
| Moxuara | 17 | 0 | 10 | 5 | 8 |
| Rio Poty | 17 | 0 | 8 | 6 | 9 |
| Shopping da Ilha | 17 | 0 | 8 | 6 | 9 |
| **Total** | **87** | **0** | **42** | **28** | **45** |

> **No rule is in sync with Mont Serrat.** All 42 matches have at least one divergence.

---

## Rules exclusive to Mont Serrat (✗ NO MATCH across all targets)

These rules exist in Mont Serrat but have **no equivalent** in any of the 5 target customers:

| Rule | Present in |
|---|---|
| Elevador Parado Teste ( Segunda - Domingo) | none |
| RoofTop Desligado (Dom) | none |
| RoofTopDesligado (Seg-Sab) | none |
| RoofTopLigado Fora do Horário( Seg - Dom) | none |
| Elevador parado (domingo) | Metrópole Ananindeua, Rio Poty, Shopping da Ilha only |

---

## Mestre Álvaro (19 rules — 9 diverge, 5 no match, 10 orphan)

### ≠ Divergences

| Rule | Field | Target value | Mont Serrat value |
|---|---|---|---|
| Consumo Geral Alto Fora do Horário. (Dom) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Consumo Geral Alto Fora do Horário. (Seg-Dom) | value | 500 | **140** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Consumo Geral Alto Fora do Horário. (Seg-Sab) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Dispositivo Offline - Mestre Álvaro (Central 1) | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Elevador parado (seg-sáb) | value | 300 | **400** |
| | aggregation | SUM | **AVG** |
| | duration | 3600000 | **1800000** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Escada Rolante Ligada Fora do Horário(Seg - Dom) | value | 400 | **350** |
| | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Escada Rolante parada (domingo) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Escada Rolante parada (seg-sáb) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Mestre Álvaro"` |
| Temperatura Crítica( 12:00 - 22:00) | description | sem sufixo | `+ " — Mestre Álvaro"` |

### ✗ No Match (não existe em Mestre Álvaro)
- Elevador parado (domingo)
- Elevador Parado Teste ( Segunda - Domingo)
- RoofTop Desligado (Dom)
- RoofTopDesligado (Seg-Sab)
- RoofTopLigado Fora do Horário( Seg - Dom)

### + Orphan (exclusivas de Mestre Álvaro)
- Chiller Desligado MA (10:00 - 17:30)
- Chiller Ligado MA Fora do Horário Diurno( 06:00 - 10:00)
- Chiller Ligado MA Fora do Horário Noturno( 18:00 - 22:00)
- Consumo de água indevido
- Dispositivo Offline - Mestre Álvaro (Central 2)
- Dispositivo Offline - Mestre Álvaro (Central 3)
- Elevador parado MA(domingo)
- Fancoil Desligado (Dom)
- Fancoil Desligado (Seg-Sab)
- Fancoil Ligado Fora do Horário( Seg - Dom)

---

## Metrópole Ananindeua (17 rules — 9 diverge, 5 no match, 9 orphan)

### ≠ Divergences

| Rule | Field | Target value | Mont Serrat value |
|---|---|---|---|
| Consumo Geral Alto Fora do Horário. (Dom) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Consumo Geral Alto Fora do Horário. (Seg-Dom) | value | 500 | **140** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Consumo Geral Alto Fora do Horário. (Seg-Sab) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Dispositivo Offline - Metrópole Ananindeua | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Elevador parado (domingo) | value | 300 | **400** |
| | aggregation | SUM | **LAST** |
| | duration | 3600000 | **0** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Elevador parado (seg-sáb) | value | 300 | **400** |
| | aggregation | SUM | **AVG** |
| | duration | 3600000 | **1800000** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Escada Rolante parada (domingo) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Escada Rolante parada (seg-sáb) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Metrópole Ananindeua"` |
| Temperatura Crítica( 12:00 - 22:00) | — | — | **não existe** |

### ✗ No Match (não existe em Metrópole Ananindeua)
- Elevador Parado Teste ( Segunda - Domingo)
- Escada Rolante Ligada Fora do Horário(Seg - Dom)
- RoofTop Desligado (Dom)
- RoofTopDesligado (Seg-Sab)
- RoofTopLigado Fora do Horário( Seg - Dom)
- Temperatura Crítica( 12:00 - 22:00)

### + Orphan (exclusivas de Metrópole Ananindeua)
- Chiller Desligado (Todos os dias) (10:00 - 17:30) Ananindeua
- Chiller Ligado Ananindeua Fora do Horário Diurno( 06:00 - 10:00)
- Chiller Ligado Ananindeua Fora do Horário Noturno (18:00 - 22:00)
- Consumo de água indevido - Ananindeua
- Escada Rolante Ligada Fora do Horário (Seg - Dom) - Ananindeua
- Fancoil Desligado (Dom)
- Fancoil Desligado (Seg-Sab) - Ananindeua
- Fancoil Ligado Fora do Horário (Seg - Dom) - Ananindeua
- Temperatura Crítica Todos os Dias (12:00 - 22:00) - Ananindeua

---

## Moxuara (17 rules — 10 diverge, 5 no match, 8 orphan)

### ≠ Divergences

| Rule | Field | Target value | Mont Serrat value |
|---|---|---|---|
| Consumo Geral Alto Fora do Horário. (Dom) | value | 500 | **160** |
| | aggregation | AVG | **LAST** |
| | duration | 300000 | **0** |
| | description | sem sufixo | `+ " — Moxuara"` |
| Consumo Geral Alto Fora do Horário. (Seg-Dom) | value | 500 | **160** |
| | aggregation | AVG | **LAST** |
| | duration | 300000 | **0** |
| | description | sem sufixo | `+ " — Moxuara"` |
| Consumo Geral Alto Fora do Horário. (Seg-Sab) | value | 500 | **160** |
| | aggregation | AVG | **LAST** |
| | duration | 300000 | **0** |
| | description | sem sufixo | `+ " — Moxuara"` |
| Dispositivo Offline - Moxuara | description | sem sufixo | `+ " — Moxuara"` |
| Elevador parado (seg-sáb) | value | 300 | **400** |
| | aggregation | SUM | **AVG** |
| | duration | 3600000 | **1800000** |
| | description | sem sufixo | `+ " — Moxuara"` |
| Escada Rolante Ligada Fora do Horário(Seg - Dom) | description | sem sufixo | `+ " — Moxuara"` |
| Escada Rolante parada (domingo) | description | sem sufixo | `+ " — Moxuara"` |
| Escada Rolante parada (seg-sáb) | description | sem sufixo | `+ " — Moxuara"` |
| Temperatura Crítica( 12:00 - 22:00) | description | sem sufixo | `+ " — Moxuara"` |

### ✗ No Match (não existe em Moxuara)
- Elevador parado (domingo)
- Elevador Parado Teste ( Segunda - Domingo)
- RoofTop Desligado (Dom)
- RoofTopDesligado (Seg-Sab)
- RoofTopLigado Fora do Horário( Seg - Dom)

### + Orphan (exclusivas de Moxuara)
- Chiller Desligado (10:00 - 17:30)
- Chiller Ligado Fora do Horário Diurno( 06:00 - 10:00)
- Chiller Ligado Fora do Horário Noturno( 18:00 - 22:00)
- Elevador parado MA(domingo)
- Fancoil Desligado (Dom)
- Fancoil Desligado (Seg-Sab)
- Fancoil Ligado Fora do Horário( Seg - Dom)
- Sem leitura de entrada água por 1 hora de 08h as 22h

---

## Rio Poty (17 rules — 8 diverge, 6 no match, 9 orphan)

### ≠ Divergences

| Rule | Field | Target value | Mont Serrat value |
|---|---|---|---|
| Consumo Geral Alto Fora do Horário. (Dom) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Rio Poty"` |
| Consumo Geral Alto Fora do Horário. (Seg-Dom) | value | 500 | **140** |
| | description | sem sufixo | `+ " — Rio Poty"` |
| Consumo Geral Alto Fora do Horário. (Seg-Sab) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Rio Poty"` |
| Dispositivo Offline - Rio Poty | description | sem sufixo | `+ " — Rio Poty"` |
| Elevador parado (domingo) | value | 300 | **400** |
| | aggregation | SUM | **LAST** |
| | duration | 3600000 | **0** |
| | description | sem sufixo | `+ " — Rio Poty"` |
| Elevador parado (seg-sáb) | value | 300 | **400** |
| | aggregation | SUM | **AVG** |
| | duration | 3600000 | **1800000** |
| | description | sem sufixo | `+ " — Rio Poty"` |
| Escada Rolante parada (domingo) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Rio Poty"` |
| Escada Rolante parada (seg-sáb) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Rio Poty"` |

### ✗ No Match (não existe em Rio Poty)
- Elevador Parado Teste ( Segunda - Domingo)
- Escada Rolante Ligada Fora do Horário(Seg - Dom)
- RoofTop Desligado (Dom)
- RoofTopDesligado (Seg-Sab)
- RoofTopLigado Fora do Horário( Seg - Dom)
- Temperatura Crítica( 12:00 - 22:00)

### + Orphan (exclusivas de Rio Poty)
- Chiller Desligado Rio Poty (10:00 - 17:30)
- Chiller Ligado Rio Poty Fora do Horário Diurno( 06:00 - 10:00)
- Chiller Ligado Rio Poty Fora do Horário Noturno (18:00 - 22:00)
- Consumo de água indevido - Rio poty
- Escada Rolante Ligada Fora do Horário (Seg - Dom) - Rio Poty
- Fancoil Desligado (Dom)
- Fancoil Desligado (Seg-Sab) - Rio Poty
- Fancoil Ligado Fora do Horário (Seg - Dom) - Rio Poty
- Temperatura Crítica Todos os Dias (12:00 - 22:00) - Ananindeua ⚠️ *(nome provavelmente errado)*

---

## Shopping da Ilha (17 rules — 8 diverge, 6 no match, 9 orphan)

### ≠ Divergences

| Rule | Field | Target value | Mont Serrat value |
|---|---|---|---|
| Consumo Geral Alto Fora do Horário. (Dom) | value | 500 | **115** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Consumo Geral Alto Fora do Horário. (Seg-Dom) | value | 500 | **140** |
| | aggregation | null | **AVG** |
| | duration | null | **300000** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Consumo Geral Alto Fora do Horário. (Seg-Sab) | value | 500 | **115** |
| | aggregation | null | **AVG** |
| | duration | null | **300000** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Dispositivo Offline - Shopping da Ilha | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Elevador parado (domingo) | value | 300 | **400** |
| | aggregation | null | **SUM** |
| | duration | null | **3600000** |
| | startAt | 12:00 | **11:00** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Elevador parado (seg-sáb) | value | 300 | **400** |
| | aggregation | SUM | **AVG** |
| | duration | 3600000 | **300000** |
| | startAt | 10:00 | **08:00** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Escada Rolante parada (domingo) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |
| Escada Rolante parada (seg-sáb) | aggregation | LAST | **AVG** |
| | description | sem sufixo | `+ " — Shopping da Ilha"` |

### ✗ No Match (não existe em Shopping da Ilha)
- Elevador Parado Teste ( Segunda - Domingo)
- Escada Rolante Ligada Fora do Horário(Seg - Dom)
- RoofTop Desligado (Dom)
- RoofTopDesligado (Seg-Sab)
- RoofTopLigado Fora do Horário( Seg - Dom)
- Temperatura Crítica( 12:00 - 22:00)

### + Orphan (exclusivas de Shopping da Ilha)
- Chiller Desligado (Todos os dias) (10:00 - 17:30)
- Chiller Ligado Shopping da Ilha Fora do Horário Diurno( 06:00 - 10:00)
- Chiller Ligado Shopping da Ilha Fora do Horário Noturno (18:00 - 22:00)
- Consumo de água indevido - Shopping da Ilha
- Escada Rolante Ligada Fora do Horário (Seg - Dom) - Shopping da Ilha
- Fancoil Desligado (Dom)
- Fancoil Desligado (Seg-Sab) - Shopping da Ilha
- Fancoil Ligado Fora do Horário (Seg - Dom) - Shopping da Ilha
- Temperatura Crítica Todos os Dias (12:00 - 22:00) - Shopping da Ilha

---

## Observations & Action Items

### 1. Description suffix — fácil de aplicar (42 rules)
Todas as 42 divergências incluem o campo `description` sem o sufixo `" — <Customer>"`. Esse é o único campo candidato a sync automático sem risco de impacto operacional.

### 2. value (Consumo Geral) — diferenças intencionais
Os thresholds de potência variam por shopping:
- Mont Serrat: 115 KW (Dom/Seg-Sab), 140 KW (Seg-Dom)
- Demais: 500 KW — provavelmente valores placeholder ou corretos para cada shopping

**Não sincronizar automaticamente.**

### 3. aggregation / duration (Elevador / Escada) — divergências sistemáticas
- Mont Serrat usa `AVG` com durações menores (1800000ms = 30min)
- Outros usam `SUM` ou `LAST` com 3600000ms = 60min

Isso sugere que Mont Serrat foi atualizado com uma lógica mais refinada e os outros ainda estão com valores antigos. **Candidato a sync se confirmado.**

### 4. aggregation / duration nulos (Shopping da Ilha — Consumo Geral)
Shopping da Ilha tem `aggregation: null` e `duration: null` em 2 rules de Consumo Geral. Esses campos precisam ser preenchidos independentemente do sync.

### 5. startAt divergente (Shopping da Ilha — Elevadores)
Shopping da Ilha tem `startAt` diferente do Mont Serrat:
- Elevador (domingo): 12:00 vs 11:00
- Elevador (seg-sáb): 10:00 vs 08:00
Essas diferenças podem ser **intencionais** (horários de funcionamento distintos).

### 6. RoofTop rules — ausentes em todos os outros
As 3 rules de RoofTop existem **somente** em Mont Serrat. Não há equivalentes nos 5 customers-alvo. Provável equipamento exclusivo do Mont Serrat.

### 7. Elevador Parado Teste — ausente em todos
Rule de teste no Mont Serrat, não replicar.

### 8. Rio Poty — nome de orphan suspeito
"Temperatura Crítica Todos os Dias (12:00 - 22:00) - **Ananindeua**" existe em Rio Poty mas tem o nome de outro shopping. Verificar se é erro de nomenclatura.
