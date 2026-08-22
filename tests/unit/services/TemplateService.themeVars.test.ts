import { resolveThemeVars } from '../../../src/services/TemplateService';

// Minimal theme — only the fields buildThemeVarMap reads. Cast to the expected
// parameter type to avoid constructing a full LookAndFeel.
const theme = {
  id: 't1',
  colors: {
    primary: '#0D47A1',
    warning: '#E65100',
    secondary: '#00B8D4',
    surfaceVariant: '#EFF3FB',
  },
  typography: { fontFamily: 'Inter, sans-serif' },
  logo: {},
} as unknown as Parameters<typeof resolveThemeVars>[1];

describe('resolveThemeVars — email-safe theming (var → literal)', () => {
  it('replaces var(--color-x, fallback) with the theme literal', () => {
    expect(resolveThemeVars('a{background:var(--color-primary,#000)}', theme)).toBe(
      'a{background:#0D47A1}',
    );
  });

  it('accepts a space after the comma', () => {
    expect(resolveThemeVars('a{background:var(--color-primary, #000)}', theme)).toBe(
      'a{background:#0D47A1}',
    );
  });

  it('maps kebab --color-surface-variant from the camelCase theme key', () => {
    expect(resolveThemeVars('b{background:var(--color-surface-variant,#fff)}', theme)).toBe(
      'b{background:#EFF3FB}',
    );
  });

  it('uses the declared fallback when the var is not in the theme', () => {
    expect(resolveThemeVars('c{color:var(--color-unknown,#abcabc)}', theme)).toBe(
      'c{color:#abcabc}',
    );
  });

  it('resolves a bare var() (no fallback) when mapped, leaves it when unmapped', () => {
    expect(resolveThemeVars('d{color:var(--color-warning)}', theme)).toBe('d{color:#E65100}');
    expect(resolveThemeVars('e{color:var(--color-nope)}', theme)).toBe('e{color:var(--color-nope)}');
  });

  it('replaces every occurrence', () => {
    const out = resolveThemeVars(
      '.h{background:var(--color-primary,#1)} .t{background:var(--color-secondary,#2)}',
      theme,
    );
    expect(out).toBe('.h{background:#0D47A1} .t{background:#00B8D4}');
  });
});
