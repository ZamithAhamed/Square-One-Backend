export function toCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: any) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  };
  const head = headers.map(esc).join(',');
  const body = rows.map(r => r.map(esc).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}
