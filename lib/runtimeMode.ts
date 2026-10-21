/** Public builds start with deterministic local providers. Opt in to live calls. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE !== "false";
}
