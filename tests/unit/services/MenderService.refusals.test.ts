import {
  refusalsFor,
  newestFor,
  deviceFromInventory,
  artifactFromRaw,
  MenderDevice,
  MenderArtifact,
} from '../../../src/services/MenderService';

/**
 * The refusals, which are the feature.
 *
 * A button that updates a central is half an hour of work. What makes it safe to
 * hand to somebody who did not build it -- which is the whole point, because the
 * person who will use it is not the person who wrote it -- is the set of cases
 * where it refuses and says why.
 *
 * Every number quoted below was measured against the real fleet on hosted.mender
 * on 2026-09-15: 232 registered boards, 151 reporting inventory, 76 sitting in
 * `pending', one HA pair, one CM4 among orange-pi-zero artifacts.
 */

const OPI = 'orange-pi-zero';

function device(over: Partial<MenderDevice> = {}): MenderDevice {
  return {
    id: 'dev-1',
    mac: '02:42:2e:7a:14:18',
    status: 'accepted',
    artifactName: 'rc12.4.2',
    deviceType: OPI,
    centralUuid: null,
    haRole: null,
    haSlot: null,
    haGeneration: null,
    boardId: null,
    menderClientVersion: '2.6.1',
    ...over,
  };
}

function artifact(over: Partial<MenderArtifact> = {}): MenderArtifact {
  return {
    name: 'rc14.1.3',
    deviceTypesCompatible: [OPI],
    modified: '2026-09-14T01:54:19Z',
    signed: true,
    ...over,
  };
}

const codes = (r: { code: string }[]) => r.map((x) => x.code).sort();

describe('refusalsFor — the happy path exists and is narrow', () => {
  it('allows an ordinary fleet board to take the newest image', () => {
    // Campinas Hidrometros G1/G2 as it really is: rc12.4.2, accepted, standalone.
    expect(refusalsFor(device(), artifact())).toEqual([]);
  });
});

describe('refusalsFor — a central with no board behind it', () => {
  it('refuses when nothing in Mender answers to this central', () => {
    const r = refusalsFor(null, artifact());
    expect(codes(r)).toEqual(['DEVICE_NOT_FOUND']);
    expect(r[0].message).toContain('Mender');
  });
});

describe('refusalsFor — registered is not the same as updatable', () => {
  it('refuses a board still pending authorization, and says whose job that is', () => {
    // 76 of 232 boards were in this state. Campinas G0 Nova, the one from
    // ED-1231, is one of them -- which is why it could not be found in the
    // Mender device list at all.
    const r = refusalsFor(device({ status: 'pending', artifactName: null, deviceType: null }), artifact());
    expect(codes(r)).toContain('DEVICE_PENDING');
    expect(r.find((x) => x.code === 'DEVICE_PENDING')!.message).toContain('aceite');
  });

  it('refuses a board that never reported inventory', () => {
    const r = refusalsFor(device({ artifactName: null }), artifact());
    expect(codes(r)).toContain('NO_INVENTORY');
  });
});

describe('refusalsFor — the one that would brick a board', () => {
  it('refuses an orange-pi-zero artifact aimed at the CM4', () => {
    const r = refusalsFor(
      device({ deviceType: 'raspberrypi-cm4-64' }),
      artifact({ deviceTypesCompatible: [OPI] }),
    );
    expect(codes(r)).toContain('DEVICE_TYPE_MISMATCH');
    // The message has to name both sides: "incompatible" alone tells nobody
    // which half to fix.
    const m = r.find((x) => x.code === 'DEVICE_TYPE_MISMATCH')!.message;
    expect(m).toContain('raspberrypi-cm4-64');
    expect(m).toContain(OPI);
  });

  it('refuses a board that declares no device_type at all', () => {
    expect(codes(refusalsFor(device({ deviceType: null }), artifact()))).toContain('NO_DEVICE_TYPE');
  });
});

describe('refusalsFor — signature', () => {
  it('refuses an unsigned artifact', () => {
    expect(codes(refusalsFor(device(), artifact({ signed: false })))).toContain('ARTIFACT_UNSIGNED');
  });

  it('does not invent an unsigned artifact when Mender simply does not say', () => {
    // `signed' absent from the listing must not read as false: that would refuse
    // every deployment on a tenant whose plan does not expose the field.
    const a = artifactFromRaw({ id: 'x', name: 'rc14.1.3', device_types_compatible: [OPI] });
    expect(a.signed).toBe(true);
    expect(codes(refusalsFor(device(), a))).toEqual([]);
  });
});

describe('refusalsFor — work nobody needs done', () => {
  it('refuses when the board already runs the target', () => {
    const r = refusalsFor(device({ artifactName: 'rc14.1.3' }), artifact({ name: 'rc14.1.3' }));
    expect(codes(r)).toContain('ALREADY_RUNNING');
  });

  it('refuses a second deployment while one is in flight', () => {
    const r = refusalsFor(device(), artifact(), [], {
      id: 'dep-1', artifactName: 'rc14.1.1', status: 'inprogress',
      deviceStatus: 'downloading', created: null,
    });
    expect(codes(r)).toContain('DEPLOYMENT_IN_FLIGHT');
    expect(r.find((x) => x.code === 'DEPLOYMENT_IN_FLIGHT')!.message).toContain('rc14.1.1');
  });
});

describe('refusalsFor — the HA pair, which is the expensive one', () => {
  // The bench pair exactly as Mender holds it. Both halves publish the same
  // central_uuid, because the site identity travels with the role; board_id is
  // the only thing that does not move, which is why the message uses it.
  const teta = device({
    id: 'dev-teta', mac: '02:42:ae:07:43:52', boardId: '4201c0022046805410823079d4032c20',
    artifactName: 'rc14.1.5', centralUuid: 'd2031a0c-1997-4a0a-8c25-fc971ad38e5a',
    haRole: 'primary', haSlot: 'b', haGeneration: '6', menderClientVersion: '5.1.0',
  });
  const al2 = device({
    id: 'dev-al2', mac: '02:42:87:3d:3f:8f', boardId: '...1404282c',
    artifactName: 'rc14.1.5', centralUuid: 'd2031a0c-1997-4a0a-8c25-fc971ad38e5a',
    haRole: 'standby', haSlot: 'a', haGeneration: '5', menderClientVersion: '5.1.0',
  });

  it('refuses the primary outright, and names the standby as the place to start', () => {
    const r = refusalsFor(teta, artifact(), [al2]);
    expect(codes(r)).toEqual(expect.arrayContaining(['HA_PAIR', 'HA_PRIMARY_FIRST']));
    const m = r.map((x) => x.message).join(' ');
    expect(m).toContain('standby');
    expect(m).toContain('sítio sem central');
  });

  it('flags the standby as half a pair, but without the primary-only refusal', () => {
    const r = refusalsFor(al2, artifact(), [teta]);
    expect(codes(r)).toContain('HA_PAIR');
    expect(codes(r)).not.toContain('HA_PRIMARY_FIRST');
  });

  it('names the OTHER board, not this one', () => {
    // Getting this backwards is how an operator updates the wrong half.
    const r = refusalsFor(teta, artifact(), [al2]);
    const m = r.find((x) => x.code === 'HA_PAIR')!.message;
    expect(m).toContain('...1404282c');
    expect(m).not.toContain('4201c0022046805410823079d4032c20');
  });

  it('says nothing about pairs when the central is served by one board', () => {
    // A board with no ha_role has no role file, which means it is not half of a
    // pair at all. Nothing to say.
    expect(codes(refusalsFor(device(), artifact(), []))).toEqual([]);
  });

  it('refuses a board that claims a role while its other half is nowhere', () => {
    // Found by validating against the real fleet: a board published
    // ha_role=primary, ha_slot=a and the slot-a crossover address, and no second
    // board answered to its central_uuid. The pair rule is written around two
    // boards under one uuid, so it saw nothing and allowed the update.
    //
    // ha_role is only published by a board that has a role file, so its presence
    // is the board's own word that a site depends on it. Not being able to see
    // the peer is not the same as there not being one.
    const r = refusalsFor(device({ haRole: 'primary', haSlot: 'a' }), artifact(), []);
    expect(codes(r)).toContain('HA_PEER_UNKNOWN');
    const m = r.find((x) => x.code === 'HA_PEER_UNKNOWN')!.message;
    expect(m).toContain('primary');
    expect(m).toContain('slot a');
  });

  it('does not add the unknown-peer refusal once the peer IS visible', () => {
    // Otherwise a healthy pair would collect both refusals and read as twice as
    // broken as it is.
    const peer = device({ id: 'peer', haRole: 'standby' });
    const r = refusalsFor(device({ haRole: 'primary' }), artifact(), [peer]);
    expect(codes(r)).toContain('HA_PAIR');
    expect(codes(r)).not.toContain('HA_PEER_UNKNOWN');
  });
});

describe('refusalsFor — refusals accumulate', () => {
  it('reports every reason, not just the first', () => {
    // The screen has to show all of them: fixing one and finding another is how
    // a five-minute job becomes an afternoon.
    const r = refusalsFor(
      device({ status: 'pending', artifactName: null, deviceType: 'raspberrypi-cm4-64' }),
      artifact({ signed: false }),
    );
    expect(codes(r)).toEqual(expect.arrayContaining([
      'ARTIFACT_UNSIGNED', 'DEVICE_PENDING', 'DEVICE_TYPE_MISMATCH', 'NO_INVENTORY',
    ]));
  });
});

describe('newestFor — ordering', () => {
  const list: MenderArtifact[] = [
    artifact({ name: 'rc9.7.2', modified: '2025-01-02T00:00:00Z' }),
    artifact({ name: 'rc14.1.3', modified: '2026-09-14T01:54:19Z' }),
    artifact({ name: 'rc10.1', modified: '2025-06-01T00:00:00Z' }),
    artifact({ name: 'cm4-1.0.0-rc8', deviceTypesCompatible: ['raspberrypi-cm4-64'], modified: '2026-08-01T00:00:00Z' }),
  ];

  it('picks the newest by date, not by name', () => {
    // rc9.7.2 sorts after rc10.1 lexically, and that is the trap.
    expect(newestFor(OPI, list)!.name).toBe('rc14.1.3');
  });

  it('never offers an artifact for another board', () => {
    expect(newestFor('raspberrypi-cm4-64', list)!.name).toBe('cm4-1.0.0-rc8');
  });

  it('offers nothing when the board type is unknown', () => {
    expect(newestFor(null, list)).toBeNull();
  });

  it('offers nothing when no artifact fits', () => {
    expect(newestFor('some-other-board', list)).toBeNull();
  });
});

describe('deviceFromInventory — reading what the board actually sends', () => {
  it('reads the full shape an rc14.1.x board publishes', () => {
    const d = deviceFromInventory({
      id: '257e9085-55ae-42f8-9700-4e91ab3e0c38',
      attributes: [
        { name: 'mac', value: '02:42:AE:07:43:52', scope: 'identity' },
        { name: 'status', value: 'accepted', scope: 'identity' },
        { name: 'artifact_name', value: 'rc14.1.5', scope: 'inventory' },
        { name: 'device_type', value: 'orange-pi-zero', scope: 'inventory' },
        { name: 'central_uuid', value: 'd2031a0c-1997-4a0a-8c25-fc971ad38e5a', scope: 'inventory' },
        { name: 'central_serial', value: '0242873d3f8f', scope: 'inventory' },
        { name: 'board_id', value: '4201c0022046805410823079d4032c20', scope: 'inventory' },
        { name: 'ha_role', value: 'primary', scope: 'inventory' },
        { name: 'ha_slot', value: 'b', scope: 'inventory' },
        { name: 'ha_generation', value: '6', scope: 'inventory' },
        { name: 'mender_client_version', value: '5.1.0', scope: 'inventory' },
      ],
    });
    expect(d.mac).toBe('02:42:ae:07:43:52');
    expect(d.artifactName).toBe('rc14.1.5');
    expect(d.haRole).toBe('primary');
    expect(d.boardId).toBe('4201c0022046805410823079d4032c20');
  });

  it('survives a board that reports almost nothing', () => {
    // Campinas G0 Nova: pending, three attributes, no inventory at all.
    const d = deviceFromInventory({
      id: '429d09ee-9697-4cdd-99b6-a9978a2d3705',
      attributes: [
        { name: 'mac', value: '02:42:af:fc:bb:a0', scope: 'identity' },
        { name: 'status', value: 'pending', scope: 'identity' },
        { name: 'created_ts', value: '2025-07-25T13:33:17.735Z', scope: 'system' },
      ],
    });
    expect(d.artifactName).toBeNull();
    expect(d.deviceType).toBeNull();
    expect(d.status).toBe('pending');
    expect(codes(refusalsFor(d, artifact()))).toEqual(
      expect.arrayContaining(['DEVICE_PENDING', 'NO_INVENTORY', 'NO_DEVICE_TYPE']),
    );
  });

  it('takes the first value when Mender reports device_type as a list', () => {
    // One board in the fleet reports ["raspberrypi-cm4-64","raspberrypi-cm4-64"].
    const d = deviceFromInventory({
      id: 'x',
      attributes: [{ name: 'device_type', value: ['raspberrypi-cm4-64', 'raspberrypi-cm4-64'] }],
    });
    expect(d.deviceType).toBe('raspberrypi-cm4-64');
  });

  it('survives a device with no attributes at all', () => {
    const d = deviceFromInventory({ id: 'x' });
    expect(d.mac).toBe('');
    expect(d.artifactName).toBeNull();
  });
});
