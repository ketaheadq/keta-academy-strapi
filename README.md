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

Free mock exams that open a detailed report in exchange for a phone number. The report goes to that number by SMS, the request lands in the teacher's call list, and the teacher calls to discuss it. Plan: "KetaLearn – Deneme Sınavları Geliştirme Notu".

### Content types (admin panel)

| Type | What it holds |
|---|---|
| **Konu** | Topic names from the MEB curriculum (pick from this list, don't type free text). Linked to a Subject, Grades and the lesson videos that teach it (`Ders videoları`). |
| **Deneme Sınavı** | Title, slug, description, exam type (LGS/TYT/AYT/Okul), grade, subject, topics, duration, featured flag, questions, SEO. Draft & publish. |
| ↳ **Soru** (component) | Text, image, options (A, B, C, D, E in order), correct option, difficulty, topic, solution. |
| **Sınav Sonucu** | Answers, correct/wrong/blank, net, per-topic rates, source (UTM), anonymous session id. |
| **Rapor Talebi** | The call list: name, phone, relation, status, report link, net, weakest topics, source, consents, call notes, report text (editable), teacher approval, SMS status and errors. |
| **Anasayfa Slaytı** | Home page slides: image, title, text, button text, link, order, active. |

Existing content types are unchanged; the new types point to them (one-way relations).

### Flow

1. `GET /api/denemeler`, `GET /api/denemeler/:slug` — list and exam page. Questions are sent **without** the answer key, solutions or topics.
2. `POST /api/denemeler/:slug/sonuc` — scores the exam on the server. Returns correct/wrong/blank/net and a result key; per-topic results stay locked.
3. `POST /api/denemeler/rapor-talebi` — name + phone + relation + report consent (+ optional call consent) unlock the report. Max 3 requests per number per day.
4. In the background: weakest 2–3 topics → videos (lessons linked to the topic; else lessons whose title contains the topic name) → AI comment → link check → teacher e-mail.
5. `GET /api/raporlar/:key` — public report page data (unguessable key, no login). `?onizleme=1` doesn't count as an open.
6. `POST /api/raporlar/:key/veli` — a student who left their own number adds a parent's number.
7. `GET /api/denemeler/ders-eslesme?dersler=…` — lesson → exam covering one of its topics (the "mini deneme" link on lesson pages).

### Teacher's panel

- **Admin home → "Deneme raporları ve arama listesi"** widget: counts, latest requests with "Raporu aç" / "Kaydı aç", and lessons that have no topic yet.
- **Rapor Talebi** entries: set `Durum`, add `Arama notları` (date + note), edit `Rapor metni`.
- **Approving a report:** tick `Hoca onayı` and save → the SMS is sent. A failed SMS (`Hata`) is retried on the next approved save.

### Setup

1. Copy the new variables from `.env.example` and fill them in (`DEEPSEEK_API_KEY` or another provider's key, Netgsm, SMTP, WhatsApp number, `PUBLIC_SITE_URL`).
2. Netgsm: an API user and an approved sender name (`NETGSM_MSGHEADER`).
3. Rebuild: `docker compose up -d --build --force-recreate strapi`. Permissions are granted on start.
4. Add topics (Konu), link lesson videos to them, then create exams.

A missing key never crashes the app: the error is logged and stored on the request (`Yapay zeka hatası`, `Gönderim hatası`, `Bildirim hatası`) so it shows in the panel.

### Alınan kararlar

Decisions the plan left open, taken as the simplest option:

- **Net:** correct − wrong ÷ (options − 1) per question (4 options → 3 wrong cancel 1 correct, 5 options → 4). Unanswered = blank.
- **Report delivery:** SMS (Netgsm REST v2) with `iysfilter: "0"` (informational: a report the person asked for). Sales calls/messages need İYS consent and are separate. WhatsApp is only the `wa.me` button on the report.
- **Approval:** the first 30 sent reports need `Hoca onayı`; after that reports go out automatically, and about 10% are flagged `Örnek kontrol` for spot checks. A report whose AI comment failed or contains a link outside the system's list is never sent automatically; it waits for the teacher.
- **AI:** default `deepseek` / `deepseek-flash` with thinking off (a short, data-bound note needs no strong model). Others, via `AI_PROVIDER`: `anthropic` (`claude-haiku-5-5`, low effort), `gemini` (`gemini-2.5-flash`), `openai` (`gpt-4.1-mini`); override the model with `AI_MODEL`. Only net, topic rates and the selected videos are sent; never name, phone or session id.
- **Video fallback:** a lesson matches a topic by title when it contains a 6-letter stem of a topic word of 4+ letters (e.g. "Denklem" → "denkle"). Max 2 videos per topic; only lessons that belong to a published course (the link opens the course page).
- **Students' numbers:** a request with relation "Öğrenci" is set to `Uygun değil` with a system note (minors aren't called for sales); the report asks for a parent's number. No call consent → also `Uygun değil`.
- **Thresholds:** "X öğrenci çözdü" from 50 results; rank among participants from 30 results.
- **Abuse limit:** max 3 report requests per phone number in 24 hours.
- **Retention:** a nightly job (03:30 Istanbul) deletes report requests and results older than `DENEME_RETENTION_DAYS` (default 365, minimum 90 so report links stay open at least 90 days). Have a lawyer confirm the period and the KVKK texts before launch.
- **Topics in the panel:** topics are linked to lessons from the Konu side (lessons themselves are unchanged), so "videos without a topic" are listed in the admin widget.
