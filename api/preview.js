// api/preview.js — Xem preview bài trước khi duyệt
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { token } = req.query;

  if (!token) {
    // Liệt kê tất cả bài đang chờ duyệt
    const keys = await kv.keys("project:*");
    const projects = [];
    for (const key of keys) {
      if (key.includes(":folder:")) continue;
      const p = await kv.get(key);
      if (p && p.status === "pending") projects.push(p);
    }

    const cards = projects.map(p => `
      <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="color:#1565C0;margin:0 0 12px;">${p.folderName}</h3>
        <p style="color:#888;font-size:13px;margin:0 0 12px;">📸 ${p.selectedImages?.length || 0} ảnh · ${new Date(p.createdAt).toLocaleString("vi-VN")}</p>
        <a href="/api/preview?token=${p.approvalToken}" style="display:inline-block;background:#1565C0;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">👁️ Xem preview</a>
      </div>
    `).join("");

    return res.status(200).send(`
      <!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>BSC Auto Post — Preview</title></head>
      <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;max-width:700px;margin:0 auto;">
        <div style="background:#1565C0;color:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:24px;">
          <h2 style="margin:0;">📸 BSC Auto Post — Danh sách chờ duyệt</h2>
        </div>
        ${projects.length === 0 
          ? '<p style="text-align:center;color:#888;">Không có bài nào đang chờ duyệt</p>' 
          : cards}
      </body></html>
    `);
  }

  // Xem chi tiết 1 bài
  const project = await kv.get(`project:${token}`);
  if (!project) {
    return res.status(404).send("<h2>Không tìm thấy bài</h2>");
  }

  const imgHtml = (project.selectedImages || []).map((img, i) => `
    <div style="display:inline-block;margin:8px;text-align:center;vertical-align:top;">
      <img src="https://drive.google.com/thumbnail?id=${img.id}&sz=w400" 
           style="width:200px;height:150px;object-fit:cover;border-radius:8px;border:1px solid #eee;"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'"/>
      <div style="display:none;width:200px;height:150px;background:#f0f0f0;border-radius:8px;line-height:150px;text-align:center;color:#999;font-size:12px;">Không load được ảnh</div>
      <div style="font-size:11px;color:#666;margin-top:4px;">Ảnh ${i+1}</div>
    </div>
  `).join("");

  const approveUrl = `/api/approve?token=${token}&action=approve`;
  const rejectUrl  = `/api/approve?token=${token}&action=reject`;

  return res.status(200).send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Preview: ${project.folderName}</title></head>
    <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;max-width:700px;margin:0 auto;">
      <div style="background:#1565C0;color:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px;">
        <h2 style="margin:0;">📸 BSC Auto Post — Preview bài</h2>
      </div>

      <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="color:#1565C0;margin:0 0 4px;">${project.folderName}</h3>
        <p style="color:#888;font-size:13px;margin:0;">Tạo lúc: ${new Date(project.createdAt).toLocaleString("vi-VN")}</p>
      </div>

      <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div style="font-size:12px;color:#888;font-weight:700;margin-bottom:12px;">📷 ${(project.selectedImages||[]).length} ẢNH ĐẠI DIỆN</div>
        <div style="text-align:center;">${imgHtml || '<p style="color:#999;">Không có ảnh</p>'}</div>
      </div>

      <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div style="font-size:12px;color:#888;font-weight:700;margin-bottom:12px;">✍️ CAPTION AI VIẾT</div>
        <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#333;background:#f8f9ff;padding:16px;border-radius:8px;border-left:4px solid #1565C0;">${project.caption}</div>
      </div>

      <div style="text-align:center;margin-bottom:40px;">
        <a href="${approveUrl}" style="display:inline-block;background:#2e7d32;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin:0 8px;">✅ DUYỆT ĐĂNG BÀI</a>
        <a href="${rejectUrl}"  style="display:inline-block;background:#c62828;color:#fff;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin:0 8px;">❌ TỪ CHỐI</a>
      </div>

      <div style="text-align:center;">
        <a href="/api/preview" style="color:#1565C0;font-size:13px;">← Quay lại danh sách</a>
      </div>
    </body></html>
  `);
}
