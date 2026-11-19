export const ENTITY_TYPES = [
  'PERSON',
  'ORG',
  'LOCATION',
  'EMAIL',
  'PHONE',
  'URL',
  'IBAN',
  'CARD',
  'ACCOUNT',
  'MONEY',
  'ID',
  'CUSTOM',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/** Where a detection came from. Mirrors Firebase AI Logic's InferenceSource for AI hits. */
export type DetectionSource = 'pattern' | 'on_device' | 'in_cloud' | 'manual';

export interface Detection {
  text: string;
  type: EntityType;
  source: DetectionSource;
}

export interface Entity {
  /** Placeholder key, e.g. PERSON_1. Rendered to the cloud as [PERSON_1]. */
  id: string;
  type: EntityType;
  /** The real value. Never leaves this device. */
  value: string;
  /** Other spellings that map to the same placeholder (e.g. a surname on its own). */
  aliases: string[];
  source: DetectionSource;
  /** When false the value was detected but the user chose to let it through. */
  enabled: boolean;
  /** A placeholder whose real value is not in this browser's vault. */
  ghost?: boolean;
}

export interface VaultState {
  entities: Entity[];
  counters: Partial<Record<EntityType, number>>;
}

export interface Segment {
  text: string;
  entity?: Entity;
}

export const TYPE_LABEL: Record<EntityType, string> = {
  PERSON: 'People',
  ORG: 'Organizations',
  LOCATION: 'Places',
  EMAIL: 'Emails',
  PHONE: 'Phones',
  URL: 'Links',
  IBAN: 'IBANs',
  CARD: 'Cards',
  ACCOUNT: 'Account numbers',
  MONEY: 'Amounts',
  ID: 'IDs',
  CUSTOM: 'Custom',
};
