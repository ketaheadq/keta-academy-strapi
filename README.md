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
   npm install
   ```
2. **Environment Setup**:
   Copy `.env.example` to `.env` and fill in your Supabase and Cloudinary credentials.
3. **Run Dev Server**:
   ```bash
   npm run develop
   ```

---

## �️ Security & Performance

We prioritize security through several layers:

- **Non-Root Execution**: The Docker container runs under a dedicated `strapi` user rather than `root`.
- **Privilege Limitation**: `no-new-privileges:true` is set to prevent escalation attacks.
- **Resource Guarding**: CPU and Memory limits are enforced via Docker Compose to prevent server lockups.
- **Dependency Isolation**: Production builds are pruned of development tools and compilers.
- **Health Monitoring**: Integrated Docker healthchecks monitor service availability.

### 🔒 Vulnerability Management
*Current Status: Maintenance ongoing.*
As with all large Node.js projects, dependencies are regularly audited. 
- **Internal Audit**: Run `npm audit` locally to see details.
- **Automated Fixes**: We use `npm audit fix` during the build pipeline where safe.

---

## �️ Roadmap & TODOs

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

