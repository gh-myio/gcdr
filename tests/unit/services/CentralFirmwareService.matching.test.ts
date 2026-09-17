import {
  menderMacOf,
  boardsForCentral,
  primaryOf,
} from '../../../src/services/CentralFirmwareService';
import { MenderDevice } from '../../../src/services/MenderService';

/**
 * Matching a gcdr central to a board in Mender.
 *
 * Getting this wrong does not produce an error -- it produces an update aimed at
 * somebody else's site. So the cases that matter most here are the ones where the
 * answer is "I do not know", and the test is that we say so instead of guessing.
 */

function dev(over: Partial<MenderDevice> = {}): MenderDevice {
  return {
    id: 'd1',
    mac: '02:42:2e:7a:14:18',
    status: 'accepted',
    artifactName: 'rc12.4.2',
    deviceType: 'orange-pi-zero',
    centralUuid: null,
    haRole: null,
    haSlot: null,
    haGeneration: null,
    boardId: null,
    menderClientVersion: '2.6.1',
    ...over,
  };
}

const CENTRAL = 'd2031a0c-1997-4a0a-8c25-fc971ad38e5a';

describe('menderMacOf — reading the recorded mac', () => {
  it('accepts the colon form, as Mender writes it', () => {
    expect(menderMacOf({ id: 'c', name: 'x', config: { menderMac: '02:42:AE:07:43:52' } }))
      .toBe('02:42:ae:07:43:52');
  });

  it('accepts the bare form, as a central serial is written', () => {
    // A central's serial in the MyIO cloud is the mac without separators:
    // 0242873d3f8f is 02:42:87:3d:3f:8f. Both shapes turn up, so both are read.
    expect(menderMacOf({ id: 'c', name: 'x', config: { menderMac: '0242873d3f8f' } }))
      .toBe('02:42:87:3d:3f:8f');
  });

  it('refuses anything that is not a mac, rather than half-parsing it', () => {
    // The GCDR serial_number is a product label -- NH-2024-DIM-001 -- and must
    // never be mistaken for a board address.
    for (const bad of ['NH-2024-DIM-001', 'CM4-REAL-001', '', '   ', '02:42:ae', 'zz:zz:zz:zz:zz:zz']) {
      expect(menderMacOf({ id: 'c', name: 'x', config: { menderMac: bad } })).toBeNull();
    }
  });

  it('is null when nobody has recorded one', () => {
    expect(menderMacOf({ id: 'c', name: 'x', config: {} })).toBeNull();
    expect(menderMacOf({ id: 'c', name: 'x', config: null })).toBeNull();
    expect(menderMacOf({ id: 'c', name: 'x' })).toBeNull();
  });

  it('ignores a non-string value', () => {
    expect(menderMacOf({ id: 'c', name: 'x', config: { menderMac: 42 as unknown as string } })).toBeNull();
  });
});

describe('boardsForCentral — the two ways in', () => {
  it('believes the board when it publishes central_uuid', () => {
    const devices = [dev({ id: 'a', centralUuid: CENTRAL }), dev({ id: 'b', mac: 'ff:ff:ff:ff:ff:ff' })];
    const r = boardsForCentral({ id: CENTRAL, name: 'x' }, devices);
    expect(r.via).toBe('inventory');
    expect(r.matched.map((d) => d.id)).toEqual(['a']);
  });

  it('falls back to the recorded mac for the fleet', () => {
    const devices = [dev({ id: 'a', mac: '02:42:87:3d:3f:8f' })];
    const r = boardsForCentral(
      { id: CENTRAL, name: 'x', config: { menderMac: '0242873d3f8f' } },
      devices,
    );
    expect(r.via).toBe('mac');
    expect(r.matched.map((d) => d.id)).toEqual(['a']);
  });

  it('prefers the board own word over the recorded mac', () => {
    // If the two disagree, the board is right: somebody typed the mac, the board
    // read its own identity.
    const devices = [
      dev({ id: 'says-so', centralUuid: CENTRAL, mac: 'aa:aa:aa:aa:aa:aa' }),
      dev({ id: 'by-mac', mac: '02:42:87:3d:3f:8f' }),
    ];
    const r = boardsForCentral(
      { id: CENTRAL, name: 'x', config: { menderMac: '0242873d3f8f' } },
      devices,
    );
    expect(r.matched.map((d) => d.id)).toEqual(['says-so']);
  });

  it('finds nothing, and says so, when neither path works', () => {
    // 28 centrals in the MyIO cloud had no device in Mender on 2026-09-15. The
    // answer has to be empty, never "the closest one".
    const r = boardsForCentral({ id: CENTRAL, name: 'x' }, [dev({ id: 'a' })]);
    expect(r.matched).toEqual([]);
    expect(r.via).toBeNull();
  });

  it('does not match a central whose uuid merely resembles another', () => {
    const devices = [dev({ id: 'a', centralUuid: 'd2031a0c-0000-0000-0000-000000000000' })];
    expect(boardsForCentral({ id: CENTRAL, name: 'x' }, devices).matched).toEqual([]);
  });

  it('refuses a recorded mac that points at another central board', () => {
    // The failure this module exists to prevent, arriving through the back door.
    // config.menderMac is filled by reconciliation -- by a person or a script,
    // from a cadastre that can be stale. If it names a board that publishes a
    // DIFFERENT central_uuid, the board is right and the record is wrong; taking
    // the record's word aims a deploy at somebody else's site while both screens
    // look correct.
    const otherSite = dev({
      id: 'belongs-to-someone-else',
      mac: '02:42:87:3d:3f:8f',
      centralUuid: '99999999-9999-9999-9999-999999999999',
    });
    const r = boardsForCentral(
      { id: CENTRAL, name: 'central com cadastro velho', config: { menderMac: '0242873d3f8f' } },
      [otherSite],
    );
    expect(r.matched).toEqual([]);
    expect(r.via).toBeNull();
  });

  it('still accepts a mac-matched board that claims nothing', () => {
    // 227 of 232 boards on 2026-09-15 publish no central_uuid at all. A board
    // that says nothing cannot contradict the record, so it is accepted --
    // otherwise the mac path would stop working for almost the whole fleet.
    const quiet = dev({ id: 'fleet-board', mac: '02:42:87:3d:3f:8f', centralUuid: null });
    const r = boardsForCentral(
      { id: CENTRAL, name: 'x', config: { menderMac: '0242873d3f8f' } },
      [quiet],
    );
    expect(r.matched.map((d) => d.id)).toEqual(['fleet-board']);
    expect(r.via).toBe('mac');
  });

  it('accepts a mac-matched board that agrees with the record', () => {
    const agrees = dev({ id: 'ok', mac: '02:42:87:3d:3f:8f', centralUuid: CENTRAL });
    // Matched by uuid first, in fact -- but either way it must not be excluded.
    const r = boardsForCentral(
      { id: CENTRAL, name: 'x', config: { menderMac: '0242873d3f8f' } },
      [agrees],
    );
    expect(r.matched.map((d) => d.id)).toEqual(['ok']);
  });

  it('keeps the honest board and drops the impostor when both share a mac', () => {
    const impostor = dev({ id: 'impostor', mac: '02:42:87:3d:3f:8f', centralUuid: 'another-site' });
    const ours = dev({ id: 'ours', mac: '02:42:87:3d:3f:8f', centralUuid: null });
    const r = boardsForCentral(
      { id: CENTRAL, name: 'x', config: { menderMac: '0242873d3f8f' } },
      [impostor, ours],
    );
    expect(r.matched.map((d) => d.id)).toEqual(['ours']);
  });
});

describe('boardsForCentral — an HA pair is two boards under one uuid', () => {
  // This is the whole detection mechanism, and it needs nothing filled in by hand:
  // both halves publish the same central_uuid because the site identity travels
  // with the role. Verified on the bench pair on 2026-09-15.
  const teta = dev({
    id: 'teta', mac: '02:42:ae:07:43:52', centralUuid: CENTRAL,
    haRole: 'primary', haSlot: 'b', artifactName: 'rc14.1.5',
    boardId: '4201c0022046805410823079d4032c20',
  });
  const al2 = dev({
    id: 'al2', mac: '02:42:87:3d:3f:8f', centralUuid: CENTRAL,
    haRole: 'standby', haSlot: 'a', artifactName: 'rc14.1.5',
  });

  it('returns both halves', () => {
    const r = boardsForCentral({ id: CENTRAL, name: 'AL2 ITO' }, [teta, al2, dev({ id: 'other' })]);
    expect(r.matched.map((d) => d.id).sort()).toEqual(['al2', 'teta']);
  });

  it('describes the primary, because that is the board serving the site', () => {
    expect(primaryOf([al2, teta])!.id).toBe('teta');
  });

  it('still answers when no half claims to be primary', () => {
    // A pair mid-handover, or an image that does not publish ha_role. Picking
    // the first is arbitrary and safe: the pair refusal fires either way.
    const noRole = [dev({ id: 'x', haRole: null }), dev({ id: 'y', haRole: null })];
    expect(primaryOf(noRole)!.id).toBe('x');
  });

  it('answers null for a central with no board', () => {
    expect(primaryOf([])).toBeNull();
  });
});
