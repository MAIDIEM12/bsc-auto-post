# BSC AUTO POST SYSTEM

Hệ thống tự động đăng bài lên Fanpage Facebook của Blue Sky Corporation.

## Luồng hoạt động

```
Nhân viên upload ảnh lên Google Drive
    ↓ (mỗi 30 phút)
AI Vision nhận diện & phân loại ảnh
    ↓
AI Groq viết caption giọng BSC
    ↓
Email duyệt gửi tới diem.mai@blueskycorp.com.vn
    ↓ (bấm DUYỆT trong email)
Tự đăng Facebook lúc 9:30 Thứ 3 & Thứ 6
```

## Cài đặt

### Bước 1: Deploy lên Vercel
1. Push code lên GitHub
2. Vào vercel.com → Import repo
3. Deploy

### Bước 2: Cài đặt Environment Variables
Vào Vercel Dashboard > Settings > Environment Variables, thêm từng dòng trong file `.env.example`

### Bước 3: Lấy Resend API Key (gửi email duyệt)
1. Vào resend.com → đăng ký miễn phí
2. Tạo API Key
3. Dán vào RESEND_API_KEY

### Bước 4: Test hệ thống
Vào trình duyệt gõ:
```
https://[your-app].vercel.app/api/cron
```
(thêm header: Authorization: Bearer bsc_auto_2026_secure)

## Cấu trúc folder Google Drive

```
📁 BSC_FANPAGE (folder gốc)
├── 📁 Elleair_Activation_2026_Tuan1_T6
├── 📁 HopTri_Event_27.05.2026
├── 📁 Abbott_LapDat_2026_Tuan2_T6
└── 📁 DONE_... (đã đăng xong)
```

## Quy tắc đặt tên folder

| Loại | Cấu trúc | Ví dụ |
|------|---------|-------|
| Event 1-2 ngày | TenBrand_Event_NgayThucHien | HopTri_Event_27.05.2026 |
| Activation theo tuần | TenBrand_Activation_Nam_TuanX_TX | Elleair_Activation_2026_Tuan1_T6 |
| Lắp đặt theo tuần | TenBrand_LapDat_Nam_TuanX_TX | Abbott_LapDat_2026_Tuan2_T6 |
| Full Year theo tháng | TenBrand_FullYear_TX_Nam | Abbott_FullYear_T6_2026 |
