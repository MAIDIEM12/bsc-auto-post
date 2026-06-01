// api/cron.js — Chạy tự động, quét Drive và gửi 1 email duyệt tất cả bài/tháng
import { kv } from "@vercel/kv";

const CONFIG = {
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  FB_PAGE_ID: process.env.FB_PAGE_ID,
  FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN,
  EMAIL_TO: process.env.EMAIL_TO || "diem.mai@blueskycorp.com.vn",
  BASE_URL: "https://bsc-auto-post.vercel.app",
  POST_DAYS: [2, 5],
  POST_HOUR: 9,
  POST_MINUTE: 30,
};

const BSC_SAMPLES = `
Bài mẫu 1 (Elleair - Activation):
"ELLEAIR – LAN TỎA CHUẨN MỰC CHĂM SÓC TỪNG NGÀY
Trải dài khắp mọi miền đất nước, Elleair không chỉ hiện diện tại các điểm bán mà còn để lại dấu ấn với đội ngũ PG của BSC xịn xò, luôn tươi cười, tận tâm và chuyên nghiệp trong từng chi tiết.
Cảm ơn Elleair đã luôn tin tưởng lựa chọn Blue Sky Corporation."

Bài mẫu 2 (Monster Energy - Event):
"Săn quà chất, nạp năng lượng đỉnh – Monster Energy đổ bộ rồi đây!
Bùng nổ năng lượng ngay tại giữa sân trường cùng những lon nước tăng lực Monster Energy mát lạnh, sảng khoái.
Blue Sky Corp. đồng hành cùng Monster Energy, mang đến trải nghiệm đậm chất sinh viên tự do, hết mình!"`;

// ── Helpers ──────────────────────────────────────────────────

async function driveList(q, fields = "files(id,name,createdTime)") {
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&key=${CONFIG.GOOGLE_API_KEY}&fields=${fields}&pageSize=50`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) throw new Error("Drive: " + d.error.message);
  return d.files || [];
}

async function scanFolderForImages(folderId) {
  let images = [];
  const imgs = await driveList(
    `'${folderId}' in parents and mimeType contains 'image/' and trashed=false`,
    "files(id,name,mimeType)"
  );
  images = images.concat(imgs);
  const subs = await driveList(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  for (const sub of subs) {
    const subImgs = await scanFolderForImages(sub.id);
    images = images.concat(subImgs);
  }
  return images;
}

function parseName(name) {
  const p = name.split("_");
  return { brand: p[0] || "Brand", type: p[1] || "Event", period: p.slice(2).join(" ") };
}

function selectImages(images, max = 5) {
  if (!images || images.length === 0) return [];
  if (images.length <= max) return images;
  const selected = [];
  const step = Math.floor(images.length / max);
  for (let i = 0; i < max; i++) {
    selected.push(images[Math.min(i * step, images.length - 1)]);
  }
  return selected;
}

async function groqCaption(info, imageCount) {
  const prompt = `Bạn là copywriter của Blue Sky Corporation — agency BTL hàng đầu Việt Nam.

GIỌNG VĂN BSC:${BSC_SAMPLES}

DỰ ÁN: Brand=${info.brand}, Loại=${info.type}, Thời gian=${info.period}
Bộ ảnh có ${imageCount} ảnh ghi lại hoạt động.

Viết caption theo format:
1. TENBRAND – TAGLINE (IN HOA)
2. 2-3 dòng mô tả: giọng ấm áp, tự hào, gần gũi, nhắc tên brand + BSC
3. Cảm ơn/kêu gọi
4. --------------------
   Website: www.blueskycorp.com.vn
   Mail: info@blueskycorp.com.vn
   #BlueSkyCorporation #Agency #event #activation #sampling #belowtheline #${info.brand.replace(/\s+/g,"")}

Yêu cầu quan trọng: Viết đúng chính tả tiếng Việt. Không dùng từ tiếng Anh/nước ngoài trong câu văn, TRỪ tên nhãn hàng và tên thương hiệu. Giọng văn tự nhiên, ấm áp, chuyên nghiệp.
Chỉ trả về caption, KHÔNG giải thích.`;

  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${CONFIG.GROQ_API_KEY}` },
    body: JSON.stringify({ model: "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], max_tokens: 500 }),
  });
  const d = await r.json();
  if (d.error) throw new Error("Groq: " + d.error.message);
  return d.choices?.[0]?.message?.content?.trim() ||
    `${info.brand.toUpperCase()} – ĐỒNG HÀNH CÙNG BSC\n\nCảm ơn ${info.brand}!\n\n--------------------\n Website: www.blueskycorp.com.vn\n Mail: info@blueskycorp.com.vn\n#BlueSkyCorporation #Agency #event #activation #sampling #belowtheline #${info.brand.replace(/\s+/g,"")}`;
}

// Gửi 1 email tổng hợp tất cả bài
async function sendBatchEmail(projects) {
  const previewUrl = `${CONFIG.BASE_URL}/api/preview`;
  const now = new Date();
  const monthYear = now.toLocaleDateString("vi-VN", { month: "long", year: "numeric" });

  const projectCards = projects.map((p, idx) => {
    const imgHtml = (p.selectedImages || []).slice(0, 3).map(img => `
      <img src="https://drive.google.com/thumbnail?id=${img.id}&sz=w150" 
           style="width:100px;height:75px;object-fit:cover;border-radius:4px;margin:3px;display:inline-block;"/>
    `).join("");

    const approveUrl = `${CONFIG.BASE_URL}/api/approve?token=${p.approvalToken}&action=approve`;

    return `
      <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:12px;border:1px solid #e0e0e0;">
        <div style="display:flex;align-items:center;margin-bottom:8px;">
          <span style="background:#1565C0;color:#fff;border-radius:50%;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;margin-right:8px;">${idx+1}</span>
          <b style="color:#1565C0;font-size:15px;">${p.folderName}</b>
        </div>
        <div style="margin-bottom:8px;">${imgHtml || '<span style="color:#999;font-size:12px;">Ảnh sẽ hiển thị khi đăng</span>'}</div>
        <div style="font-size:12px;color:#555;background:#f8f9ff;padding:10px;border-radius:6px;border-left:3px solid #1565C0;white-space:pre-wrap;max-height:80px;overflow:hidden;">${p.caption?.substring(0, 150)}...</div>
        <div style="margin-top:10px;">
          <a href="${previewUrl}?token=${p.approvalToken}" style="display:inline-block;background:#1565C0;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;margin-right:6px;">👁️ Xem đầy đủ & Sửa</a>
          <a href="${approveUrl}" style="display:inline-block;background:#2e7d32;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:13px;">✅ Duyệt nhanh</a>
        </div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto;padding:20px;background:#f5f5f5;">
  <div style="background:#1565C0;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
    <h2 style="margin:0;font-size:20px;">📸 BSC Auto Post — Duyệt bài ${monthYear}</h2>
    <p style="margin:8px 0 0;opacity:0.85;font-size:14px;">${projects.length} bài chờ duyệt · Rải đều trong 1 tháng</p>
  </div>

  <div style="background:#fff;padding:20px;border-radius:0 0 12px 12px;border:1px solid #e0e0e0;">
    <div style="background:#e8f5e9;border-radius:8px;padding:14px;margin-bottom:20px;text-align:center;">
      <p style="margin:0;font-size:14px;color:#2e7d32;">
        ✅ <b>Duyệt tất cả</b> để hệ thống tự đăng rải đều Thứ 3 & Thứ 6 · 
        <a href="${previewUrl}" style="color:#1565C0;font-weight:700;">Xem tất cả tại đây →</a>
      </p>
    </div>

    ${projectCards}

    <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #eee;">
      <a href="${previewUrl}" style="display:inline-block;background:#1565C0;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">🚀 Vào trang duyệt bài đầy đủ</a>
      <p style="color:#999;font-size:11px;margin-top:12px;">Bài chưa được duyệt sẽ không được đăng tự động.</p>
    </div>
  </div>
</body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "BSC Auto Post <onboarding@resend.dev>",
      to: [CONFIG.EMAIL_TO],
      subject: `📸 [BSC] Duyệt ${projects.length} bài đăng — ${monthYear}`,
      html,
    }),
  });
  const d = await r.json();
  if (d.id) console.log("✅ Email tổng hợp đã gửi:", d.id);
  else throw new Error("Email lỗi: " + JSON.stringify(d));
}

async function publishFB(project) {
  const { selectedImages, caption } = project;
  const photoIds = [];
  for (const img of selectedImages) {
    const params = new URLSearchParams({
      url: `https://drive.google.com/thumbnail?id=${img.id}&sz=w1200`,
      published: "false",
      access_token: CONFIG.FB_PAGE_TOKEN,
    });
    const r = await fetch(`https://graph.facebook.com/v19.0/${CONFIG.FB_PAGE_ID}/photos`, { method: "POST", body: params });
    const d = await r.json();
    if (d.id) photoIds.push(d.id);
    else throw new Error("Upload ảnh lỗi: " + JSON.stringify(d.error));
  }
  const body = new URLSearchParams();
  body.append("message", caption);
  body.append("access_token", CONFIG.FB_PAGE_TOKEN);
  photoIds.forEach(id => body.append("attached_media[]", JSON.stringify({ media_fbid: id })));
  const r = await fetch(`https://graph.facebook.com/v19.0/${CONFIG.FB_PAGE_ID}/feed`, { method: "POST", body });
  const d = await r.json();
  if (d.id) return d.id;
  throw new Error("Đăng bài lỗi: " + JSON.stringify(d.error));
}

// ── Main handler ─────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` && req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const now = new Date();
  const day = now.getDay();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const logs = [];

  try {
    // ── 1. Quét tất cả folder Drive ──────────────────────────
    logs.push("🔍 Quét Google Drive...");
    const folders = await driveList(`'${CONFIG.DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    logs.push(`   Tìm thấy ${folders.length} folder`);

    const pending = folders.filter(f => !f.name.startsWith("DONE_"));
    logs.push(`   ${pending.length} folder chưa xử lý`);

    // Xử lý TẤT CẢ folder chưa có trong KV
    const newProjects = [];
    for (const folder of pending) {
      const existing = await kv.get(`project:folder:${folder.id}`);
      if (existing) { logs.push(`⏭️ ${folder.name} — đã xử lý`); continue; }

      logs.push(`📁 Xử lý: ${folder.name}`);

      const images = await scanFolderForImages(folder.id);
      logs.push(`  📸 ${images.length} ảnh tìm thấy`);

      if (!images.length) { logs.push(`  ⚠️ Không có ảnh`); continue; }

      const selected = selectImages(images, 5);
      logs.push(`  ✅ Chọn ${selected.length} ảnh đại diện`);

      logs.push(`  ✍️ Đang tạo caption...`);
      const info = parseName(folder.name);
      const caption = await groqCaption(info, images.length);
      logs.push(`  ✅ Caption xong`);

      const token = Buffer.from(`${folder.id}_${Date.now()}`).toString("base64url");
      const project = {
        folderId: folder.id, folderName: folder.name, folderInfo: info,
        selectedImages: selected, caption, approvalToken: token,
        status: "pending", createdAt: now.toISOString(),
      };
      await kv.set(`project:${token}`, project, { ex: 60 * 60 * 24 * 30 }); // lưu 30 ngày
      await kv.set(`project:folder:${folder.id}`, token, { ex: 60 * 60 * 24 * 30 });
      newProjects.push(project);
    }

    // Gửi 1 email tổng hợp nếu có bài mới
    if (newProjects.length > 0) {
      logs.push(`\n📧 Gửi 1 email tổng hợp ${newProjects.length} bài...`);
      await sendBatchEmail(newProjects);
      logs.push(`✅ Email đã gửi!`);
    } else {
      logs.push(`ℹ️ Không có bài mới cần xử lý`);
    }

    // ── 2. Đăng bài đúng lịch Thứ 3 & Thứ 6 lúc 9:30 ───────
    const isPostTime = CONFIG.POST_DAYS.includes(day) && hour === CONFIG.POST_HOUR && minute < 35;
    if (isPostTime) {
      logs.push("\n⏰ Đúng lịch đăng bài!");
      const keys = await kv.keys("project:*");
      for (const key of keys) {
        if (key.includes(":folder:")) continue;
        const project = await kv.get(key);
        if (project?.status !== "approved") continue;
        logs.push(`🚀 Đăng: ${project.folderName}`);
        const postId = await publishFB(project);
        await kv.set(key, { ...project, status: "posted", postId, postedAt: now.toISOString() });
        logs.push(`  ✅ Post ID: ${postId}`);
      }
    }

    return res.status(200).json({ ok: true, logs });

  } catch (e) {
    logs.push("❌ Lỗi: " + e.message);
    return res.status(500).json({ ok: false, error: e.message, logs });
  }
}
