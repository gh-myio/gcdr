/**
 * Script de Carga de Testes - Rules
 *
 * Uso:
 *   npx ts-node scripts/load-test-rules.ts
 *
 * Ou com variáveis de ambiente:
 *   API_URL=https://... TENANT_ID=... AUTH_TOKEN=... CUSTOMER_ID=... npx ts-node scripts/load-test-rules.ts
 */

import https from 'https';
import http from 'http';

// ============================================
// CONFIGURACAO
// ============================================

const CONFIG = {
  // API Base URL
  apiUrl: process.env.API_URL || 'https://gcdr-server.apps.myio-bas.com',

  // Autenticacao
  tenantId: process.env.TENANT_ID || 'YOUR_TENANT_ID',
  authToken: process.env.AUTH_TOKEN || 'YOUR_JWT_TOKEN',

  // Customer para criar as rules
  customerId: process.env.CUSTOMER_ID || 'YOUR_CUSTOMER_ID',

  // Quantidade de rules a criar
  totalRules: parseInt(process.env.TOTAL_RULES || '50'),

  // Delay entre requisicoes (ms) para evitar throttling
  delayBetweenRequests: parseInt(process.env.DELAY_MS || '100'),

  // Concorrencia (quantas requisicoes simultaneas)
  concurrency: parseInt(process.env.CONCURRENCY || '5'),
};

// ============================================
// TIPOS
// ============================================

interface RulePayload {
  customerId: string;
  name: string;
  description?: string;
  type: 'ALARM_THRESHOLD' | 'SLA' | 'ESCALATION' | 'MAINTENANCE_WINDOW';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  scope: {
    type: 'GLOBAL' | 'CUSTOMER';
    entityId?: string;
    inherited?: boolean;
  };
  alarmConfig?: {
    metric: string;
    operator: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'NEQ' | 'BETWEEN';
    value: number;
    valueHigh?: number;
    unit?: string;
    hysteresis?: number;
    hysteresisType?: 'PERCENTAGE' | 'ABSOLUTE';
    duration?: number;
    aggregation?: 'AVG' | 'MIN' | 'MAX' | 'SUM' | 'COUNT' | 'LAST';
    aggregationWindow?: number;
  };
  tags: string[];
  enabled: boolean;
}

interface TestResult {
  ruleIndex: number;
  ruleName: string;
  success: boolean;
  statusCode?: number;
  ruleId?: string;
  error?: string;
  durationMs: number;
}

// ============================================
// GERADORES DE DADOS
// ============================================

const METRICS = [
  'temperature',
  'humidity',
  'pressure',
  'power_consumption',
  'voltage',
  'current',
  'frequency',
  'vibration',
  'noise_level',
  'co2_level',
  'pm25',
  'pm10',
  'luminosity',
  'water_flow',
  'gas_flow',
];

const UNITS = {
  temperature: 'celsius',
  humidity: 'percent',
  pressure: 'hPa',
  power_consumption: 'kWh',
  voltage: 'V',
  current: 'A',
  frequency: 'Hz',
  vibration: 'mm/s',
  noise_level: 'dB',
  co2_level: 'ppm',
  pm25: 'ug/m3',
  pm10: 'ug/m3',
  luminosity: 'lux',
  water_flow: 'L/min',
  gas_flow: 'm3/h',
};

const OPERATORS: Array<'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ' | 'BETWEEN'> = ['GT', 'GTE', 'LT', 'LTE', 'EQ', 'BETWEEN'];
const PRIORITIES: Array<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const AGGREGATIONS: Array<'AVG' | 'MIN' | 'MAX' | 'LAST'> = ['AVG', 'MIN', 'MAX', 'LAST'];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateAlarmRule(index: number): RulePayload {
  const metric = randomElement(METRICS);
  const operator = randomElement(OPERATORS);
  const priority = randomElement(PRIORITIES);
  const value = randomInt(10, 100);

  const rule: RulePayload = {
    customerId: CONFIG.customerId,
    name: `Alarme ${metric.replace('_', ' ')} #${index + 1}`,
    description: `Regra de alarme para monitoramento de ${metric} - gerada por teste de carga`,
    type: 'ALARM_THRESHOLD',
    priority,
    scope: {
      type: 'CUSTOMER',
      entityId: CONFIG.customerId,
      inherited: true,
    },
    alarmConfig: {
      metric,
      operator,
      value,
      unit: UNITS[metric as keyof typeof UNITS] || 'unit',
      hysteresis: randomInt(1, 10),
      hysteresisType: randomElement(['PERCENTAGE', 'ABSOLUTE'] as const),
      duration: randomInt(60, 600),
      aggregation: randomElement(AGGREGATIONS),
      aggregationWindow: randomInt(30, 300),
    },
    tags: [
      'load-test',
      metric,
      priority.toLowerCase(),
      `batch-${new Date().toISOString().split('T')[0]}`,
    ],
    enabled: true,
  };

  // Se operador BETWEEN, adicionar valueHigh
  if (operator === 'BETWEEN' && rule.alarmConfig) {
    rule.alarmConfig.valueHigh = value + randomInt(10, 50);
  }

  return rule;
}

// ============================================
// HTTP CLIENT
// ============================================

function makeRequest(rule: RulePayload): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${CONFIG.apiUrl}/rules`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const postData = JSON.stringify(rule);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'x-tenant-id': CONFIG.tenantId,
        'Authorization': `Bearer ${CONFIG.authToken}`,
      },
    };

    const req = client.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ============================================
// EXECUCAO
// ============================================

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createRule(index: number): Promise<TestResult> {
  const rule = generateAlarmRule(index);
  const startTime = Date.now();

  try {
    const response = await makeRequest(rule);
    const durationMs = Date.now() - startTime;

    if (response.statusCode >= 200 && response.statusCode < 300) {
      const data = JSON.parse(response.body);
      return {
        ruleIndex: index,
        ruleName: rule.name,
        success: true,
        statusCode: response.statusCode,
        ruleId: data.data?.id,
        durationMs,
      };
    } else {
      return {
        ruleIndex: index,
        ruleName: rule.name,
        success: false,
        statusCode: response.statusCode,
        error: response.body.substring(0, 200),
        durationMs,
      };
    }
  } catch (error) {
    return {
      ruleIndex: index,
      ruleName: rule.name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

async function runBatch(startIndex: number, count: number): Promise<TestResult[]> {
  const promises: Promise<TestResult>[] = [];

  for (let i = 0; i < count; i++) {
    promises.push(createRule(startIndex + i));
  }

  return Promise.all(promises);
}

async function main() {
  console.log('='.repeat(60));
  console.log('SCRIPT DE CARGA DE TESTES - RULES');
  console.log('='.repeat(60));
  console.log('');
  console.log('Configuracao:');
  console.log(`  API URL:      ${CONFIG.apiUrl}`);
  console.log(`  Tenant ID:    ${CONFIG.tenantId.substring(0, 8)}...`);
  console.log(`  Customer ID:  ${CONFIG.customerId.substring(0, 8)}...`);
  console.log(`  Total Rules:  ${CONFIG.totalRules}`);
  console.log(`  Concorrencia: ${CONFIG.concurrency}`);
  console.log(`  Delay:        ${CONFIG.delayBetweenRequests}ms`);
  console.log('');

  // Validar configuracao
  if (CONFIG.tenantId === 'YOUR_TENANT_ID' || CONFIG.authToken === 'YOUR_JWT_TOKEN') {
    console.error('ERRO: Configure as variaveis de ambiente:');
    console.error('  export API_URL="https://..."');
    console.error('  export TENANT_ID="seu-tenant-id"');
    console.error('  export AUTH_TOKEN="seu-jwt-token"');
    console.error('  export CUSTOMER_ID="seu-customer-id"');
    process.exit(1);
  }

  const results: TestResult[] = [];
  const totalStartTime = Date.now();
  let processed = 0;

  console.log('Iniciando carga...');
  console.log('');

  // Processar em batches
  for (let i = 0; i < CONFIG.totalRules; i += CONFIG.concurrency) {
    const batchSize = Math.min(CONFIG.concurrency, CONFIG.totalRules - i);
    const batchResults = await runBatch(i, batchSize);
    results.push(...batchResults);

    processed += batchSize;
    const successCount = results.filter((r) => r.success).length;
    const progress = ((processed / CONFIG.totalRules) * 100).toFixed(1);

    process.stdout.write(
      `\rProgresso: ${processed}/${CONFIG.totalRules} (${progress}%) | Sucesso: ${successCount} | Falhas: ${processed - successCount}`
    );

    // Delay entre batches
    if (i + CONFIG.concurrency < CONFIG.totalRules) {
      await sleep(CONFIG.delayBetweenRequests);
    }
  }

  const totalDuration = Date.now() - totalStartTime;

  // Relatorio final
  console.log('\n');
  console.log('='.repeat(60));
  console.log('RELATORIO FINAL');
  console.log('='.repeat(60));

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  console.log('');
  console.log(`Total de Rules:     ${CONFIG.totalRules}`);
  console.log(`Sucesso:            ${successful.length} (${((successful.length / CONFIG.totalRules) * 100).toFixed(1)}%)`);
  console.log(`Falhas:             ${failed.length} (${((failed.length / CONFIG.totalRules) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`Tempo Total:        ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`Rules/segundo:      ${(CONFIG.totalRules / (totalDuration / 1000)).toFixed(2)}`);

  if (successful.length > 0) {
    const avgDuration = successful.reduce((sum, r) => sum + r.durationMs, 0) / successful.length;
    const minDuration = Math.min(...successful.map((r) => r.durationMs));
    const maxDuration = Math.max(...successful.map((r) => r.durationMs));

    console.log('');
    console.log('Tempo de Resposta (sucesso):');
    console.log(`  Media:            ${avgDuration.toFixed(0)}ms`);
    console.log(`  Minimo:           ${minDuration}ms`);
    console.log(`  Maximo:           ${maxDuration}ms`);
  }

  if (failed.length > 0) {
    console.log('');
    console.log('Erros encontrados:');

    // Agrupar erros por tipo
    const errorGroups = failed.reduce((acc, r) => {
      const key = r.statusCode ? `HTTP ${r.statusCode}` : 'Network Error';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(errorGroups).forEach(([error, count]) => {
      console.log(`  ${error}: ${count}`);
    });

    // Mostrar primeiros 3 erros
    console.log('');
    console.log('Primeiros erros:');
    failed.slice(0, 3).forEach((r) => {
      console.log(`  [${r.ruleIndex}] ${r.ruleName}`);
      console.log(`      Status: ${r.statusCode || 'N/A'}`);
      console.log(`      Erro: ${r.error?.substring(0, 100)}...`);
    });
  }

  // Salvar resultados em arquivo
  const outputFile = `load-test-results-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      {
        config: {
          ...CONFIG,
          authToken: '***REDACTED***',
        },
        summary: {
          total: CONFIG.totalRules,
          successful: successful.length,
          failed: failed.length,
          totalDurationMs: totalDuration,
          rulesPerSecond: CONFIG.totalRules / (totalDuration / 1000),
        },
        results,
      },
      null,
      2
    )
  );

  console.log('');
  console.log(`Resultados salvos em: ${outputFile}`);
  console.log('');

  // Exit code baseado no sucesso
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('Erro fatal:', error);
  process.exit(1);
});
