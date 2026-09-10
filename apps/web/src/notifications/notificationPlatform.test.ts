import { describe, expect, it } from "vite-plus/test";

import { resolveNotificationPlatform } from "./notificationPlatform";

describe("resolveNotificationPlatform", () => {
  it("prefers the desktop bridge when it exposes showNotification", () => {
    expect(
      resolveNotificationPlatform({
        desktopBridge: { showNotification: async () => true },
        webNotificationSupported: true,
      }),
    ).toBe("desktop");
  });

  it("ignores an older desktop bridge that predates showNotification", () => {
    expect(
      resolveNotificationPlatform({
        desktopBridge: {},
        webNotificationSupported: true,
      }),
    ).toBe("web");
  });

  it("falls back to the web Notification API outside desktop", () => {
    expect(
      resolveNotificationPlatform({ desktopBridge: null, webNotificationSupported: true }),
    ).toBe("web");
  });

  it("reports unsupported when neither path exists", () => {
    expect(
      resolveNotificationPlatform({ desktopBridge: null, webNotificationSupported: false }),
    ).toBe("unsupported");
  });
});
