// Type declarations for modules without types
declare module 'uuid' {
  export function v4(): string;
  export function parse(uuid: string): Uint8Array;
  export function stringify(arr: Uint8Array): string;
}
