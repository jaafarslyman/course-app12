const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type LearnerIdentity = {
  id: string;
  name: string;
  email: string;
};

export function createAccessCode(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('secure_random_unavailable');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => ACCESS_CODE_ALPHABET[byte & 31]).join('');
}
