import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const app = express();
const PORT = Number(process.env.PORT || 5000);
const uploadDir = path.resolve("uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors({ origin: true }));
app.use(express.json({ limit: "10mb" }));
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  }
});
const upload = multer({ storage, limits: { files: 100, fileSize: 25 * 1024 * 1024 } });
const profileUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, callback) => callback(null, /^image\/(png|jpe?g|gif|webp|svg\+xml)$/i.test(file.mimetype))
});
const dataFile = path.resolve("codefolio-data.json");

const db = {
  users: [],
  repositories: [],
  issues: [],
  discussions: [],
  pullRequests: [],
  releases: [],
  activity: [],
  contactMessages: []
};

try {
  if (fs.existsSync(dataFile)) Object.assign(db, JSON.parse(fs.readFileSync(dataFile, "utf8")));
} catch {
  console.warn("Could not restore CodeFolio data. Starting with an empty store.");
}

const makeId = () => crypto.randomUUID();
const saveDb = () => fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
const slugify = value => String(value || "project").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
const uniqueSlug = (owner, name, currentId) => {
  const base = slugify(name);
  let slug = base;
  let suffix = 2;
  while (db.repositories.some(repo => repo.owner === owner && repo.slug === slug && repo.id !== currentId)) slug = `${base}-${suffix++}`;
  return slug;
};
const repositoryOwner = (req, repo) => String(req.body?.owner || req.headers["x-codefolio-user"] || "").toLowerCase() === repo.owner;
const publicProject = repo => ({
  id: repo.id,
  name: repo.name,
  slug: repo.slug,
  owner: repo.owner,
  description: repo.description,
  visibility: repo.visibility,
  status: repo.status,
  published: repo.published,
  publishedAt: repo.publishedAt,
  updatedAt: repo.updatedAt,
  createdAt: repo.createdAt,
  technologies: repo.technologies || [],
  readme: repo.readmeContent || repo.description,
  demoUrl: repo.demoUrl || "",
  githubUrl: repo.githubUrl || "",
  thumbnail: repo.thumbnail || "",
  files: repo.files || [],
  views: repo.views || 0,
  stars: repo.stars || 0
});
const publicUser = u => {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
};

const profileUser = (u, owner = false) => {
  if (!u) return null;
  const safe = publicUser(u);
  if (!owner && !u.privacy?.emailPublic) delete safe.email;
  return safe;
};

const addActivity = (username, type, data = {}) => {
  db.activity.unshift({ id: makeId(), username, type, ...data, createdAt: new Date().toISOString() });
};

const findUser = username => db.users.find(u => u.username === String(username).trim().toLowerCase());

app.get("/api/health", (_, res) => res.json({ ok: true, service: "CodeFolio API" }));

app.post("/api/auth/signup", (req, res) => {
  const { name, username, email, password } = req.body || {};
  if (!name || !username || !email || !password) {
    return res.status(400).json({ error: "Name, username, email and password are required." });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedUsername = String(username).trim().toLowerCase();
  if (db.users.some(u => u.email === normalizedEmail || u.username === normalizedUsername)) {
    return res.status(409).json({ error: "Email or username already exists." });
  }
  const user = {
    id: makeId(),
    name: String(name).trim(),
    username: normalizedUsername,
    email: normalizedEmail,
    password: String(password),
    bio: "Developer",
    skills: [],
    introduction: "",
    careerGoal: "",
    location: "",
    phone: "",
    website: "",
    linkedin: "",
    instagram: "",
    youtube: "",
    x: "",
    portfolio: "",
    github: "",
    githubUsername: "",
    githubRepositories: [],
    githubStats: { repositories: 0, stars: 0, forks: 0, commits: 0 },
    avatar: "",
    education: [],
    experience: [],
    certifications: [],
    achievements: [],
    certificates: [],
    hackathons: [],
    internships: [],
    awards: [],
    badges: [],
    privacy: { emailPublic: false },
    followers: [],
    following: []
  };
  db.users.push(user);
  addActivity(user.username, "signup", { message: "Joined CodeFolio" });
  saveDb();
  res.status(201).json({ token: makeId(), user: publicUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const user = db.users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid email or password." });
  res.json({ token: makeId(), user: publicUser(user) });
});

app.get("/api/profile/:username", (req, res) => {
  const user = findUser(req.params.username);
  if (!user) return res.status(404).json({ error: "Profile not found." });
  const owner = String(req.query.viewer || "").toLowerCase() === user.username;
  const repositories = db.repositories.filter(r => r.owner === user.username && r.published && r.status === "published" && r.visibility === "public").map(publicProject);
  const activity = db.activity.filter(item => item.username === user.username).slice(0, 30);
  res.json({ user: profileUser(user, owner), repositories, activity });
});

app.post("/api/github/sync", async (req, res) => {
  const requester = String(req.headers["x-codefolio-user"] || "").toLowerCase();
  const user = findUser(requester);
  const githubUsername = String(req.body?.githubUsername || "").trim();
  if (!user) return res.status(401).json({ error: "Sign in before connecting GitHub." });
  if (!githubUsername) return res.status(400).json({ error: "Enter a GitHub username." });
  try {
    const profileResponse = await fetch(`https://api.github.com/users/${encodeURIComponent(githubUsername)}`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "CodeFolio" } });
    if (!profileResponse.ok) return res.status(404).json({ error: "GitHub username not found." });
    const githubProfile = await profileResponse.json();
    const repositoryResponse = await fetch(`https://api.github.com/users/${encodeURIComponent(githubUsername)}/repos?per_page=100&sort=updated`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "CodeFolio" } });
    if (!repositoryResponse.ok) return res.status(502).json({ error: "GitHub repositories could not be loaded." });
    const githubRepos = await repositoryResponse.json();
    const repositories = await Promise.all(githubRepos.slice(0, 30).map(async repo => {
      let commits = 0;
      try {
        const commitsResponse = await fetch(`https://api.github.com/repos/${githubUsername}/${repo.name}/commits?per_page=1`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "CodeFolio" } });
        const link = commitsResponse.headers.get("link") || "";
        const match = link.match(/page=(\d+)>; rel="last"/);
        commits = match ? Number(match[1]) : commitsResponse.ok ? 1 : 0;
      } catch { commits = 0; }
      return { id: repo.id, name: repo.name, description: repo.description || "", htmlUrl: repo.html_url, language: repo.language || "Other", languages: repo.language ? [repo.language] : [], stars: repo.stargazers_count || 0, forks: repo.forks_count || 0, commits, updatedAt: repo.updated_at, isFork: repo.fork };
    }));
    user.github = githubProfile.html_url || `https://github.com/${githubUsername}`;
    user.githubUsername = githubProfile.login;
    user.githubRepositories = repositories;
    user.githubStats = { repositories: githubProfile.public_repos || repositories.length, stars: repositories.reduce((total, repo) => total + repo.stars, 0), forks: repositories.reduce((total, repo) => total + repo.forks, 0), commits: repositories.reduce((total, repo) => total + repo.commits, 0) };
    addActivity(user.username, "github_synced", { message: `Synced GitHub repositories for @${githubUsername}` });
    saveDb();
    res.json({ user: profileUser(user, true), repositories, stats: user.githubStats });
  } catch { res.status(502).json({ error: "GitHub is temporarily unavailable. Try again shortly." }); }
});

app.get("/api/github/live/:username", async (req, res) => {
  const githubUsername = String(req.params.username || "").trim();
  if (!githubUsername) return res.status(400).json({ error: "GitHub username is required." });
  try {
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "CodeFolio" };
    const [profileResponse, reposResponse, eventsResponse] = await Promise.all([
      fetch(`https://api.github.com/users/${encodeURIComponent(githubUsername)}`, { headers }),
      fetch(`https://api.github.com/users/${encodeURIComponent(githubUsername)}/repos?per_page=100&sort=updated`, { headers }),
      fetch(`https://api.github.com/users/${encodeURIComponent(githubUsername)}/events/public?per_page=30`, { headers })
    ]);
    if (!profileResponse.ok || !reposResponse.ok) return res.status(404).json({ error: "GitHub profile is unavailable." });
    const profile = await profileResponse.json();
    const repositories = await reposResponse.json();
    const events = eventsResponse.ok ? await eventsResponse.json() : [];
    const languages = repositories.reduce((counts, repo) => { if (repo.language) counts[repo.language] = (counts[repo.language] || 0) + 1; return counts; }, {});
    const recentCommits = events.filter(event => event.type === "PushEvent").flatMap(event => (event.payload?.commits || []).map(commit => ({ message: commit.message, repository: event.repo?.name || "Repository", createdAt: event.created_at, url: `https://github.com/${event.repo?.name}/commit/${commit.sha}` }))).slice(0, 8);
    const activity = events.slice(0, 12).map(event => ({ type: event.type.replace("Event", ""), repository: event.repo?.name || "GitHub", createdAt: event.created_at, message: event.type === "PushEvent" ? `Pushed ${event.payload?.commits?.length || 0} commit(s)` : event.type === "WatchEvent" ? "Starred a repository" : "GitHub activity" }));
    res.json({ profile: { login: profile.login, avatar: profile.avatar_url, followers: profile.followers || 0, following: profile.following || 0, publicRepositories: profile.public_repos || repositories.length }, repositories: repositories.slice(0, 30).map(repo => ({ id: repo.id, name: repo.name, url: repo.html_url, description: repo.description || "", language: repo.language || "Other", stars: repo.stargazers_count || 0, forks: repo.forks_count || 0, updatedAt: repo.updated_at })), languages, recentCommits, activity });
  } catch { res.status(502).json({ error: "GitHub live data is temporarily unavailable." }); }
});

app.put("/api/profile/:username", (req, res) => {
  const user = findUser(req.params.username);
  if (!user) return res.status(404).json({ error: "Profile not found." });
  const allowed = ["name", "email", "phone", "bio", "username", "skills", "location", "website", "linkedin", "instagram", "youtube", "x", "portfolio", "github", "avatar", "introduction", "careerGoal", "education", "experience", "certifications", "achievements", "certificates", "hackathons", "internships", "awards", "badges", "privacy"];
  const oldUsername = user.username;
  if (req.body?.username !== undefined) {
    const nextUsername = String(req.body.username).trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(nextUsername)) return res.status(400).json({ error: "Username must use 3-30 letters, numbers or hyphens." });
    if (nextUsername !== oldUsername && db.users.some(other => other.username === nextUsername)) return res.status(409).json({ error: "Username already exists." });
  }
  for (const key of allowed) if (req.body?.[key] !== undefined) user[key] = req.body[key];
  if (user.username !== oldUsername) {
    db.repositories.filter(repo => repo.owner === oldUsername).forEach(repo => { repo.owner = user.username; });
    db.activity.filter(item => item.username === oldUsername).forEach(item => { item.username = user.username; });
    db.users.forEach(other => {
      other.followers = other.followers.map(name => name === oldUsername ? user.username : name);
      other.following = other.following.map(name => name === oldUsername ? user.username : name);
    });
  }
  addActivity(user.username, "profile_updated", { message: "Updated their profile" });
  saveDb();
  res.json(profileUser(user, true));
});

app.post("/api/profile/:username/avatar", profileUpload.single("avatar"), (req, res) => {
  const username = String(req.params.username || "").toLowerCase();
  const requester = String(req.headers["x-codefolio-user"] || "").toLowerCase();
  const user = findUser(username);
  if (!user) return res.status(404).json({ error: "Profile not found." });
  if (requester !== username) return res.status(403).json({ error: "You can only update your own profile logo." });
  if (!req.file) return res.status(400).json({ error: "Choose a PNG, JPG, GIF, WEBP, or SVG image." });
  user.avatar = `/uploads/${req.file.filename}`;
  addActivity(user.username, "profile_updated", { message: "Updated their profile logo" });
  saveDb();
  res.json(profileUser(user, true));
});

app.get("/api/profile/:username/followers", (req, res) => {
  const user = findUser(req.params.username);
  if (!user) return res.status(404).json({ error: "Profile not found." });
  res.json(user.followers.map(findUser).filter(Boolean).map(profileUser));
});

app.get("/api/profile/:username/following", (req, res) => {
  const user = findUser(req.params.username);
  if (!user) return res.status(404).json({ error: "Profile not found." });
  res.json(user.following.map(findUser).filter(Boolean).map(profileUser));
});

app.post("/api/profile/:username/follow", (req, res) => {
  const target = findUser(req.params.username);
  const follower = findUser(req.body?.follower);
  if (!target || !follower) return res.status(404).json({ error: "User not found." });
  if (target.username === follower.username) return res.status(400).json({ error: "You cannot follow yourself." });
  if (!target.followers.includes(follower.username)) target.followers.push(follower.username);
  if (!follower.following.includes(target.username)) follower.following.push(target.username);
  addActivity(follower.username, "followed", { target: target.username, message: `Followed @${target.username}` });
  saveDb();
  res.json({ followers: target.followers.length, following: follower.following.length, followingUser: true });
});

app.delete("/api/profile/:username/follow", (req, res) => {
  const target = findUser(req.params.username);
  const follower = findUser(req.body?.follower);
  if (!target || !follower) return res.status(404).json({ error: "User not found." });
  target.followers = target.followers.filter(name => name !== follower.username);
  follower.following = follower.following.filter(name => name !== target.username);
  saveDb();
  res.json({ followers: target.followers.length, following: follower.following.length, followingUser: false });
});

app.post("/api/repositories", (req, res) => {
  const owner = String(req.body?.owner || "").trim().toLowerCase();
  const name = String(req.body?.name || "").trim();
  if (!owner || !name) return res.status(400).json({ error: "Owner and repository name are required." });
  if (db.repositories.some(r => r.owner === owner && r.name.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: "Repository already exists." });
  }
  const repo = {
    id: makeId(),
    owner,
    name,
    description: String(req.body?.description || ""),
    visibility: req.body?.visibility === "private" ? "private" : "public",
    readme: req.body?.readme !== false,
    readmeContent: String(req.body?.readmeContent || ""),
    technologies: Array.isArray(req.body?.technologies) ? req.body.technologies : [],
    demoUrl: String(req.body?.demoUrl || ""),
    githubUrl: String(req.body?.githubUrl || ""),
    thumbnail: String(req.body?.thumbnail || ""),
    files: [],
    stars: 0,
    starredBy: [],
    views: 0,
    viewLog: {},
    published: false,
    status: "draft",
    slug: uniqueSlug(owner, name),
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  db.repositories.push(repo);
  addActivity(owner, "repository_created", { repository: repo.name, message: `Created ${repo.name}` });
  saveDb();
  res.status(201).json(repo);
});

app.get("/api/repositories", (_, res) => res.json(db.repositories));

app.get("/api/repositories/:owner/:name", (req, res) => {
  const repo = db.repositories.find(
    r => r.owner === req.params.owner.toLowerCase() && r.name.toLowerCase() === req.params.name.toLowerCase()
  );
  if (!repo) return res.status(404).json({ error: "Repository not found." });
  res.json(repo);
});

app.get("/api/public/projects/:owner/:slug", (req, res) => {
  const repo = db.repositories.find(item => item.owner === req.params.owner.toLowerCase() && item.slug === req.params.slug && item.published && item.status === "published" && item.visibility === "public");
  if (!repo) return res.status(404).json({ error: "Project not found or unavailable." });
  const viewer = String(req.query.viewer || req.headers["x-codefolio-user"] || "anonymous");
  const now = Date.now();
  const lastViewed = Number(repo.viewLog?.[viewer] || 0);
  if (now - lastViewed > 15 * 60 * 1000) {
    repo.views = (repo.views || 0) + 1;
    repo.viewLog = { ...(repo.viewLog || {}), [viewer]: now };
    saveDb();
  }
  const owner = findUser(repo.owner);
  const related = db.repositories.filter(item => item.owner === repo.owner && item.id !== repo.id && item.published && item.status === "published" && item.visibility === "public").map(publicProject);
  res.json({ project: publicProject(repo), owner: profileUser(owner), related, viewerStarred: repo.starredBy?.includes(viewer.toLowerCase()) || false });
});

app.get("/api/profile/:username/projects", (req, res) => {
  const user = findUser(req.params.username);
  if (!user) return res.status(404).json({ error: "Profile not found." });
  res.json(db.repositories.filter(repo => repo.owner === user.username && repo.published && repo.status === "published" && repo.visibility === "public").map(publicProject));
});

app.get("/api/public/projects/:owner/:slug/stats", (req, res) => {
  const repo = db.repositories.find(item => item.owner === req.params.owner.toLowerCase() && item.slug === req.params.slug && item.published && item.status === "published" && item.visibility === "public");
  if (!repo) return res.status(404).json({ error: "Project not found or unavailable." });
  res.json({ views: repo.views || 0, stars: repo.stars || 0, files: repo.files.length, publishedAt: repo.publishedAt });
});

app.post("/api/public/projects/:owner/:slug/star", (req, res) => {
  const repo = db.repositories.find(item => item.owner === req.params.owner.toLowerCase() && item.slug === req.params.slug && item.published && item.status === "published" && item.visibility === "public");
  const username = String(req.body?.username || "").toLowerCase();
  if (!repo) return res.status(404).json({ error: "Project not found or unavailable." });
  if (!findUser(username)) return res.status(401).json({ error: "Sign in to star projects." });
  repo.starredBy = repo.starredBy || [];
  if (!repo.starredBy.includes(username)) repo.starredBy.push(username);
  repo.stars = repo.starredBy.length;
  saveDb();
  res.json({ starred: true, stars: repo.stars });
});

app.delete("/api/public/projects/:owner/:slug/star", (req, res) => {
  const repo = db.repositories.find(item => item.owner === req.params.owner.toLowerCase() && item.slug === req.params.slug && item.published && item.status === "published" && item.visibility === "public");
  const username = String(req.body?.username || "").toLowerCase();
  if (!repo) return res.status(404).json({ error: "Project not found or unavailable." });
  repo.starredBy = (repo.starredBy || []).filter(item => item !== username);
  repo.stars = repo.starredBy.length;
  saveDb();
  res.json({ starred: false, stars: repo.stars });
});

app.put("/api/repositories/:id", (req, res) => {
  const repo = db.repositories.find(r => r.id === req.params.id);
  if (!repo) return res.status(404).json({ error: "Repository not found." });
  for (const key of ["name", "description", "visibility", "published"]) {
    if (req.body?.[key] !== undefined) repo[key] = req.body[key];
  }
  repo.updatedAt = new Date().toISOString();
  res.json(repo);
});

app.delete("/api/repositories/:id", (req, res) => {
  const index = db.repositories.findIndex(r => r.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: "Repository not found." });
  db.repositories.splice(index, 1);
  res.json({ success: true });
});

app.post("/api/repositories/:id/upload", upload.array("files", 100), (req, res) => {
  const repo = db.repositories.find(r => r.id === req.params.id);
  if (!repo) return res.status(404).json({ error: "Repository not found." });
  const uploaded = (req.files || []).map(file => ({
    id: makeId(),
    originalName: file.originalname,
    filename: file.filename,
    size: file.size,
    url: `/uploads/${file.filename}`
  }));
  repo.files.push(...uploaded);
  repo.updatedAt = new Date().toISOString();
  addActivity(repo.owner, "file_uploaded", { repository: repo.name, message: `Uploaded ${uploaded.length} file(s) to ${repo.name}` });
  saveDb();
  res.status(201).json({ files: uploaded, repository: repo });
});

app.post("/api/repositories/:id/publish", (req, res) => {
  const repo = db.repositories.find(r => r.id === req.params.id);
  if (!repo) return res.status(404).json({ error: "Repository not found." });
  if (!repositoryOwner(req, repo)) return res.status(403).json({ error: "You don't have permission to publish this project." });
  if (!repo.name || !repo.description || !repo.files.length) return res.status(400).json({ error: "Add a project name, description, and at least one file before publishing." });
  repo.slug = uniqueSlug(repo.owner, repo.name, repo.id);
  repo.published = true;
  repo.status = "published";
  repo.visibility = "public";
  repo.publishedAt = repo.publishedAt || new Date().toISOString();
  repo.updatedAt = new Date().toISOString();
  addActivity(repo.owner, "project_published", { repository: repo.name, message: `Published ${repo.name}` });
  saveDb();
  res.json({ repository: repo, publicUrl: `http://localhost:5173/${repo.owner}/${repo.slug}` });
});

app.post("/api/repositories/:id/unpublish", (req, res) => {
  const repo = db.repositories.find(r => r.id === req.params.id);
  if (!repo) return res.status(404).json({ error: "Repository not found." });
  if (!repositoryOwner(req, repo)) return res.status(403).json({ error: "You don't have permission to unpublish this project." });
  repo.published = false;
  repo.status = "draft";
  repo.updatedAt = new Date().toISOString();
  addActivity(repo.owner, "project_unpublished", { repository: repo.name, message: `Unpublished ${repo.name}` });
  saveDb();
  res.json({ repository: repo });
});

for (const resource of ["issues", "discussions", "pullRequests", "releases"]) {
  app.get(`/api/${resource}`, (_, res) => res.json(db[resource]));
  app.post(`/api/${resource}`, (req, res) => {
    const item = { id: makeId(), ...req.body, createdAt: new Date().toISOString() };
    db[resource].push(item);
    res.status(201).json(item);
  });
}

const contactAttempts = new Map();
app.post("/api/contact", (req, res) => {
  const { name, email, message, website } = req.body || {};
  const requester = String(req.headers["x-codefolio-user"] || req.ip || "anonymous");
  const lastAttempt = contactAttempts.get(requester) || 0;
  if (website) return res.status(400).json({ error: "Unable to send this message." });
  if (Date.now() - lastAttempt < 30 * 1000) return res.status(429).json({ error: "Please wait before sending another message." });
  if (!name || !email || !message || String(message).trim().length < 10) return res.status(400).json({ error: "Add your name, email, and a message of at least 10 characters." });
  contactAttempts.set(requester, Date.now());
  db.contactMessages.push({ id: makeId(), name: String(name).trim(), email: String(email).trim().toLowerCase(), message: String(message).trim(), createdAt: new Date().toISOString(), notification: "queued" });
  saveDb();
  res.status(201).json({ success: true, message: "Your message was sent successfully." });
});

app.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File is larger than 25 MB." });
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => console.log(`CodeFolio API running at http://localhost:${PORT}`));
