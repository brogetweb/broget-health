export class StoreError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function ownerId(value) {
  if (typeof value !== 'string' || !value.length || value.length > 128 || /[\x00-\x1f]/.test(value)) {
    throw new StoreError(401, 'sign-in-required');
  }
  return value;
}
