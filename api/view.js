// api/view.js — Trang xem bài chỉ đọc, không có nút duyệt/sửa
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { token } = req.query;

  // Xem chi tiết 1 bài
  if (token) {
    const project = await kv.get(`project:${token}`);
    if (!project) return res.status(404).send("<h2>Không tìm thấy bài</h2>");

    const imgHtml = (project.selectedImages || []).map((img, i) => `
      <div style="display:inline-block;margin:8px;text-align:center;vertical-align:top;">
        <img src="https://drive.google.com/thumbnail?id=${img.id}&sz=w400"
             style="width:200px;height:150px;object-fit:cover;border-radius:8px;border:1px solid #eee;"/>
        <div style="font-size:11px;color:#666;margin-top:4px;">Ảnh ${i+1}</div>
      </div>
    `).join("");

    return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${project.folderName} — BSC Auto Post</title>
      <style>
        body{font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;max-width:700px;margin:0 auto;}
        .card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);}
        .badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;}
        .badge-pending{background:#fff3e0;color:#e65100;}
        .badge-approved{background:#e8f5e9;color:#2e7d32;}
        .badge-posted{background:#e3f2fd;color:#1565C0;}
      </style>
      </head>
      <body>
        <div style="background:#1565C0;color:#fff;padding:16px 20px;border-radius:12px;text-align:center;margin-bottom:16px;">
          <h2 style="margin:0;font-size:18px;">📸 BSC Auto Post</h2>
        </div>

        <div class="card">
          <h3 style="color:#1565C0;margin:0 0 6px;">${project.folderName}</h3>
          <span class="badge badge-${project.status}">${project.status === 'pending' ? '⏳ Chờ duyệt' : project.status === 'approved' ? '✅ Đã duyệt' : '📤 Đã đăng'}</span>
          <p style="color:#888;font-size:13px;margin:8px 0 0;">Tạo lúc: ${new Date(project.createdAt).toLocaleString("vi-VN")}</p>
        </div>

        <div class="card">
          <div style="font-size:12px;color:#888;font-weight:700;margin-bottom:12px;">📷 ${(project.selectedImages||[]).length} ẢNH ĐẠI DIỆN</div>
          <div style="text-align:center;">${imgHtml || '<p style="color:#999;text-align:center;">Không có ảnh</p>'}</div>
        </div>

        <div class="card">
          <div style="font-size:12px;color:#888;font-weight:700;margin-bottom:12px;">✍️ CAPTION</div>
          <div style="white-space:pre-wrap;font-size:14px;line-height:1.8;color:#333;background:#f8f9ff;padding:16px;border-radius:8px;border-left:4px solid #1565C0;">${project.caption}</div>
        </div>

        <div style="text-align:center;margin-top:8px;">
          <a href="/api/view" style="color:#1565C0;font-size:13px;">← Quay lại danh sách</a>
        </div>
      </body></html>`);
  }

  // Danh sách tất cả bài
  const keys = await kv.keys("project:*");
  const projects = [];
  for (const key of keys) {
    if (key.includes(":folder:")) continue;
    const p = await kv.get(key);
    if (p) projects.push(p);
  }

  // Sắp xếp mới nhất lên đầu
  projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const statusBadge = (s) => {
    if (s === "pending") return `<span style="background:#fff3e0;color:#e65100;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">⏳ Chờ duyệt</span>`;
    if (s === "approved") return `<span style="background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">✅ Đã duyệt</span>`;
    if (s === "posted") return `<span style="background:#e3f2fd;color:#1565C0;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">📤 Đã đăng</span>`;
    return `<span style="background:#eee;color:#666;padding:3px 10px;border-radius:20px;font-size:11px;">${s}</span>`;
  };

  const cards = projects.map(p => {
    const thumb = p.selectedImages?.[0]?.id
      ? `<img src="https://drive.google.com/thumbnail?id=${p.selectedImages[0].id}&sz=w200" style="width:80px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0;"/>`
      : `<div style="width:80px;height:60px;background:#eee;border-radius:6px;flex-shrink:0;"></div>`;

    return `
      <a href="/api/view?token=${p.approvalToken}" style="text-decoration:none;">
        <div style="background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px;box-shadow:0 2px 6px rgba(0,0,0,0.07);display:flex;align-items:center;gap:14px;cursor:pointer;transition:box-shadow 0.2s;" onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.12)'" onmouseout="this.style.boxShadow='0 2px 6px rgba(0,0,0,0.07)'">
          ${thumb}
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;color:#1565C0;font-size:14px;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.folderName}</div>
            <div style="margin-bottom:6px;">${statusBadge(p.status)}</div>
            <div style="font-size:12px;color:#999;">${new Date(p.createdAt).toLocaleDateString("vi-VN")} · ${p.selectedImages?.length || 0} ảnh</div>
          </div>
          <div style="color:#bbb;font-size:18px;">›</div>
        </div>
      </a>`;
  }).join("");

  const pending = projects.filter(p => p.status === "pending").length;
  const approved = projects.filter(p => p.status === "approved").length;
  const posted = projects.filter(p => p.status === "posted").length;

  return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>BSC Auto Post — Danh sách bài</title>
    </head>
    <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;max-width:700px;margin:0 auto;">
      <div style="background:#1565C0;color:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:20px;">
        <h2 style="margin:0 0 4px;font-size:20px;">📸 BSC Auto Post</h2>
        <p style="margin:0;opacity:0.85;font-size:13px;">Hệ thống đăng bài tự động — Blue Sky Corporation</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
        <div style="background:#fff3e0;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#e65100;">${pending}</div>
          <div style="font-size:12px;color:#bf360c;">Chờ duyệt</div>
        </div>
        <div style="background:#e8f5e9;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#2e7d32;">${approved}</div>
          <div style="font-size:12px;color:#1b5e20;">Đã duyệt</div>
        </div>
        <div style="background:#e3f2fd;border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#1565C0;">${posted}</div>
          <div style="font-size:12px;color:#0d47a1;">Đã đăng</div>
        </div>
      </div>

      ${projects.length === 0
        ? '<p style="text-align:center;color:#888;padding:40px;">Chưa có bài nào</p>'
        : cards}
    </body></html>`);
}
