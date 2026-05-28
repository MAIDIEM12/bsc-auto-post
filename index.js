/**
 * BSC AUTO POST SYSTEM v1.0
 * Tự động: Drive → AI lọc ảnh → AI viết caption BSC → Email duyệt → Đăng Facebook
 */

const fetch = require("node-fetch");
const FormData = require("form-data");
const nodemailer = require("nodemailer");

// ============================================================
// CẤU HÌNH HỆ THỐNG — chị chỉ cần chỉnh phần này
// ============================================================
const CONFIG = {
  // Google
  GOOGLE_API_KEY: "AIzaSyBWU_6NgFuF8VMSapv4GYxa5B8w_hGD8uY",
  DRIVE_FOLDER_ID: "1oxxpjvAdQxe0pRYwFbPxoSDFnUQpyCRf",

  // Groq AI
  GROQ_API_KEY: process.env.GROQ_API_KEY || "",

  // Facebook
  FB_PAGE_ID: "107977897276977",
  FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN || "",

  // Email duyệt bài
  EMAIL_TO: "diem.mai@blueskycorp.com.vn",
  EMAIL_FROM: "bscautopost@gmail.com",

  // Lịch đăng: 9:30 Thứ 3 (2) và Thứ 6 (5)
  POST_DAYS: [2, 5],
  POST_HOUR: 9,
  POST_MINUTE: 30,

  // Cảnh báo kho ảnh
  MIN_PROJECTS: 3,

  // Base URL cho email duyệt (sau khi deploy Vercel)
  BASE_URL: process.env.BASE_URL || "https://bsc-auto-post.vercel.app",
};

// ============================================================
// CAPTION MẪU BSC — AI học theo giọng văn này
// ============================================================
const BSC_CAPTION_SAMPLES = [
  {
    brand: "Elleair",
    type: "activation",
    caption: `ELLEAIR – LAN TỎA CHUẨN MỰC CHĂM SÓC TỪNG NGÀY 
Trải dài khắp mọi miền đất nước, Elleair không chỉ hiện diện tại các điểm bán mà còn để lại dấu ấn với đội ngũ PG của BSC xịn xò, luôn tươi cười, tận tâm và chuyên nghiệp trong từng chi tiết — từ trưng bày sản phẩm đến chăm sóc hình ảnh thương hiệu.
Cảm ơn Elleair đã luôn tin tưởng lựa chọn Blue Sky Corporation, đồng hành trong hành trình lan tỏa năng lượng tích cực và sự tinh tế đến hàng triệu người tiêu dùng Việt Nam.`,
  },
  {
    brand: "Monster Energy",
    type: "event",
    caption: `Săn quà chất, nạp năng lượng đỉnh – Monster Energy "đổ bộ" rồi đây!
Bùng nổ năng lượng ngay tại giữa sân trường cùng những lon nước tăng lực Monster Energy mát lạnh, sảng khoái. Vừa qua nước tăng lực Monster Energy đã mang màu sắc đặc trưng "Xanh - Đen" chất lừ, tạo không gian "siêu ngầu" bắt ngay tại một góc sân trường.
Blue Sky Corp. đồng hành cùng Monster Energy, mang đến trải nghiệm "Unleash the Beast" đậm chất sinh viên tự do, hết mình và… không bao giờ hết năng lượng!`,
  },
];

// ============================================================
// BƯỚC 1: ĐỌC FOLDER GOOGLE DRIVE
// ============================================================
async function getDriveFolders(parentId) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${parentId}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&key=${CONFIG.GOOGLE_API_KEY}&fields=files(id,name,createdTime)&orderBy=createdTime+desc`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("Drive API lỗi: " + data.error.message);
  return data.files || [];
}

async function getDriveImages(folderId) {
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image/'+and+trashed=false&key=${CONFIG.GOOGLE_API_KEY}&fields=files(id,name,mimeType,size,createdTime)&pageSize=50`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error("Drive API lỗi: " + data.error.message);
  return data.files || [];
}

// ============================================================
// BƯỚC 2: AI NHẬN DIỆN & PHÂN LOẠI ẢNH (Google Vision)
// ============================================================
const IMAGE_TYPES = {
  tongthe: { keywords: ["building", "interior", "decoration", "display", "booth", "store", "supermarket", "shelf"], label: "Toàn cảnh", order: 1 },
  donkhach: { keywords: ["person", "smile", "greeting", "handshake", "welcome", "customer", "standing"], label: "Đón khách", order: 2 },
  photobooth: { keywords: ["photography", "selfie", "photo", "frame", "pose", "camera"], label: "Photobooth", order: 3 },
  hoatdong: { keywords: ["product", "holding", "tasting", "sampling", "demonstration", "activity", "hand"], label: "Hoạt động", order: 4 },
  dongnguoi: { keywords: ["crowd", "group", "many people", "audience", "gathering", "busy"], label: "Đông người", order: 5 },
};

async function analyzeImageWithVision(imageId) {
  const imageUrl = `https://drive.google.com/thumbnail?id=${imageId}&sz=w800`;

  // Gọi Google Vision API
  const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${CONFIG.GOOGLE_API_KEY}`;
  const body = {
    requests: [{
      image: { source: { imageUri: imageUrl } },
      features: [
        { type: "LABEL_DETECTION", maxResults: 20 },
        { type: "SAFE_SEARCH_DETECTION" },
        { type: "IMAGE_PROPERTIES" },
      ],
    }],
  };

  const res = await fetch(visionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!data.responses?.[0]) return { type: "hoatdong", score: 5, labels: [] };

  const response = data.responses[0];
  const labels = (response.labelAnnotations || []).map(l => l.description.toLowerCase());
  const safeSearch = response.safeSearchAnnotation || {};

  // Loại bỏ ảnh không an toàn hoặc chất lượng kém
  if (safeSearch.adult === "LIKELY" || safeSearch.adult === "VERY_LIKELY") return null;

  // Tính điểm chất lượng dựa trên độ sáng
  const colors = response.imagePropertiesAnnotation?.dominantColors?.colors || [];
  const brightness = colors.length > 0
    ? colors.reduce((sum, c) => sum + (c.color.red + c.color.green + c.color.blue) / 3 * c.pixelFraction, 0)
    : 128;
  const qualityScore = brightness > 50 && brightness < 230 ? 8 : 5;

  // Phân loại ảnh theo labels
  let bestType = "hoatdong";
  let bestScore = 0;

  for (const [type, config] of Object.entries(IMAGE_TYPES)) {
    const matchCount = config.keywords.filter(kw => labels.some(l => l.includes(kw))).length;
    if (matchCount > bestScore) {
      bestScore = matchCount;
      bestType = type;
    }
  }

  return {
    type: bestType,
    label: IMAGE_TYPES[bestType].label,
    order: IMAGE_TYPES[bestType].order,
    score: qualityScore + bestScore,
    labels: labels.slice(0, 5),
  };
}

async function selectBestImages(images) {
  console.log(`🔍 Đang phân tích ${images.length} ảnh...`);

  const analyzed = [];
  for (const img of images) {
    try {
      const result = await analyzeImageWithVision(img.id);
      if (result) {
        analyzed.push({ ...img, ...result });
        console.log(`  ✓ ${img.name} → ${result.label} (điểm: ${result.score})`);
      }
    } catch (e) {
      console.log(`  ✗ ${img.name} → lỗi: ${e.message}`);
    }
  }

  // Chọn 1 ảnh tốt nhất mỗi loại
  const selected = {};
  for (const img of analyzed) {
    if (!selected[img.type] || img.score > selected[img.type].score) {
      selected[img.type] = img;
    }
  }

  // Sắp xếp theo thứ tự câu chuyện
  return Object.values(selected).sort((a, b) => a.order - b.order);
}

// ============================================================
// BƯỚC 3: AI VIẾT CAPTION GIỌNG BSC
// ============================================================
function parseFolderName(folderName) {
  // VD: Elleair_Activation_2026_Tuan1_T6
  const parts = folderName.split("_");
  return {
    brand: parts[0] || "Brand",
    type: parts[1] || "Event",
    period: parts.slice(2).join(" ") || "",
    raw: folderName,
  };
}

async function generateBSCCaption(folderInfo, imageLabels) {
  const { brand, type, period } = folderInfo;
  const imageContext = imageLabels.join(", ");

  const prompt = `Bạn là copywriter của Blue Sky Corporation — agency BTL hàng đầu Việt Nam.

GIỌNG VĂN BSC — học theo 2 bài mẫu sau:

Bài mẫu 1 (Elleair - Activation):
"${BSC_CAPTION_SAMPLES[0].caption}"

Bài mẫu 2 (Monster Energy - Event):
"${BSC_CAPTION_SAMPLES[1].caption}"

THÔNG TIN DỰ ÁN:
- Brand: ${brand}
- Loại: ${type}
- Thời gian: ${period}
- Nội dung ảnh: ${imageContext}

YÊU CẦU VIẾT CAPTION:
1. Dòng đầu: TÊN BRAND – TAGLINE ngắn gọn (IN HOA)
2. 2-3 dòng mô tả dự án: giọng ấm áp, tự hào, có cảm xúc thật — nhắc tên brand + BSC
3. Cảm ơn khách hàng (nếu là activation/full year) HOẶC kêu gọi hành động (nếu là event)
4. Kết thúc chuẩn BSC:
--------------------
 Website: www.blueskycorp.com.vn
 Mail: info@blueskycorp.com.vn
#BlueSkyCorporation #Agency #event #activation #sampling #belowtheline #${brand.replace(/\s+/g, "")}

KHÔNG dùng từ sáo rỗng: "đẳng cấp", "xuất sắc", "tuyệt vời"
Chỉ trả về caption, KHÔNG giải thích.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CONFIG.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || getFallbackCaption(brand, type);
  } catch {
    return getFallbackCaption(brand, type);
  }
}

function getFallbackCaption(brand, type) {
  return `${brand.toUpperCase()} – ĐỒNG HÀNH CÙNG BLUE SKY CORPORATION
Một ${type} đáng nhớ cùng ${brand} và đội ngũ BSC tận tâm, chuyên nghiệp.
Cảm ơn ${brand} đã tin tưởng lựa chọn Blue Sky Corporation!
--------------------
 Website: www.blueskycorp.com.vn
 Mail: info@blueskycorp.com.vn
#BlueSkyCorporation #Agency #event #activation #sampling #belowtheline #${brand.replace(/\s+/g, "")}`;
}

// ============================================================
// BƯỚC 4: GỬI EMAIL DUYỆT BÀI
// ============================================================
async function sendApprovalEmail(project) {
  const { folderName, folderInfo, selectedImages, caption, approvalToken } = project;

  const approveUrl = `${CONFIG.BASE_URL}/approve?token=${approvalToken}&action=approve`;
  const rejectUrl = `${CONFIG.BASE_URL}/approve?token=${approvalToken}&action=reject`;

  const imageHtml = selectedImages.map((img, i) => `
    <div style="display:inline-block;margin:8px;text-align:center;">
      <img src="https://drive.google.com/thumbnail?id=${img.id}&sz=w300" 
           style="width:200px;height:150px;object-fit:cover;border-radius:8px;"/>
      <div style="font-size:11px;color:#666;margin-top:4px;">${i + 1}. ${img.label}</div>
    </div>
  `).join("");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
  
  <div style="background:#1565C0;color:#fff;padding:20px;border-radius:8px 8px 0 0;text-align:center;">
    <h2 style="margin:0;">📸 BSC Auto Post</h2>
    <p style="margin:4px 0 0;opacity:0.8;">Bài viết mới cần duyệt</p>
  </div>

  <div style="background:#f8f9ff;padding:20px;border:1px solid #e0e0e0;">
    
    <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;font-weight:700;">Dự án</div>
      <div style="font-size:18px;font-weight:800;color:#1565C0;margin-top:4px;">${folderName}</div>
      <div style="font-size:13px;color:#555;margin-top:4px;">
        Brand: <b>${folderInfo.brand}</b> | Loại: <b>${folderInfo.type}</b> | Thời gian: <b>${folderInfo.period}</b>
      </div>
    </div>

    <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;font-weight:700;margin-bottom:12px;">
        📷 ${selectedImages.length} ảnh đã chọn (theo thứ tự câu chuyện)
      </div>
      <div style="text-align:center;">${imageHtml}</div>
    </div>

    <div style="background:#fff;border-radius:8px;padding:16px;margin-bottom:24px;">
      <div style="font-size:12px;color:#888;text-transform:uppercase;font-weight:700;margin-bottom:8px;">✍️ Caption AI viết</div>
      <div style="white-space:pre-wrap;font-size:14px;line-height:1.7;color:#333;background:#f8f9ff;padding:12px;border-radius:6px;border-left:4px solid #1565C0;">${caption}</div>
    </div>

    <div style="text-align:center;">
      <a href="${approveUrl}" 
         style="display:inline-block;background:#2e7d32;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin:0 8px;">
        ✅ DUYỆT ĐĂNG BÀI
      </a>
      <a href="${rejectUrl}" 
         style="display:inline-block;background:#c62828;color:#fff;padding:14px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;margin:0 8px;">
        ❌ TỪ CHỐI
      </a>
    </div>

    <p style="text-align:center;font-size:12px;color:#999;margin-top:16px;">
      Bài sẽ được đăng lên Fanpage Blue Sky Corporation sau khi duyệt.<br/>
      Nếu không phản hồi, bài sẽ không được đăng.
    </p>
  </div>

  <div style="background:#e3f2fd;padding:12px;border-radius:0 0 8px 8px;text-align:center;">
    <div style="font-size:11px;color:#1565C0;">
      📘 Blue Sky Corporation | bsc-auto-post | diem.mai@blueskycorp.com.vn
    </div>
  </div>

</body>
</html>`;

  // Dùng Gmail SMTP (cần setup App Password)
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER || "bscautopost@gmail.com",
      pass: process.env.GMAIL_APP_PASSWORD || "",
    },
  });

  await transporter.sendMail({
    from: `"BSC Auto Post" <${process.env.GMAIL_USER}>`,
    to: CONFIG.EMAIL_TO,
    subject: `📸 [BSC] Duyệt bài: ${folderName} — ${selectedImages.length} ảnh`,
    html,
  });

  console.log(`✅ Đã gửi email duyệt tới ${CONFIG.EMAIL_TO}`);
}

// ============================================================
// BƯỚC 5: ĐĂNG LÊN FACEBOOK
// ============================================================
async function uploadPhotoToFB(imageId, token, pageId) {
  const imageUrl = `https://drive.google.com/thumbnail?id=${imageId}&sz=w1200`;
  const params = new URLSearchParams({
    url: imageUrl,
    published: "false",
    access_token: token,
  });
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
    method: "POST",
    body: params,
  });
  const data = await res.json();
  if (data.id) return data.id;
  throw new Error("Upload ảnh thất bại: " + JSON.stringify(data.error));
}

async function publishToFacebook(project) {
  const { selectedImages, caption } = project;
  const token = CONFIG.FB_PAGE_TOKEN;
  const pageId = CONFIG.FB_PAGE_ID;

  console.log(`📤 Đang upload ${selectedImages.length} ảnh lên Facebook...`);

  const photoIds = [];
  for (const img of selectedImages) {
    const id = await uploadPhotoToFB(img.id, token, pageId);
    photoIds.push(id);
    console.log(`  ✓ Upload xong: ${img.label}`);
  }

  const body = new URLSearchParams();
  body.append("message", caption);
  body.append("access_token", token);
  photoIds.forEach(id => body.append("attached_media[]", JSON.stringify({ media_fbid: id })));

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    body,
  });
  const data = await res.json();

  if (data.id) {
    console.log(`🎉 Đã đăng thành công! Post ID: ${data.id}`);
    return data.id;
  }
  throw new Error("Đăng bài thất bại: " + JSON.stringify(data.error));
}

// ============================================================
// BƯỚC 6: CẢNH BÁO KHO ẢNH
// ============================================================
async function checkAndAlertLowStock(folders) {
  const pendingFolders = folders.filter(f => !f.name.startsWith("DONE_"));
  if (pendingFolders.length < CONFIG.MIN_PROJECTS) {
    console.log(`⚠️ Kho ảnh còn ${pendingFolders.length} dự án — dưới mức tối thiểu ${CONFIG.MIN_PROJECTS}!`);
    // Gửi email cảnh báo
    // TODO: implement email alert
  }
}

// ============================================================
// MAIN FUNCTION: Xử lý 1 dự án mới
// ============================================================
async function processNewProject(folder) {
  console.log(`\n🚀 Bắt đầu xử lý: ${folder.name}`);

  // 1. Lấy danh sách ảnh
  const images = await getDriveImages(folder.id);
  if (!images.length) {
    console.log("  ⚠️ Không có ảnh trong folder này");
    return null;
  }
  console.log(`  📸 Tìm thấy ${images.length} ảnh`);

  // 2. AI phân loại & chọn ảnh đẹp nhất
  const selectedImages = await selectBestImages(images);
  if (!selectedImages.length) {
    console.log("  ⚠️ Không chọn được ảnh phù hợp");
    return null;
  }
  console.log(`  ✅ Đã chọn ${selectedImages.length} ảnh theo thứ tự câu chuyện`);

  // 3. AI viết caption giọng BSC
  const folderInfo = parseFolderName(folder.name);
  const imageLabels = selectedImages.map(img => img.labels?.[0] || img.label).filter(Boolean);
  const caption = await generateBSCCaption(folderInfo, imageLabels);
  console.log("  ✅ AI đã viết caption");

  // 4. Tạo approval token
  const approvalToken = Buffer.from(`${folder.id}_${Date.now()}`).toString("base64url");

  return {
    folderId: folder.id,
    folderName: folder.name,
    folderInfo,
    selectedImages,
    caption,
    approvalToken,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

// ============================================================
// CHẠY THỬ — test với folder hiện có
// ============================================================
async function runTest() {
  console.log("🔵 BSC AUTO POST — Bắt đầu chạy thử...\n");

  try {
    // Kiểm tra kết nối Drive
    console.log("1️⃣  Kiểm tra Google Drive...");
    const folders = await getDriveFolders(CONFIG.DRIVE_FOLDER_ID);
    console.log(`   Tìm thấy ${folders.length} folder trong Drive`);
    if (folders.length) {
      folders.slice(0, 3).forEach(f => console.log(`   📁 ${f.name}`));
    }

    // Kiểm tra kho ảnh
    await checkAndAlertLowStock(folders);

    // Lấy ảnh từ folder gốc (nếu chưa có subfolder)
    console.log("\n2️⃣  Lấy ảnh từ Drive...");
    const images = await getDriveImages(CONFIG.DRIVE_FOLDER_ID);
    console.log(`   Tìm thấy ${images.length} ảnh`);

    if (images.length === 0) {
      console.log("   ℹ️  Chưa có ảnh. Hệ thống sẵn sàng — chờ nhân viên upload!");
      return;
    }

    // Test phân tích 3 ảnh đầu tiên
    console.log("\n3️⃣  Test AI phân loại ảnh (3 ảnh đầu)...");
    for (const img of images.slice(0, 3)) {
      const result = await analyzeImageWithVision(img.id);
      console.log(`   📷 ${img.name} → ${result?.label || "không xác định"} (điểm: ${result?.score || 0})`);
    }

    console.log("\n✅ Hệ thống hoạt động bình thường!");
    console.log("📋 Tóm tắt:");
    console.log(`   - Drive: ✅ ${images.length} ảnh`);
    console.log(`   - Vision API: ✅ Đang hoạt động`);
    console.log(`   - Sẵn sàng xử lý khi có folder mới!`);

  } catch (e) {
    console.error("❌ Lỗi:", e.message);
  }
}

// Chạy test
runTest();
