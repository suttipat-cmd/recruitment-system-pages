/** One base path for root hosting and GitHub project Pages. */
export function appAddress(origin: string, base: string, hash = ""): string {
  return new URL(base, origin).href + hash;
}
export function configAddress(
  origin: string,
  base: string,
  development: boolean,
): string {
  return new URL(base + (development ? "api/config" : "config.json"), origin)
    .href;
}
export let attachmentsEnabled = false;
export function setAttachmentsEnabled(enabled:boolean){attachmentsEnabled=enabled;}
