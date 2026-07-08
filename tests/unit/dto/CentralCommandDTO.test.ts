import {
  CreateCommandSchema,
  UpdateCommandResultSchema,
} from '../../../src/dto/request/CentralCommandDTO';

describe('CentralCommandDTO', () => {
  describe('CreateCommandSchema', () => {
    it('accepts the valid command types', () => {
      expect(CreateCommandSchema.parse({ type: 'REBOOT' }).type).toBe('REBOOT');
      expect(CreateCommandSchema.parse({ type: 'RESTART_ERLANG' }).type).toBe('RESTART_ERLANG');
      expect(CreateCommandSchema.parse({ type: 'RESTART_MYIOAPI' }).type).toBe('RESTART_MYIOAPI');
    });

    it('rejects an unknown type', () => {
      expect(() => CreateCommandSchema.parse({ type: 'NUKE' })).toThrow();
    });

    it('requires type', () => {
      expect(() => CreateCommandSchema.parse({})).toThrow();
    });

    it('accepts SET_WIFI with a valid payload', () => {
      const r = CreateCommandSchema.parse({
        type: 'SET_WIFI',
        payload: { ssid: 'test-ssid', password: 'test-password-123', country: 'BR' },
      });
      expect(r.type).toBe('SET_WIFI');
      expect(r.payload?.ssid).toBe('test-ssid');
    });

    it('rejects SET_WIFI without a payload', () => {
      expect(() => CreateCommandSchema.parse({ type: 'SET_WIFI' })).toThrow();
    });

    it('rejects SET_WIFI with a too-short password', () => {
      expect(() =>
        CreateCommandSchema.parse({ type: 'SET_WIFI', payload: { ssid: 'net', password: 'short' } }),
      ).toThrow();
    });
  });

  describe('UpdateCommandResultSchema', () => {
    it('accepts a full result', () => {
      const r = UpdateCommandResultSchema.parse({ status: 'DONE', exitCode: 0, stdout: 'ok', stderr: '' });
      expect(r.status).toBe('DONE');
      expect(r.exitCode).toBe(0);
    });

    it('accepts exitCode 0 alone (present-but-falsy is valid)', () => {
      expect(UpdateCommandResultSchema.parse({ exitCode: 0 }).exitCode).toBe(0);
    });

    it('rejects an empty patch', () => {
      expect(() => UpdateCommandResultSchema.parse({})).toThrow();
    });

    it('rejects an unknown status', () => {
      expect(() => UpdateCommandResultSchema.parse({ status: 'WAT' })).toThrow();
    });
  });
});
