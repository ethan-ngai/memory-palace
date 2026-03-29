/**
 * @file pako.d.ts
 * @description Supplies the minimal typing surface used by the anchor tagger's gzip fallback.
 */
declare module "pako" {
  const pako: {
    inflate: (input: Uint8Array) => Uint8Array;
  };

  export default pako;
}
