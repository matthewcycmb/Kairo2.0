import posthog from "posthog-js";

export function track(event: string, properties?: Record<string, unknown>) {
  try { posthog.capture(event, properties); } catch {}
}
