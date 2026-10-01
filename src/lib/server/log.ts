/**
 * Structured operational logging. The field list is closed on purpose: there
 * is no way to pass message text, transcripts, answers, coordinates or IP
 * addresses through this function.
 */
export interface LogFields {
  requestId: string;
  route: string;
  status: number;
  code?: string;
  durationMs?: number;
  provider?: string;
}

export function logEvent(fields: LogFields): void {
  const entry = {
    severity: fields.status >= 500 ? 'ERROR' : fields.status >= 400 ? 'WARNING' : 'INFO',
    requestId: fields.requestId,
    route: fields.route,
    status: fields.status,
    code: fields.code,
    durationMs: fields.durationMs,
    provider: fields.provider,
  };
  console.log(JSON.stringify(entry));
}
