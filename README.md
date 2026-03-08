# 🎬 Vividly — AI Cinematic Video Generator

> Make Your Imagine Come Alive  
> Hackathon: Alibaba Cloud AI × Creativity · Feb 25 – Mar 11, 2026

---

## 🗂️ Project Structure

```
vividly/
├── frontend/                    # Static pages (HTML/CSS/JS)
│   ├── pages/
│   │   ├── index.html           # Landing page (hero, sections, gallery)
│   │   ├── studio-alive.html    # ALIVE mode studio
│   │   ├── studio-transition.html
│   │   └── studio-canvas.html
│   ├── components/
│   │   ├── navbar.html          # Shared navbar partial
│   │   └── footer.html          # Shared footer partial
│   └── assets/
│       ├── images/              # Static images
│       └── icons/               # SVG icons, logo
│
├── backend/                     # Node.js + Express API
│   ├── server.js                # Entry point
│   ├── routes/
│   │   ├── gallery.js           # GET/POST/DELETE gallery images
│   │   ├── generate.js          # POST → Qwen + Wan AI
│   │   └── admin.js             # Admin CRUD for gallery DB
│   ├── controllers/
│   │   ├── galleryController.js
│   │   ├── generateController.js
│   │   └── adminController.js
│   ├── middleware/
│   │   ├── auth.js              # Admin JWT auth
│   │   ├── upload.js            # Multer file upload handler
│   │   └── rateLimit.js         # Rate limiting for AI endpoints
│   └── config/
│       ├── database.js          # SQLite/JSON DB connection
│       └── alibaba.js           # Alibaba Cloud / Qwen / Wan config
│
├── database/
│   ├── gallery.json             # Gallery image database (editable)
│   └── schema.sql               # Optional: SQLite schema
│
├── public/                      # Served statically by Express
│   ├── uploads/                 # User-uploaded images
│   └── thumbnails/              # Generated video thumbnails
│
├── .env                         # Environment variables (never commit!)
├── .env.example                 # Template for env vars
├── .gitignore
├── package.json
└── README.md
```

---

## ⚙️ Tech Stack

| Layer       | Tech                                      |
|-------------|-------------------------------------------|
| Frontend    | Vanilla HTML/CSS/JS (no framework)        |
| Backend     | Node.js + Express.js                      |
| Database    | JSON file DB (gallery) / SQLite (users)   |
| AI Models   | Qwen (text→prompt) + Wan (video gen)      |
| Cloud       | Alibaba Cloud Simple Application Server  |
| File Upload | Multer (local) → Alibaba OSS (production) |
| Auth        | JWT (admin panel only)                    |

---

## 🔑 Environment Variables

```env
# Alibaba Cloud / Model Studio
ALIBABA_API_KEY=your_key_here
ALIBABA_ENDPOINT=https://dashscope.aliyuncs.com
QWEN_MODEL=qwen-plus
WAN_MODEL=wanx-v1

# Server
PORT=3000
NODE_ENV=development

# Admin panel
ADMIN_SECRET=your_admin_secret
JWT_SECRET=your_jwt_secret

# File storage
UPLOAD_DIR=./public/uploads
MAX_FILE_SIZE_MB=10
```

---

## 🚀 How to Run

```bash
# Install dependencies
npm install

# Development
npm run dev

# Production
npm start
```

---

## 🎨 Gallery Database

Gallery images dikelola via **JSON file** (`database/gallery.json`).  
Admin bisa CRUD via `/admin` panel (requires login).  
Publik hanya bisa GET via `/api/gallery`.

---

## 📡 API Endpoints

| Method | Endpoint                 | Description                   | Auth     |
|--------|--------------------------|-------------------------------|----------|
| GET    | /api/gallery             | Fetch all gallery items       | Public   |
| POST   | /api/gallery             | Add new gallery image         | Admin    |
| DELETE | /api/gallery/:id         | Delete gallery item           | Admin    |
| PATCH  | /api/gallery/:id         | Update label/mode             | Admin    |
| POST   | /api/generate/alive      | Generate ALIVE video          | Public   |
| POST   | /api/generate/transition | Generate TRANSITION video     | Public   |
| POST   | /api/generate/canvas     | Generate CANVAS video         | Public   |
| POST   | /admin/login             | Admin login → JWT             | —        |
| GET    | /admin                   | Admin dashboard               | Admin    |
"# Vividly" 
