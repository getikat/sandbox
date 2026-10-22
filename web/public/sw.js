// Ikat's service worker: shows pushed alerts, opens the right page when one is
// tapped, and keeps the app shell available offline. Data (/api) is never
// cached — balances are always fetched fresh.

const SHELL = "ikat-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Ikat", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { link: data.link || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.link || "/",
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        if ("navigate" in w) await w.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  )
    return;
  event.respondWith(
    (async () => {
      const key = req.mode === "navigate" ? "/" : req;
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(key, res.clone());
        return res;
      } catch {
        return (
          (await (await caches.open(SHELL)).match(key)) || Response.error()
        );
      }
    })(),
  );
});
