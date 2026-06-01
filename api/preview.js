// api/preview.js — Xem và chỉnh sửa bài trước khi duyệt
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { token } = req.query;

  // Danh sách tất cả bài chờ duyệt
  if (!token) {
    const keys = await kv.keys("project:*");
    const projects = [];
    for (const key of keys) {
      if (key.includes(":folder:")) continue;
      const p = await kv.get(key);
      if (p && p.status === "pending") projects.push(p);
    }

    const cards = projects.map(p => `
      <div style="background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="color:#1565C0;margin:0 0 8px;">${p.folderName}</h3>
        <p style="color:#888;font-size:13px;margin:0 0 14px;">📸 ${p.selectedImages?.length || 0} ảnh · ${new Date(p.createdAt).toLocaleString("vi-VN")}</p>
        <a href="/api/preview?token=${p.approvalToken}" style="display:inline-block;background:#1565C0;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;margin-right:8px;">👁️ Xem & Chỉnh sửa</a>
        <a href="/api/approve?token=${p.approvalToken}&action=approve" style="display:inline-block;background:#2e7d32;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:14px;">✅ Duyệt ngay</a>
      </div>
    `).join("");

    return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>BSC Auto Post — Danh sách chờ duyệt</title></head>
      <body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;max-width:700px;margin:0 auto;">
        <div style="background:#1565C0;color:#fff;padding:20px;border-radius:12px;text-align:center;margin-bottom:24px;">
          <h2 style="margin:0;">📸 BSC Auto Post — Danh sách chờ duyệt</h2>
        </div>
        ${projects.length === 0 ? '<p style="text-align:center;color:#888;padding:40px;">Không có bài nào đang chờ duyệt</p>' : cards}
      </body></html>`);
  }

  // Xem chi tiết + chỉnh sửa 1 bài
  const project = await kv.get(`project:${token}`);
  if (!project) return res.status(404).send("<h2>Không tìm thấy bài</h2>");

  // Lấy tất cả ảnh từ Drive để cho chọn lại
  const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
  let allImages = [];
  try {
    async function scanFolder(fid) {
      const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${fid}' in parents and mimeType contains 'image/' and trashed=false`)}&key=${GOOGLE_API_KEY}&fields=files(id,name,mimeType)&pageSize=50`;
      const r = await fetch(url);
      const d = await r.json();
      allImages = allImages.concat(d.files || []);
      const subUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${fid}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&key=${GOOGLE_API_KEY}&fields=files(id,name)&pageSize=20`;
      const sr = await fetch(subUrl);
      const sd = await sr.json();
      for (const sub of (sd.files || [])) await scanFolder(sub.id);
    }
    await scanFolder(project.folderId);
  } catch(e) {}

  const selectedIds = (project.selectedImages || []).map(i => i.id);

  const allImgGrid = allImages.map(img => {
    const isSelected = selectedIds.includes(img.id);
    return `<div style="display:inline-block;margin:6px;text-align:center;cursor:pointer;" onclick="toggleImage('${img.id}','${img.name}',this)">
      <div style="position:relative;">
        <img src="https://drive.google.com/thumbnail?id=${img.id}&sz=w200" 
             style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:3px solid ${isSelected ? '#2e7d32' : '#ddd'};"
             id="img-${img.id}"/>
        <div id="check-${img.id}" style="position:absolute;top:4px;right:4px;background:${isSelected ? '#2e7d32' : 'rgba(0,0,0,0.3)'};color:#fff;border-radius:50%;width:22px;height:22px;line-height:22px;text-align:center;font-size:12px;">${isSelected ? '✓' : ''}</div>
      </div>
      <div style="font-size:10px;color:#666;margin-top:3px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${img.name}</div>
    </div>`;
  }).join("");

  const approveUrl = `/api/approve?token=${token}&action=approve`;
  const rejectUrl  = `/api/approve?token=${token}&action=reject`;

  return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Preview: ${project.folderName}</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f5f5f5;padding:16px;max-width:700px;margin:0 auto;}
      .card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);}
      .btn{display:inline-block;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin:4px;cursor:pointer;border:none;}
      .btn-green{background:#2e7d32;color:#fff;}
      .btn-red{background:#c62828;color:#fff;}
      .btn-blue{background:#1565C0;color:#fff;}
      .btn-gray{background:#eee;color:#333;}
      textarea{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:14px;line-height:1.6;resize:vertical;font-family:Arial;}
      .section-title{font-size:12px;color:#888;font-weight:700;margin-bottom:12px;}
      #save-status{color:#2e7d32;font-size:13px;margin-left:8px;display:none;}
    </style>
    </head>
    <body>
      <div style="background:#1565C0;color:#fff;padding:16px 20px;border-radius:12px;text-align:center;margin-bottom:16px;">
        <h2 style="margin:0;font-size:18px;">📸 BSC Auto Post — Chỉnh sửa bài</h2>
      </div>

      <div class="card">
        <h3 style="color:#1565C0;margin:0 0 4px;">${project.folderName}</h3>
        <p style="color:#888;font-size:13px;margin:0;">Tạo lúc: ${new Date(project.createdAt).toLocaleString("vi-VN")}</p>
      </div>

      <!-- CHỌN ẢNH -->
      <div class="card">
        <div class="section-title">📷 CHỌN ẢNH (click để chọn/bỏ chọn — tối đa 5 ảnh)</div>
        <div id="selected-count" style="font-size:13px;color:#1565C0;margin-bottom:12px;">Đang chọn: ${selectedIds.length} ảnh</div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid #eee;border-radius:8px;padding:8px;">
          ${allImgGrid || '<p style="color:#999;text-align:center;">Không tải được ảnh từ Drive</p>'}
        </div>
      </div>

      <!-- SỬA CAPTION -->
      <div class="card">
        <div class="section-title">✍️ CAPTION (có thể chỉnh sửa trực tiếp)</div>
        <textarea id="caption-text" rows="12">${project.caption}</textarea>
      </div>

      <!-- NÚT HÀNH ĐỘNG -->
      <div class="card" style="text-align:center;">
        <button class="btn btn-blue" onclick="saveChanges()">💾 Lưu thay đổi</button>
        <span id="save-status">✅ Đã lưu!</span>
        <br/><br/>
        <a href="${approveUrl}" class="btn btn-green">✅ DUYỆT ĐĂNG BÀI</a>
        <a href="${rejectUrl}" class="btn btn-red">❌ TỪ CHỐI</a>
        <br/><br/>
        <a href="/api/preview" class="btn btn-gray">← Quay lại danh sách</a>
      </div>

    <script>
      const token = "${token}";
      const allImages = ${JSON.stringify(allImages)};
      let selectedImages = ${JSON.stringify(project.selectedImages || [])};

      function toggleImage(id, name, el) {
        const idx = selectedImages.findIndex(i => i.id === id);
        const imgEl = document.getElementById('img-' + id);
        const checkEl = document.getElementById('check-' + id);
        if (idx >= 0) {
          selectedImages.splice(idx, 1);
          imgEl.style.border = '3px solid #ddd';
          checkEl.style.background = 'rgba(0,0,0,0.3)';
          checkEl.textContent = '';
        } else {
          if (selectedImages.length >= 5) { alert('Tối đa 5 ảnh!'); return; }
          selectedImages.push({ id, name, mimeType: 'image/jpeg' });
          imgEl.style.border = '3px solid #2e7d32';
          checkEl.style.background = '#2e7d32';
          checkEl.textContent = '✓';
        }
        document.getElementById('selected-count').textContent = 'Đang chọn: ' + selectedImages.length + ' ảnh';
      }

      async function saveChanges() {
        const caption = document.getElementById('caption-text').value;
        const res = await fetch('/api/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, caption, selectedImages })
        });
        const d = await res.json();
        const status = document.getElementById('save-status');
        status.style.display = 'inline';
        if (d.ok) { status.textContent = '✅ Đã lưu!'; status.style.color = '#2e7d32'; }
        else { status.textContent = '❌ Lỗi lưu!'; status.style.color = '#c62828'; }
        setTimeout(() => status.style.display = 'none', 3000);
      }
    </script>
    </body></html>`);
}
