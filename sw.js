// service worker — 晚霞的蓝线
//
// Cách bản mới tới được máy Minh, khi chị thêm bài sau ngày 25/10:
//   · index.html (nơi ghi bảng bài hát) đi đường MẠNG TRƯỚC — mỗi lần mở app
//     là tải lại bản mới nhất, nên bài vừa thêm hiện ra ngay. Mất mạng thì rơi
//     về bản đã lưu, app vẫn mở được như thường.
//   · Bài hát và truyện đi đường BỘ NHỚ TRƯỚC — tải một lần rồi ở lại mãi,
//     không bao giờ tải lại. Hàng trăm MB, không thể đụng tới mỗi lần mở.
//     Hệ quả: muốn SỬA một bài đã gửi đi thì phải ĐẶT TÊN FILE KHÁC, vì máy
//     Minh nhận ra bài theo đường dẫn, chứ không nhìn vào ruột file.
// Chị không cần đổi số bên dưới nữa; để đó làm nút bấm cuối cùng thôi.
const CACHE_VERSION = "v5";
const CACHE_NAME = "wanxia-" + CACHE_VERSION;

// "app shell" — luôn tải sẵn để mở được ngay cả khi mất mạng
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/images/avatar.jpg",
  "./assets/images/avatar-minh.png",
  "./assets/images/poster-11.jpg"
];

// CỐ Ý không preload bài hát và truyện: 23 video + 11 file truyện là hàng trăm MB,
// tải hết lúc cài sẽ làm máy treo. Chúng được cache lần đầu mở, rồi ở lại vĩnh viễn.
const MEDIA_CACHE = "wanxia-media";

// Nạp từng file MỘT, không dùng cache.addAll. Lý do: addAll là tất-cả-hoặc-không —
// thiếu đúng một file trong danh sách trên là cả bước cài đổ, service worker không
// bao giờ sống, và thế là mất offline, mất cả lời nhắn tới máy. Chỉ vì một tấm ảnh
// quên chưa đẩy lên. Thiếu thì bỏ qua, phần còn lại vẫn vào.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(CORE_ASSETS.map((u) =>
        cache.add(new Request(u, { cache: "reload" })).catch((e) => {
          console.warn("[wanxia] không nạp được, bỏ qua:", u);
        })
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("wanxia-") && key !== CACHE_NAME && key !== MEDIA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Font Google (khác gốc) thì cứ để mạng xử lý bình thường, không can thiệp.

// Mạng trước, nhưng không chờ mãi: quá 4 giây coi như mất mạng và lấy bản đã lưu.
// Kẻo Minh đứng chỗ sóng yếu thì app treo ở màn hình trắng.
function mangTruoc(req, cacheName){
  return caches.open(cacheName).then(cache =>
    cache.match(req).then(daLuu => {
      const choMang = new Promise((xong, hong) => {
        const het = setTimeout(() => hong(new Error("cham qua")), 4000);
        fetch(req).then(res => { clearTimeout(het); xong(res); },
                        e   => { clearTimeout(het); hong(e); });
      });
      return choMang.then(res => {
        if (res && res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => daLuu || fetch(req));
    })
  );
}

// Bài hát và truyện phải TUA ĐƯỢC.
//
// Trình phát không xin cả tệp: nó xin "cho tôi đoạn từ byte này tới byte kia"
// (header Range), và chờ máy chủ đáp lại bằng mã 206 kèm Content-Range. Trước
// đây service worker lấy nguyên tệp trong bộ nhớ trả ra một cục mã 200 — nên
// trình phát coi như đây là dòng chảy không tua được: thanh thời gian kéo
// không ăn, và đường tiếng chạy song song cũng không nhảy theo được.
// Giờ nó tự cắt đúng đoạn được hỏi rồi trả về 206.
async function traMedia(req, cache){
  const khoa = new Request(req.url);          // tra và cất KHÔNG kèm Range
  let res = await cache.match(khoa);
  if (!res){
    res = await fetch(khoa);
    if (res && res.ok && res.status === 200) await cache.put(khoa, res.clone());
  }
  const xin = req.headers.get("range");
  if (!xin || !res || res.status !== 200) return res;

  const buf = await res.arrayBuffer();
  const tong = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/i.exec(xin);
  let tu  = m && m[1] ? parseInt(m[1], 10) : 0;
  let den = m && m[2] ? parseInt(m[2], 10) : tong - 1;
  if (!isFinite(tu)  || tu  < 0 || tu  >= tong) tu  = 0;
  if (!isFinite(den) || den < tu || den >= tong) den = tong - 1;
  const phan = buf.slice(tu, den + 1);
  return new Response(phan, {
    status: 206, statusText: "Partial Content",
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/octet-stream",
      "Content-Length": String(phan.byteLength),
      "Content-Range": "bytes " + tu + "-" + den + "/" + tong,
      "Accept-Ranges": "bytes"
    }
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // bỏ qua font/CDN ngoài

  // Trang chính: mạng trước. Đây là nơi ghi bảng 22 bài, nên nó phải luôn mới.
  if (req.mode === "navigate" || /\/(index\.html)?$/.test(url.pathname)){
    event.respondWith(mangTruoc(req, CACHE_NAME));
    return;
  }

  // Bài hát & truyện: cache riêng, KHÔNG bị xoá khi bump CACHE_VERSION,
  // nên cập nhật nội dung trang không bắt tải lại hàng trăm MB.
  const isMedia = /\/assets\/(songs|stories)\//.test(url.pathname);
  if (isMedia){
    event.respondWith(caches.open(MEDIA_CACHE).then(cache => traMedia(req, cache)));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => cached);
    })
  );
});

// ---------------------------------------------------------------------------
// Lời nhắn tới máy, kể cả lúc app đang đóng.
// Người gửi (xem thư mục nguoi-dua-thu) đẩy một gói tin tới đây đúng giờ hẹn.
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch(e){
    d = { body: event.data ? event.data.text() : "" };
  }
  const title = d.title || "Linh Hà";
  const opts = {
    body: d.body || "",
    icon: d.icon || "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    tag: d.tag || "wanxia",
    renotify: true,
    // Rung nhẹ hai nhịp, như một tin nhắn tới — không phải chuông báo thức.
    vibrate: [90, 60, 90],
    data: { url: d.url || "./", text: d.body || "", day: d.day || 0, kieu: d.kieu || "", id: d.id || "" }
  };
  // Luôn hiện thông báo (iOS đòi vậy), và nếu app đang mở thì nhắc nó lấy tin mới ngay.
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, opts),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) c.postMessage({ wanxia: "tin-moi" });
    })
  ]));
});

// Chạm vào thông báo: nếu app đang mở sẵn thì nhảy về đúng cửa sổ ấy
// và đưa luôn lời nhắn sang, chứ đừng mở thêm một bản nữa.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list){
        if (c.url.indexOf(self.registration.scope) === 0){
          if (data.kieu === "chat") c.postMessage({ wanxia: "chat", id: data.id || "" });
          else c.postMessage({ wanxia: "popup", text: data.text || "", day: data.day || 0 });
          return c.focus();
        }
      }
      return self.clients.openWindow(data.url || "./");
    })
  );
});
