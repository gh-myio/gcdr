# Resposta ao Feedback do RFC-0008 (Device Attributes Extension)

Data: 2026-01-23
Arquivo revisado: `docs/RFC-0008-Device-Attributes-Extension-feedback.md`

## Resumo Executivo

| Categoria | Total | Aceitos | Parciais | Rejeitados |
|-----------|-------|---------|----------|------------|
| Pontos Criticos | 3 | 3 | 0 | 0 |
| Pontos Importantes | 4 | 4 | 0 | 0 |
| Pontos Validos | 3 | 3 | 0 | 0 |
| Sugestoes | 4 | 4 | 0 | 0 |

**Veredito**: Feedback 100% valido e construtivo. Todas as sugestoes serao incorporadas ao RFC.

---

## Respostas aos Pontos Criticos

### 1. Codificacao UTF-8

**Feedback**: Arquivo mostra caracteres quebrados (acentos). Recomendo salvar em UTF-8 sem BOM.

**Resposta**: **Aceito**. O arquivo sera reescrito em UTF-8 sem BOM, removendo acentos problematicos ou usando caracteres ASCII-safe.

**Acao**: Reescrever RFC-0008 com codificacao correta.

---

### 2. Unicidade/Escopo Multi-tenant

**Feedback**: Nao esta definido se `identifier` deve ser unico por tenant nem se `slave_id` deve ser unico por `central_id`.

**Resposta**: **Aceito**. Constraints de unicidade serao adicionados:

```sql
-- identifier unico por tenant
ALTER TABLE devices
  ADD CONSTRAINT devices_tenant_identifier_unique
  UNIQUE (tenant_id, identifier);

-- slave_id unico por central (dentro do tenant)
ALTER TABLE devices
  ADD CONSTRAINT devices_tenant_central_slave_unique
  UNIQUE (tenant_id, central_id, slave_id);
```

**Justificativa**:
- `identifier` e uma chave logica de negocio (ex: "ENTRADA_SHOPPING_GARAGEM_L2") e deve ser unica por tenant
- `slave_id` Modbus deve ser unico dentro de uma central, pois dois devices na mesma central nao podem ter o mesmo slave ID

**Acao**: Adicionar constraints no RFC e na migration.

---

### 3. Indices Fora do Escopo do Tenant

**Feedback**: `devices_ingestion_id_idx` e `devices_ingestion_gateway_id_idx` estao sem `tenant_id`. Pode degradar performance e facilitar scans cross-tenant.

**Resposta**: **Aceito**. Os indices serao ajustados para incluir `tenant_id`:

```sql
-- Antes (problematico)
CREATE INDEX devices_ingestion_id_idx ON devices(ingestion_id);
CREATE INDEX devices_ingestion_gateway_id_idx ON devices(ingestion_gateway_id);

-- Depois (corrigido)
CREATE INDEX devices_ingestion_id_idx ON devices(tenant_id, ingestion_id)
  WHERE ingestion_id IS NOT NULL;
CREATE INDEX devices_ingestion_gateway_id_idx ON devices(tenant_id, ingestion_gateway_id)
  WHERE ingestion_gateway_id IS NOT NULL;
```

**Justificativa**: Em ambiente multi-tenant, todos os indices devem comecar com `tenant_id` para:
1. Evitar full table scans cross-tenant
2. Garantir isolamento de dados
3. Otimizar queries que sempre filtram por tenant

**Acao**: Corrigir indices no RFC e na migration.

---

## Respostas aos Pontos Importantes

### 4. Inconsistencia de Tipo (SMALLINT vs INTEGER)

**Feedback**: `slave_id` aparece como SMALLINT na migration, mas `integer('slave_id')` no schema Drizzle.

**Resposta**: **Aceito**. Sera padronizado para `smallint` no Drizzle:

```typescript
// Antes
slaveId: integer('slave_id'),

// Depois
slaveId: smallint('slave_id'),
```

**Justificativa**: Modbus slave ID vai de 1-247, SMALLINT (2 bytes, -32768 a 32767) e suficiente e mais eficiente que INTEGER (4 bytes).

**Acao**: Atualizar schema Drizzle para usar `smallint`.

---

### 5. Duplicidade Conceitual (type vs device_type)

**Feedback**: `type` (enum) vs `device_type` (string livre). Falta regra clara de quando usar cada um.

**Resposta**: **Aceito**. Serao documentadas as regras:

| Campo | Tipo | Proposito | Exemplo |
|-------|------|-----------|---------|
| `type` | ENUM | Categoria tecnica padronizada do GCDR | `SENSOR`, `METER`, `ACTUATOR`, `GATEWAY` |
| `device_type` | VARCHAR | Subtipo especifico do negocio/integracao | `3F_MEDIDOR`, `SENSOR_TEMP_HUMIDITY`, `HIDROMETRO_PULSE` |

**Regras**:
1. `type` e obrigatorio e define comportamento no sistema (ex: sensores tem telemetria, atuadores tem comandos)
2. `device_type` e opcional e define o modelo/subtipo especifico para fins de dashboard/relatorios
3. Nao ha sincronizacao automatica entre eles
4. `type` e controlado pelo GCDR, `device_type` e livre para integradores definirem

**Acao**: Adicionar secao "Semantica dos Campos" no RFC.

---

### 6. Atualizacao de last_activity_time/last_alarm_time

**Feedback**: Nao esta definido quem atualiza nem frequencia.

**Resposta**: **Aceito**. Serao documentadas as regras de atualizacao:

| Campo | Quem Atualiza | Quando | Frequencia |
|-------|---------------|--------|------------|
| `last_activity_time` | Servico de Ingestao | Ao receber telemetria valida | A cada mensagem (debounce 1min recomendado) |
| `last_alarm_time` | Servico de Alarmes | Ao disparar alarme para o device | A cada alarme |

**Endpoints de atualizacao**:
```typescript
// PATCH /devices/:id/activity - chamado pelo servico de ingestao
updateLastActivityTime(tenantId: string, id: string): Promise<Device>;

// PATCH /devices/:id/alarm - chamado pelo servico de alarmes
updateLastAlarmTime(tenantId: string, id: string): Promise<Device>;
```

**Consideracoes de performance**:
- Recomenda-se debounce de 1 minuto para `last_activity_time` em devices com alta frequencia de telemetria
- Updates sao feitos via query direta sem carregar a entidade completa

**Acao**: Adicionar secao "Regras de Atualizacao de Timestamps" no RFC.

---

### 7. Indice Faltante para last_alarm_time

**Feedback**: `last_alarm_time` nao tem indice; se houver queries por alarme recente, deve ter indice composto por tenant.

**Resposta**: **Aceito**. Sera adicionado indice:

```sql
CREATE INDEX devices_last_alarm_time_idx ON devices(tenant_id, last_alarm_time)
  WHERE last_alarm_time IS NOT NULL;
```

**Casos de uso**:
- Dashboard: "Devices com alarme nas ultimas 24h"
- Relatorio: "Devices com mais alarmes no periodo"

**Acao**: Adicionar indice no RFC e na migration.

---

## Respostas aos Pontos Validos

### 8. Validacao de Limites em Campos JSONB

**Feedback**: `addrLow/addrHigh/frequency` precisam de validacao no service/DTO.

**Resposta**: **Aceito**. Serao adicionadas validacoes no DTO:

```typescript
// src/dto/request/DeviceDTO.ts
const deviceSpecsSchema = z.object({
  addrLow: z.number().int().min(0).max(65535).optional(),
  addrHigh: z.number().int().min(0).max(65535).optional(),
  frequency: z.number().int().min(1).max(3600).optional(),
  // ...
}).refine(
  (data) => !data.addrLow || !data.addrHigh || data.addrLow <= data.addrHigh,
  { message: 'addrLow must be less than or equal to addrHigh' }
);
```

**Limites definidos**:
| Campo | Tipo | Min | Max | Descricao |
|-------|------|-----|-----|-----------|
| `addrLow` | int | 0 | 65535 | Endereco Modbus (16-bit) |
| `addrHigh` | int | 0 | 65535 | Endereco Modbus (16-bit) |
| `frequency` | int | 1 | 3600 | Polling em segundos (1s a 1h) |

**Acao**: Adicionar validacoes no DTO e documentar limites no RFC.

---

### 9. Limites de Tamanho para JSONB Complexos

**Feedback**: Definir tamanho maximo para `mapInstantaneousPower`/`logAnnotations`.

**Resposta**: **Aceito**. Serao definidos limites:

| Campo | Limite | Politica |
|-------|--------|----------|
| `mapInstantaneousPower` | 100KB | Rejeitar se exceder |
| `logAnnotations.entries` | 100 entradas | FIFO (remove mais antigas) |
| `logAnnotations` total | 50KB | Rejeitar se exceder |

**Implementacao**:
```typescript
const SPECS_LIMITS = {
  mapInstantaneousPower: { maxSizeBytes: 100 * 1024 },
  logAnnotations: { maxEntries: 100, maxSizeBytes: 50 * 1024 },
};

// Validacao no service
if (JSON.stringify(specs.mapInstantaneousPower).length > SPECS_LIMITS.mapInstantaneousPower.maxSizeBytes) {
  throw new ValidationError('mapInstantaneousPower exceeds 100KB limit');
}
```

**Acao**: Adicionar secao "Limites de Payload" no RFC.

---

### 10. Seeds e Testes

**Feedback**: Atualizar seeds e testes e explicitar cobertura minima.

**Resposta**: **Aceito**. Ja estava previsto nas Fases 5 e 6, mas sera reforçado:

**Cobertura minima exigida**:
| Componente | Cobertura |
|------------|-----------|
| DeviceRepository (novos metodos) | 90% |
| DeviceService (novos metodos) | 85% |
| DTOs (validacao) | 100% |

**Cenarios de teste obrigatorios**:
- [ ] Criar device com todos os novos campos
- [ ] Atualizar device com novos campos
- [ ] Filtrar por `deviceProfile`, `deviceType`, `centralId`
- [ ] `findInactive()` com diferentes thresholds
- [ ] Validacao de `slave_id` fora do range (1-247)
- [ ] Validacao de `addrLow > addrHigh`
- [ ] Rejeicao de `mapInstantaneousPower` > 100KB

**Acao**: Adicionar checklist de testes obrigatorios no RFC.

---

## Respostas as Sugestoes de Ajustes

### Sugestao 1: Definir Constraints

**Status**: **Aceito** (ver resposta ao ponto #2)

### Sugestao 2: Padronizar Tipos (SMALLINT)

**Status**: **Aceito** (ver resposta ao ponto #4)

### Sugestao 3: Ajustar Indices

**Status**: **Aceito** (ver respostas aos pontos #3 e #7)

### Sugestao 4: Explicitar Regras de Negocio

**Status**: **Aceito** (ver respostas aos pontos #5 e #6)

---

## Acoes Consolidadas

| # | Acao | Prioridade | Secao RFC |
|---|------|------------|-----------|
| 1 | Reescrever RFC em UTF-8 | Alta | Todo o arquivo |
| 2 | Adicionar constraint `UNIQUE (tenant_id, identifier)` | Alta | Schema/Migration |
| 3 | Adicionar constraint `UNIQUE (tenant_id, central_id, slave_id)` | Alta | Schema/Migration |
| 4 | Corrigir indices para incluir `tenant_id` | Alta | Schema/Migration |
| 5 | Usar `smallint` para `slave_id` no Drizzle | Media | Schema |
| 6 | Adicionar indice para `last_alarm_time` | Media | Schema/Migration |
| 7 | Documentar semantica de `type` vs `device_type` | Media | Guide-level |
| 8 | Documentar regras de atualizacao de timestamps | Media | Reference-level |
| 9 | Adicionar validacoes de limites nos DTOs | Media | DTOs |
| 10 | Definir limites de tamanho para JSONB | Media | Reference-level |
| 11 | Adicionar checklist de testes obrigatorios | Baixa | Implementation Plan |

---

## Proximos Passos

1. Incorporar todas as acoes no RFC-0008
2. Submeter RFC atualizado para nova revisao
3. Apos aprovacao, iniciar implementacao

---

## Agradecimentos

Feedback valioso que melhorou significativamente a qualidade do RFC. Os pontos levantados sobre multi-tenancy, consistencia de tipos e regras de negocio sao fundamentais para uma implementacao robusta.
