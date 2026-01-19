export function now(): string {
  return new Date().toISOString();
}

export function isExpired(dateString: string | null | undefined): boolean {
  if (!dateString) return false;
  return new Date(dateString) < new Date();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
