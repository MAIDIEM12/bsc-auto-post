// api/approve.js — Xử lý khi chị bấm DUYỆT hoặc TỪ CHỐI trong email
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { token, action } = req.query;

  if (!token || !action) {
    return res.status(400).send("Thiếu thông tin");
  }

  try {
    // Lấy project từ KV store
    const project = await kv.get(`project:${token}`);
    if (!project) {
      return res.status(404).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;">
          <h2>❌ Không tìm thấy bài viết này</h2>
          <p>Bài đã được xử lý hoặc link đã hết hạn.</p>
        </body></html>
      `);
    }

    if (action === "approve") {
      // Cập nhật trạng thái
      await kv.set(`project:${token}`, { ...project, status: "approved", approvedAt: new Date().toISOString() });

      // Trả về trang thành công
      return res.status(200).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;background:#f0f9f0;">
          <div style="max-width:500px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1);">
            <div style="font-size:60px;">✅</div>
            <h2 style="color:#2e7d32;">Đã duyệt thành công!</h2>
            <p style="color:#555;">Bài viết <b>${project.folderName}</b> sẽ được đăng lên Fanpage Blue Sky Corporation đúng lịch.</p>
            <p style="color:#888;font-size:13px;">Bạn sẽ nhận email xác nhận sau khi bài được đăng.</p>
          </div>
        </body></html>
      `);
    }

    if (action === "reject") {
      await kv.set(`project:${token}`, { ...project, status: "rejected", rejectedAt: new Date().toISOString() });

      return res.status(200).send(`
        <html><body style="font-family:Arial;text-align:center;padding:50px;background:#fff0f0;">
          <div style="max-width:500px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.1);">
            <div style="font-size:60px;">❌</div>
            <h2 style="color:#c62828;">Đã từ chối</h2>
            <p style="color:#555;">Bài viết <b>${project.folderName}</b> sẽ không được đăng.</p>
            <p style="color:#888;font-size:13px;">Bạn có thể upload ảnh mới vào Drive để hệ thống xử lý lại.</p>
          </div>
        </body></html>
      `);
    }

  } catch (e) {
    return res.status(500).send("Lỗi hệ thống: " + e.message);
  }
}
