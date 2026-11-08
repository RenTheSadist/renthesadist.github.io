const CACHE_NAME = "church-gateway-v21";
let activeClientRoute = "/";
let activeClientVisible = false;
let latestExplicitUnread = 0;

async function updateSwAppBadge(explicitCount) {
  try {
    if (typeof explicitCount === "number" && explicitCount >= 0) {
      latestExplicitUnread = Math.floor(explicitCount);
    }
    const list = self.registration.getNotifications ? await self.registration.getNotifications() : [];
    const activeTrayCount = Array.isArray(list) ? list.length : 0;
    const badgeCount = Math.max(latestExplicitUnread, activeTrayCount);
    if (self.navigator) {
      if (badgeCount > 0 && typeof self.navigator.setAppBadge === "function") {
        await self.navigator.setAppBadge(badgeCount);
      } else if (badgeCount <= 0 && typeof self.navigator.clearAppBadge === "function") {
        await self.navigator.clearAppBadge();
      }
    }
  } catch {}
}
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.png",
  "./apple-touch-icon.png",
  "./pwa-192.png",
  "./pwa-512.png",
  "./notification-badge.png",
  "./notification-icon.png",
  "./logo-emblem.png",
  "./logo-bottom.png",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname.endsWith("public-url.txt") ||
    event.request.mode === "navigate" ||
    url.pathname.endsWith("/") ||
    url.pathname.endsWith("/index.html")
  ) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).catch(() => caches.match(event.request)),
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(event.request)),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data.type !== "string") return;
  if (data.type === "CC_SW_STATE") {
    if (typeof data.route === "string") activeClientRoute = data.route;
    if (typeof data.visible === "boolean") activeClientVisible = data.visible;
  } else if (data.type === "CC_SET_APP_BADGE") {
    event.waitUntil(updateSwAppBadge(typeof data.count === "number" ? data.count : 0));
  } else if (data.type === "CC_CLEAR_ROOM_NOTIFICATIONS" && typeof data.conversationId === "string") {
    event.waitUntil(
      (async () => {
        try {
          if (self.registration.getNotifications) {
            const list = await self.registration.getNotifications();
            for (const n of list) {
              if (n.data && n.data.conversationId === data.conversationId) {
                n.close();
              }
            }
          }
          await updateSwAppBadge();
        } catch {}
      })(),
    );
  }
});

// 아이폰(iOS 16.4+ PWA) 및 안드로이드(Chrome/WebAPK) 백그라운드 Web Push 수신 핸들러
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      try {
        data = { title: "은혜와진리교회 알림", body: event.data.text() };
      } catch {
        data = { title: "은혜와진리교회 알림", body: "새 알림이 도착했습니다." };
      }
    }
  } else {
    data = { title: "은혜와진리교회 알림", body: "새 알림이 도착했습니다." };
  }

  const title = data.title || "📖 오늘 나를 위한 맞춤 말씀";
  const vibratePattern = Array.isArray(data.vibrate) ? data.vibrate : [250, 100, 250, 100, 300];
  const isChatMessage =
    Boolean(data.conversationId) || (typeof data.tag === "string" && data.tag.startsWith("chat-msg-"));
  const targetUrl = data.url || "/prayers";
  // 알림마다 고유한 tag를 부여하여 이전 알림을 덮어쓰지 않고 알림 개수가 누적(1 -> 2 -> 3...)되도록 처리
  const uniqueTag =
    (typeof data.tag === "string" && data.tag ? data.tag : "push") +
    "-" +
    Date.now() +
    "-" +
    Math.random().toString(36).slice(2, 6);

  const fullOptions = {
    body: data.body || "",
    icon: "./notification-icon.png?v=19",
    badge: "./notification-badge.png?v=19",
    tag: uniqueTag,
    renotify: true,
    requireInteraction: isChatMessage ? true : Boolean(data.requireInteraction),
    silent: false,
    vibrate: vibratePattern,
    data: {
      url: targetUrl,
      conversationId: data.conversationId || null,
    },
  };

  // 아이폰(iOS Safari/WebKit) 호환용 최소 옵션 폴백
  const safeOptions = {
    body: data.body || "",
    icon: "./notification-icon.png?v=19",
    tag: uniqueTag,
    data: {
      url: targetUrl,
      conversationId: data.conversationId || null,
    },
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clientList) => {
        const isActivelyViewingSameChatRoom =
          Boolean(data.conversationId) &&
          activeClientVisible &&
          activeClientRoute === "/messages/" + data.conversationId &&
          clientList.some((c) => c.visibilityState === "visible" && c.focused);

        if (isActivelyViewingSameChatRoom) {
          return;
        }

        await self.registration
          .showNotification(title, fullOptions)
          .catch(() => self.registration.showNotification(title, safeOptions))
          .catch(() => {});
        await updateSwAppBadge();
      })
      .catch(async () => {
        await self.registration
          .showNotification(title, fullOptions)
          .catch(() => self.registration.showNotification(title, safeOptions))
          .catch(() => {});
        await updateSwAppBadge();
      }),
  );
});

self.addEventListener("notificationclick", (event) => {
  const clickedConvId = event.notification.data && event.notification.data.conversationId;
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/prayers";
  const baseScope = (self.registration && self.registration.scope) ? self.registration.scope : "https://gntchurch.github.io/grace/";
  const openUrl = baseScope.replace(/\/+$/, "") + "/?route=" + encodeURIComponent(targetUrl);

  event.waitUntil(
    (async () => {
      try {
        if (clickedConvId && self.registration.getNotifications) {
          const list = await self.registration.getNotifications();
          for (const n of list) {
            if (n.data && n.data.conversationId === clickedConvId) {
              n.close();
            }
          }
        }
        await updateSwAppBadge();
      } catch {}

      try {
        const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clientList) {
          try {
            client.postMessage({ type: "CC_PUSH_CLICK_NAVIGATE", url: targetUrl });
          } catch {}
          if ("focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(openUrl);
        }
      } catch {}
    })(),
  );
});
