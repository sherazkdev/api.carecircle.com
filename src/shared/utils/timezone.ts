import { IANAZone } from 'luxon';

export function isValidIanaTimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') {
    return false;
  }
  return IANAZone.isValidZone(timezone);
}

export function assertValidIanaTimezone(timezone: string): void {
  if (!isValidIanaTimezone(timezone)) {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}
