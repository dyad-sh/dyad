# Dyad - إصدار Cloudflare Pages

![Dyad Logo](assets/logo_transparent-BYgGL7ei.png)

**Dyad** هو منشئ تطبيقات الذكي الاصطناعي المحلي والمفتوح المصدر. سريع، آمن، ومحلي بالكامل - مثل Lovable أو v0 أو Bolt، لكن يعمل على جهازك مباشرة.

## 🌟 المزايا

- ⚡️ **محلي وسريع**: بدون اتصال بالإنترنت مطلوب للعمل الأساسي
- 🔒 **آمن وخاص**: بياناتك تبقى على جهازك
- 🛠 **مفاتيح API خاصة**: استخدم مفاتيحك الخاصة بدون قيود  
- 🎨 **محرر متقدم**: محرر Monaco بدعم لغات برمجة متعددة
- 🤖 **دعم AI متعدد**: OpenAI، Anthropic، Google، OpenRouter وأكثر
- 📱 **PWA**: يعمل كتطبيق ويب متقدم مع إمكانية التثبيت
- 🖥️ **متعدد المنصات**: يعمل على جميع أنظمة التشغيل

## 🚀 النشر السريع

### خيار 1: النشر عبر GitHub (مُوصى به)
**📋 دليل مفصل**: راجع [`GITHUB_CHECKLIST.md`](./GITHUB_CHECKLIST.md)

**طرق الرفع على GitHub:**
- **الأسهل**: [`GITHUB_PUSH_WINDOWS.bat`](./GITHUB_PUSH_WINDOWS.bat) (Windows)
- **مفصل**: [`GITHUB_PUSH_INSTRUCTIONS.sh`](./GITHUB_PUSH_INSTRUCTIONS.sh) (جميع الأنظمة)
- **سريع**: [`GITHUB_COMMANDS.md`](./GITHUB_COMMANDS.md) (أوامر للنسخ واللصق)

### خيار 2: النشر المباشر
1. اذهب إلى [Cloudflare Pages](https://dash.cloudflare.com/pages)
2. اضغط "Create a project" > "Upload assets"  
3. ارفع جميع ملفات هذا المجلد
4. اضغط "Deploy site"

### خيار 3: عبر Wrangler CLI
```bash
npx wrangler pages publish . --project-name=dyad-ai-app
```

## ⚙️ إعدادات متقدمة

### متغيرات البيئة (اختيارية)
أضف في إعدادات Cloudflare Pages لتفعيل ميزات AI:

```
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key  
GOOGLE_API_KEY=your_google_key
OPENROUTER_API_KEY=your_openrouter_key
```

### إعدادات KV (للإعدادات المستمرة)
```bash
wrangler kv:namespace create "SETTINGS_KV"
```

## 📁 هيكل الملفات

```
dyad-cloudflare-pages/
├── index.html              # الصفحة الرئيسية
├── manifest.webmanifest    # إعدادات PWA
├── sw.js                   # Service Worker
├── registerSW.js           # تسجيل Service Worker
├── _headers               # إعدادات HTTP headers
├── _redirects            # إعدادات التوجيه
├── robots.txt            # إعدادات محركات البحث
├── assets/               # الأصول الثابتة
├── icons/                # أيقونات التطبيق
└── .github/workflows/    # GitHub Actions

```

## 🔧 ميزات محسنة

- **تخزين مؤقت محسن**: أداء سريع مع تخزين ذكي
- **أمان محسن**: حماية إضافية من الهجمات
- **دعم PWA كامل**: يمكن تثبيته كتطبيق
- **تصميم متجاوب**: يعمل على جميع الأجهزة
- **دعم لغات متعددة**: أكثر من 100 لغة برمجة

## 🎯 الاستخدام

1. **ابدأ محادثة جديدة**: اكتب ما تريد بناءه
2. **اختر نموذج AI**: OpenAI، Anthropic، أو أي مزود آخر
3. **شاهد الكود ينبني**: يتم إنشاء الكود في الوقت الفعلي
4. **عدل وحسن**: استخدم المحرر المدمج للتعديل
5. **اختبر التطبيق**: معاينة مباشرة للنتيجة

## 📊 إحصائيات المشروع

- **الحجم**: ~50MB (مع جميع اللغات والثيمات)
- **وقت التحميل**: < 3 ثوان
- **دعم المتصفحات**: Chrome، Firefox، Safari، Edge
- **الترخيص**: MIT (مفتوح المصدر)

## 🛠 استكشاف الأخطاء

### مشاكل شائعة:

**الصفحة فارغة:**
- تحقق من `_redirects` file
- افحص Console للأخطاء

**PWA لا يعمل:**
- تأكد من HTTPS
- تحقق من `manifest.webmanifest`

**الخطوط لا تحميل:**
- تحقق من مسارات الملفات
- افحص Network tab

## 🔗 روابط مفيدة

- [المستودع الأصلي](https://github.com/dyad-sh/dyad)  
- [الموقع الرسمي](http://dyad.sh/)
- [وثائق Cloudflare Pages](https://developers.cloudflare.com/pages/)
- [دليل النشر المفصل](./CLOUDFLARE_DEPLOYMENT.md)

## 📝 الترخيص

هذا المشروع مرخص تحت رخصة MIT. راجع ملف LICENSE في المستودع الأصلي.

## 🤝 المساهمة  

المساهمات مرحب بها! راجع [دليل المساهمة](https://github.com/dyad-sh/dyad/blob/main/CONTRIBUTING.md) في المستودع الأصلي.

---

**مطور بواسطة:** [Will Chen](https://github.com/dyad-sh)  
**النسخة:** 0.6.0  
**آخر تحديث:** أغسطس 2025