declare module 'pako' {
  export function inflate(data: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike>;
}
