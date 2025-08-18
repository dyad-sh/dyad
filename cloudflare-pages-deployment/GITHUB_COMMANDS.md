# 🚀 أوامر رفع Dyad على GitHub - للنسخ واللصق

## إعداد Git (مرة واحدة فقط)
```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

## إنشاء مستودع GitHub
1. اذهب إلى: https://github.com/new
2. Repository name: `dyad-cloudflare-pages`
3. اختر: Public
4. اضغط: Create repository

## رفع الملفات (النسخ واللصق)
```bash
# انتقل لمجلد المشروع
cd dyad-cloudflare-pages

# إعداد Git
git init
git add .
git commit -m "Initial Dyad deployment for Cloudflare Pages"

# ربط المستودع (استبدل USERNAME باسم المستخدم)
git remote add origin https://github.com/USERNAME/dyad-cloudflare-pages.git
git branch -M main
git push -u origin main
```

## بديل أسرع - GitHub CLI
```bash
# تثبيت من: https://cli.github.com
gh auth login
cd dyad-cloudflare-pages
gh repo create dyad-cloudflare-pages --public --source=. --remote=origin --push
```

## ربط Cloudflare Pages
1. https://dash.cloudflare.com/pages
2. Create a project → Connect to Git
3. اختر مستودع `dyad-cloudflare-pages`
4. Framework preset: None
5. Build output directory: `/`
6. Save and Deploy

## حل مشاكل شائعة
- **كلمة مرور مطلوبة**: استخدم Personal Access Token بدلاً من كلمة المرور
- **git push فشل**: تأكد من صحة اسم المستودع ومن وجود الصلاحيات
- **ملفات مفقودة**: تأكد من نسخ جميع الملفات بما فيها `.github/`

## روابط مفيدة
- تحميل Git: https://git-scm.com
- GitHub Desktop: https://desktop.github.com  
- GitHub CLI: https://cli.github.com
- Cloudflare Pages: https://dash.cloudflare.com/pages