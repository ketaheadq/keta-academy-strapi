# 🎓 Keta Academy - Strapi Backend

A high-performance Strapi 5 backend for Keta Academy, managing courses, interactive quizzes, and student learning progress.

---

## 🚀 Deployment (Docker & Ubuntu)

This project is optimized for deployment on Ubuntu servers using Docker Compose with a Supabase PostgreSQL backend.

### Standard Production Workflow
To deploy updates or perform a first-time setup:

```bash
# 1. Build and start (Zero Downtime Build)
docker compose up -d --build

# 2. To force a fresh build without cache
docker compose build --no-cache && docker compose up -d
```

### Advanced Operations
- **View Logs**: `docker compose logs -f`
- **Stop Services**: `docker compose down`
- **Shell Access**: `docker exec -it strapi sh`

---

## �️ Local Development

If you prefer to run Strapi natively for development:

1. **Install Dependencies**:
   ```bash
   yarn install
   ```
2. **Environment Setup**:
   Copy `.env.example` to `.env` and fill in your Supabase and Cloudinary credentials.
3. **Run Dev Server**:
   ```bash
   yarn run develop
   ```

---

## ️ Security & Performance

We prioritize security through several layers:

- **Non-Root Execution**: The Docker container runs under a dedicated `strapi` user rather than `root`.
- **Privilege Limitation**: `no-new-privileges:true` is set to prevent escalation attacks.
- **Resource Guarding**: CPU and Memory limits are enforced via Docker Compose to prevent server lockups.
- **Dependency Isolation**: Production builds are pruned of development tools and compilers.
- **Health Monitoring**: Integrated Docker healthchecks monitor service availability.

### 🔒 Vulnerability Management
*Current Status: Maintenance ongoing.*
As with all large Node.js projects, dependencies are regularly audited.
- **Internal Audit**: Run `yarn audit` locally to see details.
- **Automated Fixes**: We use `yarn audit fix` during the build pipeline where safe.

---

## ️ Roadmap & TODOs

### 🎯 High Priority
- [ ] **Automated Backups**: Implement daily scripts to back up the Supabase DB and local uploads.
- [ ] **Sentry Integration**: Add error tracking for the production environment.
- [ ] **Cache Layer**: Implement Redis for faster API responses on heavy course endpoints.

### ⚙️ Improvements
- [ ] **Unit Tests**: Add Jest suites for custom controllers and services.
- [ ] **Media Optimization**: Configure automated WebP conversion for all uploads via Cloudinary.
- [ ] **CI/CD Pipeline**: Set up GitHub Actions to auto-deploy to Ubuntu server on push to `main`.

### 🛠️ Maintenance
- [ ] **Dependency Update**: Keep Strapi 5 and its plugins on the latest stable versions.
- [ ] **Log Analytics**: Integrate with a logging service (like ELK or BetterStack) for better Ubuntu server monitoring.

---

<sub>🎓 Built for Keta Academy | Managed by Docker</sub>



---

## 📝 Deneme sınavları

Free mock exams that open a detailed report in exchange for a phone number. The PDF report opens on the site as soon as it is ready (usually within a minute), the request lands in the teacher's call list, and the teacher calls to discuss it. Plan: "KetaLearn – Deneme Sınavları Geliştirme Notu".

### Content types (admin panel)

| Type | What it holds |
|---|---|
| **Konu** | Topic names from the MEB curriculum (pick from this list, don't type free text). Linked to a Subject, Grades and the lesson videos that teach it (`Ders videoları`). |
| **Deneme Sınavı** | Title, slug, description, exam type (LGS/TYT/AYT/Okul), grade, subject, topics, duration, featured flag, questions, SEO. Draft & publish. |
| ↳ **Soru** (component) | Text, image, options (A, B, C, D, E in order), correct option, difficulty, topic, solution. |
| **Sınav Sonucu** | Answers, correct/wrong/blank, net, per-topic rates, source (UTM), anonymous session id. |
| **Rapor Talebi** | The call list: name, phone, relation, status, report link, net, weakest topics, source, consents, call notes, AI comment JSON (`Yapay zeka yorumu`, editable), optional teacher's note (`Hoca notu`), AI and e-mail errors, how often the report was opened. |
| **Anasayfa Slaytı** | Home page slides: image, title, text, button text, link, order, active. |

Existing content types are unchanged; the new types point to them (one-way relations).

### Flow

1. `GET /api/denemeler`, `GET /api/denemeler/:slug` — list and exam page. Questions are sent **without** the answer key, solutions or topics.
2. `POST /api/denemeler/:slug/sonuc` — scores the exam on the server. Returns correct/wrong/blank/net and a result key; per-topic results stay locked.
3. `POST /api/denemeler/rapor-talebi` — name + phone + relation + report consent (+ optional call consent) unlock the report. Max 3 requests per number per day.
4. In the background: wrong and blank questions (text, options, the student's answer, correct answer, solution) + weakest 2–3 topics → videos (lessons linked to the topic; else lessons whose title contains the topic name) → AI comment as JSON → teacher e-mail.
5. `GET /api/raporlar/:key/pdf` — the report PDF (unguessable key, no login). The site's `/rapor/<key>` link opens it; the request response returns the key, and the result screen waits for the report and shows the link. `?onizleme=1` doesn't count as an open. `GET /api/raporlar/:key` returns only what the parent-number page needs.
6. `POST /api/raporlar/:key/veli` — a student who left their own number adds a parent's number.
7. `GET /api/denemeler/ders-eslesme?dersler=…` — lesson → exam covering one of its topics (the "mini deneme" link on lesson pages).

### Teacher's panel

- **Admin home → "Deneme raporları ve arama listesi"** widget: counts, latest requests with "Raporu aç" / "Kaydı aç", and lessons that have no topic yet.
- **Rapor Talebi** entries: set `Durum`, add `Arama notları` (date + note), edit `Yapay zeka yorumu` (JSON) or add a `Hoca notu` (shown as a separate box in the PDF). "Raporu aç" in the widget opens the PDF preview.
- Edits to `Yapay zeka yorumu` or `Hoca notu` show up the next time the PDF is opened (it is built on each open).

### Setup

1. Copy the new variables from `.env.example` and fill them in (`OPENROUTER_API_KEY`, SMTP, WhatsApp number, `PUBLIC_SITE_URL`).
2. Rebuild: `docker compose up -d --build --force-recreate strapi`. Permissions are granted on start.
3. Add topics (Konu), link lesson videos to them, then create exams.

A missing key never crashes the app: the error is logged and stored on the request (`Yapay zeka hatası`, `Bildirim hatası`) so it shows in the panel.

### Alınan kararlar

Decisions the plan left open, taken as the simplest option:

- **Net:** correct − wrong ÷ (options − 1) per question (4 options → 3 wrong cancel 1 correct, 5 options → 4). Unanswered = blank.
- **Report delivery:** no SMS. After the form, the result screen waits for the PDF and shows "PDF raporunu aç" and "WhatsApp'ta paylaş" (to send the link to oneself or a parent). The phone number is for the teacher's call. Sales calls/messages need İYS consent. WhatsApp to the teacher is the `wa.me` link in the PDF.
- **PDF:** generated on request with `pdfkit` and the DejaVu Sans font (`dejavu-fonts-ttf`: Turkish letters and √, ², ⁻). Not stored; built from the saved report data each time. Includes question and option images (PNG/JPEG; others get a note). Lesson links carry `utm_source=rapor&utm_medium=pdf`, so visits from the PDF show up in Analytics.
- **AI's part:** it returns JSON only (general assessment, per-topic comments, a tip per wrong/blank question, a one-week plan, closing). Numbers, answers, solutions and links are placed by the template, never by the AI; links in its text are stripped, and topics/questions it invents are dropped. JSON mode: `response_format: json_object`; the reply is still validated against the expected shape.
- **No approval step:** the report opens right away with the AI comment. If the AI fails, it opens without the comment (scores, topics, question analysis and videos are still there); the teacher gets the error in the e-mail and the widget counts these, so a `Hoca notu` can be added.
- **Answers in the PDF:** the PDF shows the question text, correct answer and solution of every wrong/blank question (full analysis). If a PDF is shared, those answers are visible.
- **AI:** through [OpenRouter](https://openrouter.ai) with one key (`OPENROUTER_API_KEY`). Default model `deepseek/deepseek-v3.2` with reasoning off (a data-bound note needs no strong model); switch with `AI_MODEL` to any OpenRouter model id that supports JSON output (e.g. `google/gemini-2.5-flash`, `openai/gpt-4.1-mini`). Only exam data is sent (scores, topic rates, the text of wrong/blank questions with the answers); never name, phone or session id.
- **Video fallback:** a lesson matches a topic by title when it contains a 6-letter stem of a topic word of 4+ letters (e.g. "Denklem" → "denkle"). Max 2 videos per topic; only lessons that belong to a published course (the link opens the course page).
- **Students' numbers:** a request with relation "Öğrenci" is set to `Uygun değil` with a system note (minors aren't called for sales); the report asks for a parent's number. No call consent → also `Uygun değil`.
- **Thresholds:** "X öğrenci çözdü" from 50 results; rank among participants from 30 results.
- **Abuse limit:** max 3 report requests per phone number in 24 hours.
- **Retention:** a nightly job (03:30 Istanbul) deletes report requests and results older than `DENEME_RETENTION_DAYS` (default 365, minimum 90 so report links stay open at least 90 days). Have a lawyer confirm the period and the KVKK texts before launch.
- **Topics in the panel:** topics are linked to lessons from the Konu side (lessons themselves are unchanged), so "videos without a topic" are listed in the admin widget.

## 🤖 Soru yazarı API'si (deneme-yazari skill)

Lets Claude write mock exams: it reads the catalogue, draws question figures, uploads them and saves the exam as a **draft**. The teacher reviews and publishes it in the admin panel; the API can't publish.

- **Skill:** `.claude/skills/deneme-yazari/` (`SKILL.md` + the dependency-free CLI `scripts/keta.mjs`). Claude Code picks it up in this repo; for claude.ai, zip the folder and upload it as a skill.
- **Auth:** every route needs `x-soru-yazari-token: <SORU_YAZARI_TOKEN>`. Without the variable (or with fewer than 32 characters) the API answers 403. The token isn't a Strapi user, so keep it like an admin password.
- **CLI settings:** `KETA_API_URL` (Strapi root address, no `/api`) and `SORU_YAZARI_TOKEN`. Read from the shell, else from `--env <file>`, `KETA_ENV_FILE`, `ENV_PATH` or `./.env`. `node .claude/skills/deneme-yazari/scripts/keta.mjs ayarlar` shows which values are used and tests the connection.

| Route | What it does |
|---|---|
| `GET /api/soru-yazari/katalog` | Exam types, difficulties, subjects, grades, topics with their linked lessons and how many questions use each |
| `GET /api/soru-yazari/dersler?q=&konu=&kurs=&konusuz=1&icerik=1` | Lessons with courses and topics (`icerik=1`: lesson text) |
| `GET /api/soru-yazari/dersler/:documentId` | One lesson's full text |
| `GET /api/soru-yazari/denemeler?q=` | All exams, drafts included |
| `GET /api/soru-yazari/denemeler/:documentId` | One exam's draft with answers and solutions, in the format PUT accepts |
| `POST /api/soru-yazari/denemeler[?kontrol=1]` | Creates a draft exam (`kontrol=1`: validate only) |
| `PUT /api/soru-yazari/denemeler/:documentId[?kontrol=1]` | Replaces the exam's draft; the published version stays until the teacher publishes |
| `POST /api/soru-yazari/gorseller` | multipart `file` + `alt` → media id. SVG/WebP become PNG (the PDF can only draw PNG/JPEG); max 5 MB, longest side 1600 px |

The exam format uses slugs for grade/subject/topics, media ids for images and plain text for question and solution (one paragraph per line, `- ` for list items). Validation returns every problem at once as `{ hatalar: [{ yol, hata }] }`. Code: `src/api/soru-yazari/`, `src/soru-yazari/`.
