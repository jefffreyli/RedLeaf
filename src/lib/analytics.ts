import posthog from "posthog-js";

const KEY = "phc_wgnPkhzJyDkqLZ7HG9VaRudrcKBFNkqBK33rCRGQq5uq";
const HOST = "https://us.i.posthog.com";

export function initAnalytics() {
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
  });
}

export function capture(event: string, properties?: Record<string, unknown>) {
  posthog.capture(event, properties);
}
