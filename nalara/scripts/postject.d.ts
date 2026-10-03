/** postject ships no types; this is the one function scripts/build-app.ts uses. */
declare module "postject" {
  export function inject(filename: string, resourceName: string, resourceData: Buffer, options?: { sentinelFuse?: string; machoSegmentName?: string; overwrite?: boolean }): Promise<void>;
}
