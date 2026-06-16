// Smoke for the 3 existence-check service paths (customer code / asset code /
// device name) against the local DB. Run:
//   tsx --env-file=.env scripts/dev/smoke-exists-checks.ts
import { customerService } from '../../src/services/CustomerService';
import { assetService } from '../../src/services/AssetService';
import { deviceService } from '../../src/services/DeviceService';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CUSTOMER = '77777777-7777-7777-7777-777777777777';

async function main() {
  const cHit = await customerService.codeExists(TENANT, 'DIMENSION');
  const cMiss = await customerService.codeExists(TENANT, 'NAO-EXISTE-XYZ');
  console.log('customer DIMENSION   ->', cHit, '(expect exists:true)');
  console.log('customer NAO-EXISTE  ->', cMiss, '(expect exists:false)');

  const aHit = await assetService.codeExists(TENANT, CUSTOMER, 'DIM-MAIN');
  const aMiss = await assetService.codeExists(TENANT, CUSTOMER, 'DIM-NOPE');
  console.log('asset DIM-MAIN       ->', aHit, '(expect exists:true)');
  console.log('asset DIM-NOPE       ->', aMiss, '(expect exists:false)');

  const dHit = await deviceService.existsByName(TENANT, 'Energy Laboratório', { customerIds: [CUSTOMER] });
  const dCase = await deviceService.existsByName(TENANT, 'energy laboratório', { customerIds: [CUSTOMER], caseSensitive: false });
  const dMiss = await deviceService.existsByName(TENANT, 'Dispositivo Inexistente', { customerIds: [CUSTOMER] });
  console.log('device exact         ->', dHit, '(expect exists:true)');
  console.log('device case-insens   ->', dCase, '(expect exists:true)');
  console.log('device miss          ->', dMiss, '(expect exists:false)');

  const ok =
    cHit.exists && !cMiss.exists &&
    aHit.exists && !aMiss.exists &&
    dHit.exists && dCase.exists && !dMiss.exists;
  console.log(ok ? '\nOK — all checks behaved as expected' : '\nFAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(1); });
