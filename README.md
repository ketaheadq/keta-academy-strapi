# 🎓 Keta Academy - Strapi Backend

A comprehensive Strapi-based content management system for Keta Academy, an educational platform that manages courses, lessons, units, quizzes, and student progress tracking.

## 📋 Features

- **Course Management**: Create and manage educational courses with structured content
- **Lesson & Unit Organization**: Hierarchical content organization with lessons and units
- **Quiz System**: Interactive quizzes with progress tracking
- **Progress Tracking**: Monitor student progress across courses, lessons, units, and quizzes
- **User Management**: Built-in user authentication and permissions
- **Content API**: RESTful API endpoints for frontend integration
- **Cloudinary Integration**: Cloud-based media management
- **PostgreSQL Database**: Robust data storage with Docker support

## 🚀 Quick Start

### Prerequisites

- Node.js (>=18.0.0 <=22.x.x)
- npm (>=6.0.0)
- Docker & Docker Compose (for database)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd keta-academy-strapi
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the database**
   ```bash
   docker-compose up -d
   ```

4. **Start the development server**
   ```bash
   npm run develop
   ```

5. **Access the admin panel**
   - Open your browser and navigate to `http://localhost:1337/admin`
   - Create your first administrator account

## 📚 Available Commands

### Development

```bash
npm run develop
# or
yarn develop
```

Start your Strapi application with autoReload enabled for development.

### Production

```bash
npm run start
# or
yarn start
```

Start your Strapi application with autoReload disabled for production.

### Build

```bash
npm run build
# or
yarn build
```

Build your admin panel for production deployment.

### Console

```bash
npm run console
# or
yarn console
```

Access the Strapi console for debugging and management tasks.

## 🗄️ Database Configuration

The project uses PostgreSQL as the primary database. The database configuration is set up via Docker Compose:

- **Host**: localhost
- **Port**: 5433
- **Database**: strapi
- **Username**: strapi
- **Password**: strapi

## 📊 Content Types

The API includes the following content types:

- **Course**: Main educational courses
- **Unit**: Course sections and modules
- **Lesson**: Individual learning units
- **Quiz**: Interactive assessments
- **Progress Tracking**:
  - User Course Progress
  - Unit Progress
  - Lesson Progress
  - Quiz Progress
- **Settings**: Platform configuration
- **Contact Page**: Contact information management

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
HOST=0.0.0.0
PORT=1337
APP_KEYS=your-app-keys
API_TOKEN_SALT=your-api-token-salt
ADMIN_JWT_SECRET=your-admin-jwt-secret
JWT_SECRET=your-jwt-secret
```

### Database Configuration

The database configuration is handled through Strapi's configuration files in the `config/` directory.

## 🚀 Deployment

### Using Strapi Cloud

```bash
yarn strapi deploy
```

### Manual Deployment

1. Build the application:
   ```bash
   npm run build
   ```

2. Start the production server:
   ```bash
   npm run start
   ```

For more deployment options, check the [Strapi deployment documentation](https://docs.strapi.io/dev-docs/deployment).

## 🔌 Plugins

This project includes the following Strapi plugins:

- **@strapi/plugin-cloud**: Cloud deployment support
- **@strapi/plugin-documentation**: API documentation
- **@strapi/plugin-users-permissions**: User authentication and authorization
- **@strapi/provider-upload-cloudinary**: Cloudinary media upload integration
- **strapi-plugin-slugify**: Automatic slug generation for content

## 📚 API Documentation

Once the server is running, you can access:

- **Admin Panel**: `http://localhost:1337/admin`
- **API Documentation**: `http://localhost:1337/documentation`
- **API Endpoints**: `http://localhost:1337/api`

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📖 Learn More

- [Strapi Documentation](https://docs.strapi.io) - Official Strapi documentation
- [Strapi Tutorials](https://strapi.io/tutorials) - Community tutorials
- [Strapi Blog](https://strapi.io/blog) - Latest updates and articles

## ✨ Community

- [Discord](https://discord.strapi.io) - Chat with the Strapi community
- [Forum](https://forum.strapi.io/) - Ask questions and get help
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - Curated list of Strapi resources

---

## Vulnerabilities

41 vulnerabilities (22 low, 8 moderate, 11 high) 5.24.0
42 vulnerabilities (20 low, 10 moderate, 12 high) 5.30.0

<sub>🎓 Built with ❤️ for Keta Academy</sub>
