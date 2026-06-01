// api/cron.js — BSC Auto Post v3
// LUỒNG ĐÚNG: Quét Drive → AI tạo caption → Gửi 1 email duyệt/tháng
// Chị chỉ duyệt 1 LẦN cho cả batch 1-2 tháng → hệ thống tự rải lịch & đăng

import { Resend } from 'resend';
import { kv } from '@vercel/kv';

const resend = new Resend(process.env.RESEND_API_KEY);

const BRAND_TONES = {
  fmcg:       'FMCG / Tiêu dùng – vui tươi, gần gũi, đời thường',
  corporate:  'Doanh nghiệp B2B – chuyên nghiệp, trang trọng, số liệu rõ ràng',
  luxury:     'Luxury – sang trọng, tinh tế, ngôn ngữ chọn lọc',
  tech:       'Công nghệ – hiện đại, sáng tạo, ngắn gọn',
  event:      'Sự kiện / Event – sôi động, hào hứng, kêu gọi hành động',
  realestate: 'Bất động sản – uy tín, khát vọng, đầu tư dài hạn',
};

const POST_HOURS = [8, 10, 12, 15, 17, 20]; // Giờ vàng đăng bài

// ── Main handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = req.query.secret || req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Tham số tuỳ chọn: ?months=2 (mặc định 1 tháng)
  const months = parseInt(req.query.months) || 1;
  const forceRescan = req.query.force === 'true';

  try {
    // ── BƯỚC 1: Kiểm tra xem đã có batch đang chờ duyệt chưa ──────────────────
    const existingBatch = await kv.get('pending_batch');
    if (existingBatch && !forceRescan) {
      return res.status(200).json({
        ok: true,
        message: `Đã có batch ${existingBatch.batchId} đang chờ duyệt (${existingBatch.projects.length} bài). Thêm ?force=true để quét lại.`,
        batchId: existingBatch.batchId,
      });
    }

    // ── BƯỚC 2: Quét Drive lấy tất cả dự án/ảnh mới ──────────────────────────
    const logs = [];
    logs.push('🔍 Quét Google Drive...');
    const driveItems = await scanDriveFolders();
    logs.push(`Tìm thấy ${driveItems.length} folder`);

    if (driveItems.length === 0) {
      return res.status(200).json({ ok: true, logs, message: 'Không có folder nào' });
    }

    // ── BƯỚC 3: Lấy settings ──────────────────────────────────────────────────
    const settings = await kv.get('bsc_settings') || {};
    const tone     = settings.defaultTone || 'event';
    const agency   = settings.agencyName  || 'Blue Sky Corporation';
    const groqKey  = process.env.GROQ_API_KEY || '';

    // ── BƯỚC 4: AI tạo caption cho từng dự án ────────────────────────────────
    logs.push('🤖 AI đang tạo caption...');
    const projects = [];

    for (const item of driveItems) {
      const postId = `post_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      const captions = await genCaptions(item.name, tone, groqKey, {
        brand:     item.brand || item.name,
        program:   item.name,
        objective: item.objective || 'Tăng nhận diện thương hiệu',
        kpi:       item.kpi || '',
        region:    item.region || 'TP. Hồ Chí Minh',
        agency,
      });

      projects.push({
        postId,
        name:          item.name,
        tone,
        images:        item.images || [],
        captions,
        customCaption: captions.hook,
        status:        'pending_approval',
        createdAt:     new Date().toISOString(),
      });
      logs.push(`  ✅ ${item.name}`);
    }

    // ── BƯỚC 5: Tính lịch đăng rải đều trong X tháng ─────────────────────────
    logs.push(`📅 Rải lịch ${projects.length} bài trong ${months} tháng...`);
    const schedule = buildSchedule(projects.length, months);
    projects.forEach((p, i) => {
      p.scheduledAt = schedule[i].toISOString();
    });

    // ── BƯỚC 6: Lưu batch vào KV ─────────────────────────────────────────────
    const batchId  = `batch_${Date.now()}`;
    const batchData = {
      batchId,
      months,
      projects,
      createdAt:  new Date().toISOString(),
      status:     'pending_approval',
      totalPosts: projects.length,
      dateRange: {
        from: schedule[0].toLocaleDateString('vi-VN'),
        to:   schedule[schedule.length - 1].toLocaleDateString('vi-VN'),
      },
    };
    await kv.set('pending_batch', batchData);

    // ── BƯỚC 7: Gửi 1 email duy nhất để chị duyệt cả batch ───────────────────
    logs.push('📧 Gửi email duyệt batch...');
    await resend.emails.send({
      from: 'BSC Auto Post <onboarding@resend.dev>',
      to:   process.env.EMAIL_TO || 'maithidiem201090@gmail.com',
      subject: `[BSC] Duyệt ${projects.length} bài đăng ${months} tháng tới – ${new Date().toLocaleDateString('vi-VN')}`,
      html: buildBatchEmail(batchData, secret),
    });

    logs.push('✅ Hoàn thành!');
    return res.status(200).json({
      ok: true,
      logs,
      batchId,
      totalPosts: projects.length,
      months,
      dateRange: batchData.dateRange,
      message: `Email duyệt đã gửi — ${projects.length} bài rải đều trong ${months} tháng`,
    });

  } catch (err) {
    console.error('Cron error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ── Tính lịch đăng rải đều ────────────────────────────────────────────────────
function buildSchedule(count, months) {
  const schedule = [];
  const now      = new Date();
  const endDate  = new Date(now);
  endDate.setMonth(endDate.getMonth() + months);

  const totalMs   = endDate - now;
  const intervalMs = totalMs / count;

  // Không đăng 2 ngày liên tiếp nếu có nhiều bài — rải đều
  for (let i = 0; i < count; i++) {
    const date = new Date(now.getTime() + intervalMs * (i + 0.5));
    // Chọn giờ vàng gần nhất
    const hour = POST_HOURS[i % POST_HOURS.length];
    date.setHours(hour, 0, 0, 0);
    // Bỏ qua Chủ nhật
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    schedule.push(date);
  }
  return schedule;
}

// ── AI tạo caption bằng Groq ──────────────────────────────────────────────────
async function genCaptions(projectName, tone, groqKey, info) {
  const toneDesc = BRAND_TONES[tone] || BRAND_TONES.event;
  const agency   = info.agency || 'Blue Sky Corporation';

  const prompt = `Bạn là senior copywriter của ${agency}.
Thông tin dự án:
- Brand: ${info.brand || projectName}
- Chương trình: ${info.program || projectName}
- Mục tiêu: ${info.objective}
- KPI: ${info.kpi || 'chưa cập nhật'}
- Khu vực: ${info.region}
Phong cách: ${toneDesc}

Tạo 4 caption Facebook, trả về JSON:
{"hook":"...","story":"...","cta":"...","short":"..."}`;

  try {
    if (!groqKey) throw new Error('no key');
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${groqKey}` },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: prompt }], max_tokens: 2000 }),
    });
    const data = await r.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    const tag = (info.brand || projectName).replace(/\s+/g, '');
    return {
      hook:  `🔥 ${info.brand || projectName} x ${agency}!\n#${tag} #BlueSkyCorporation`,
      story: `✨ ${info.program || projectName} – Hành trình thực thi...\n#${tag}`,
      cta:   `📣 ${info.program || projectName} hoàn thành!\n#${tag} #BSC`,
      short: `🎉 ${info.program || projectName} Done!\n#${tag} #BSC`,
    };
  }
}

// ── Email batch ───────────────────────────────────────────────────────────────
function buildBatchEmail(batch, secret) {
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://bsc-auto-post.vercel.app';

  const approveAllUrl = `${base}/api/batch-approve?batchId=${batch.batchId}&action=approve_all&secret=${secret}`;
  const rejectAllUrl  = `${base}/api/batch-approve?batchId=${batch.batchId}&action=reject_all&secret=${secret}`;
  const dashUrl       = `${base}?secret=${secret}`;

  const projectRows = batch.projects.map((p, i) => `
    <tr style="border-bottom:1px solid #e2e8f0;">
      <td style="padding:10px 8px;font-size:13px;color:#1565c0;font-weight:600;">${i + 1}. ${p.name}</td>
      <td style="padding:10px 8px;font-size:12px;color:#475569;">
        ${new Date(p.scheduledAt).toLocaleString('vi-VN', { weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
      </td>
      <td style="padding:10px 8px;font-size:12px;color:#334155;max-width:300px;">
        ${(p.customCaption || '').substring(0, 80)}...
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;padding:20px;background:#f8fafc;">

  <div style="background:linear-gradient(135deg,#1565c0,#1877f2);border-radius:16px;padding:28px;margin-bottom:20px;color:white;text-align:center;">
    <div style="font-size:40px;margin-bottom:8px;">📅</div>
    <h1 style="margin:0;font-size:22px;font-weight:800;">BSC Auto Post — Duyệt batch ${batch.months} tháng</h1>
    <p style="margin:8px 0 0;opacity:.85;font-size:14px;">
      ${batch.totalPosts} bài · ${batch.dateRange.from} → ${batch.dateRange.to}
    </p>
  </div>

  <!-- Nút duyệt tất cả -->
  <div style="background:white;border-radius:14px;border:2px solid #22c55e;padding:20px 24px;margin-bottom:20px;text-align:center;">
    <div style="font-size:16px;font-weight:800;color:#166534;margin-bottom:6px;">
      ✅ Duyệt tất cả ${batch.totalPosts} bài — Đăng tự động trong ${batch.months} tháng tới
    </div>
    <div style="font-size:13px;color:#64748b;margin-bottom:16px;">
      Hệ thống sẽ tự rải lịch & đăng đúng giờ. Chị không cần làm gì thêm!
    </div>
    <a href="${approveAllUrl}" 
       style="display:inline-block;background:#22c55e;color:white;padding:14px 40px;border-radius:12px;font-weight:800;font-size:16px;text-decoration:none;">
      🚀 DUYỆT TẤT CẢ & LÊN LỊCH
    </a>
  </div>

  <!-- Bảng lịch đăng -->
  <div style="background:white;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:20px;">
    <div style="background:#f1f5f9;padding:14px 20px;font-weight:800;font-size:14px;color:#1565c0;border-bottom:1px solid #e2e8f0;">
      📋 Lịch đăng dự kiến (${batch.totalPosts} bài)
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:700;text-transform:uppercase;">Dự án</th>
          <th style="padding:10px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:700;text-transform:uppercase;">Giờ đăng</th>
          <th style="padding:10px 8px;font-size:11px;color:#64748b;text-align:left;font-weight:700;text-transform:uppercase;">Caption</th>
        </tr>
      </thead>
      <tbody>${projectRows}</tbody>
    </table>
  </div>

  <!-- Nút từ chối + Dashboard -->
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;">
    <a href="${dashUrl}" 
       style="background:#1565c0;color:white;padding:12px 24px;border-radius:10px;font-weight:700;font-size:13px;text-decoration:none;">
      📊 Xem Dashboard & Chỉnh sửa
    </a>
    <a href="${rejectAllUrl}" 
       style="background:#fee2e2;color:#991b1b;padding:12px 24px;border-radius:10px;font-weight:700;font-size:13px;text-decoration:none;">
      ❌ Từ chối tất cả
    </a>
  </div>

  <div style="text-align:center;color:#94a3b8;font-size:11px;">
    Blue Sky Corporation · BSC Auto Post · Duyệt 1 lần/tháng
  </div>
</body>
</html>`;
}

// ── Quét Drive (giữ nguyên logic cũ) ─────────────────────────────────────────
async function scanDriveFolders() {
  // Giữ nguyên code quét Drive từ file cron.js gốc của chị
  return [];
}
