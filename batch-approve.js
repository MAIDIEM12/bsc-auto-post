// api/batch-approve.js — Duyệt/từ chối cả batch 1 lần
import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const { batchId, action, secret } = req.query;

  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).send(errorPage('Unauthorized'));
  }

  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://bsc-auto-post.vercel.app';

  const batch = await kv.get('pending_batch');
  if (!batch || batch.batchId !== batchId) {
    return res.status(404).send(errorPage('Không tìm thấy batch hoặc đã được xử lý'));
  }

  // ── DUYỆT TẤT CẢ ──────────────────────────────────────────────────────────
  if (action === 'approve_all') {
    // Lưu từng bài vào KV với lịch đăng đã tính sẵn
    for (const post of batch.projects) {
      await kv.set(post.postId, {
        ...post,
        status: 'scheduled',
        approvedAt: new Date().toISOString(),
      });
      // Lưu vào danh sách schedule để publish.js xử lý
      await kv.set(`scheduled_${post.postId}`, {
        postId:      post.postId,
        scheduledAt: post.scheduledAt,
        status:      'scheduled',
      });
    }

    // Xóa pending batch
    await kv.del('pending_batch');
    await kv.set(`approved_batch_${batchId}`, {
      ...batch,
      status:     'approved',
      approvedAt: new Date().toISOString(),
    });

    return res.status(200).send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f0fdf4;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
  <div style="background:white;border-radius:20px;padding:40px;max-width:520px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,.1);text-align:center;">
    <div style="font-size:64px;margin-bottom:16px;">🚀</div>
    <h2 style="margin:0 0 12px;color:#166534;font-size:22px;">Đã duyệt ${batch.totalPosts} bài!</h2>
    <p style="color:#64748b;margin:0 0 8px;">Lịch đăng tự động trong <strong>${batch.months} tháng</strong></p>
    <div style="background:#f0fdf4;border-radius:10px;padding:14px;margin:16px 0;font-size:14px;color:#166534;font-weight:600;">
      📅 ${batch.dateRange.from} → ${batch.dateRange.to}
    </div>
    <p style="color:#64748b;font-size:13px;margin:0 0 24px;">
      Hệ thống sẽ tự đăng đúng giờ mỗi ngày.<br>
      <strong>Chị không cần làm gì thêm!</strong> 🎉
    </p>
    <a href="${base}?secret=${secret}" 
       style="display:inline-block;background:#1565c0;color:white;padding:14px 32px;border-radius:12px;font-weight:700;font-size:14px;text-decoration:none;">
      📊 Xem lịch đăng Dashboard
    </a>
  </div>
</body>
</html>`);
  }

  // ── TỪ CHỐI TẤT CẢ ────────────────────────────────────────────────────────
  if (action === 'reject_all') {
    await kv.del('pending_batch');
    return res.status(200).send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#fff8f8;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;">
  <div style="background:white;border-radius:20px;padding:40px;max-width:480px;width:100%;text-align:center;">
    <div style="font-size:64px;margin-bottom:16px;">🚫</div>
    <h2 style="color:#991b1b;">Đã từ chối toàn bộ batch</h2>
    <p style="color:#64748b;">Chạy lại cron để tạo batch mới.</p>
    <a href="${base}?secret=${secret}" style="color:#1565c0;font-weight:700;">Xem Dashboard</a>
  </div>
</body>
</html>`);
  }

  return res.status(400).send(errorPage('Action không hợp lệ'));
}

function errorPage(msg) {
  return `<html><body style="font-family:Arial;text-align:center;padding:60px"><h2>❌ ${msg}</h2></body></html>`;
}
