// api/cron.js v3 — Chạy tự động, quét Drive và gửi email duyệt
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
  MIN_PROJECTS: 3,
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

// Quét đệ quy tất cả subfolder — khai báo ở TOP LEVEL
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

async function sendEmail(project) {
  const { folderName, selectedImages, caption, approvalToken } = project;
  const approveUrl = `${CONFIG.BASE_URL}/api/approve?token=${approvalToken}&action=approve`;
  const rejectUrl  = `${CONFIG.BASE_URL}/api/approve?token=${approvalToken}&action=reject`;

  const imgHtml = selectedImages && selectedImages.length > 0
    ? selectedImages.map((img, i) => `
      <div style="display:inline-block;margin:6px;text-align:center;">
        <img src="https://drive.google.com/thumbnail?id=${img.id}&sz=w250" style="width:180px;height:130px;object-fit:cover;border-radius:6px;"/>
        <div style="font-size:11px;color:#666;margin-top:3px;">${i+1}. ${img.name}</div>
      </div>`).join("")
    : `<p style="color:#999;text-align:center;font-size:13px;">Ảnh sẽ được lấy từ Drive khi đăng bài</p>`;

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  <div style="background:#1565C0;color:#fff;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
    <h2 style="margin:0;">📸 BSC Auto Post — Duyệt bài</h2>
  </div>
  <div style="background:#f8f9ff;padding:20px;border:1px solid #e0e0e0;">
    <div style="background:#fff;border-radius:8px;padding:14px;margin-bottom:14px;">
      <b style="color:#1565C0;font-size:16px;">${folderName}</b>
    </div>
    <div style="background:#fff;border-radius:8px;padding:14px;margin-bottom:14px;text-align:center;">
      <div style="font-size:11px;color:#888;font-weight:700;margin-bottom:10px;">📷 ${selectedImages ? selectedImages.length : 0} ẢNH ĐẠI DIỆN</div>
      ${imgHtml}
    </div>
    <div style="background:#fff;border-radius:8px;padding:14px;margin-bottom:20px;">
      <div style="font-size:11px;color:#888;font-weight:700;margin-bottom:8px;">✍️ CAPTION AI VIẾT</div>
      <div style="white-space:pre-wrap;font-size:13px;line-height:1.7;color:#333;background:#f8f9ff;padding:12px;border-radius:6px;border-left:4px solid #1565C0;">${caption}</div>
    </div>
    <div style="text-align:center;">
      <a href="${approveUrl}" style="display:inline-block;background:#2e7d32;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:0 6px;">✅ DUYỆT ĐĂNG BÀI</a>
      <a href="${rejectUrl}"  style="display:inline-block;background:#c62828;color:#fff;padding:14px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:0 6px;">❌ TỪ CHỐI</a>
    </div>
    <p style="text-align:center;font-size:11px;color:#999;margin-top:14px;">Nếu không phản hồi, bài sẽ không được đăng.</p>
  </div>
</body></html>`;

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({
      from: "BSC Auto Post <onboarding@resend.dev>",
      to: [CONFIG.EMAIL_TO],
      subject: `📸 [BSC] Duyệt bài: ${folderName}`,
      html,
    }),
  });
  const d = await r.json();
  if (d.id) console.log("✅ Email đã gửi:", d.id);
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
    logs.push("🔍 Quét Google Drive...");
    const folders = await driveList(`'${CONFIG.DRIVE_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    logs.push(`   Tìm thấy ${folders.length} folder`);

    const pending = folders.filter(f => !f.name.startsWith("DONE_"));
    if (pending.length < CONFIG.MIN_PROJECTS) {
      logs.push(`⚠️ Kho ảnh còn ${pending.length} dự án (dưới mức ${CONFIG.MIN_PROJECTS})`);
    }

    for (const folder of pending.slice(0, 3)) {
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
      await kv.set(`project:${token}`, project, { ex: 60 * 60 * 24 * 7 });
      await kv.set(`project:folder:${folder.id}`, token, { ex: 60 * 60 * 24 * 7 });

      logs.push(`  📧 Gửi email duyệt...`);
      await sendEmail(project);
      logs.push(`  ✅ Email đã gửi!`);
    }

    const isPostTime = CONFIG.POST_DAYS.includes(day) && hour === CONFIG.POST_HOUR && minute < 35;
    if (isPostTime) {
      logs.push("⏰ Đúng lịch đăng bài!");
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
