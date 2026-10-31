// Blog (Admin "Content Management" -> Blog & Resources) - admin management + public pages.
//
//   draft     -> only admins see it
//   published -> on the website (/blog, /blog/<slug>); on the homepage too when showOnHomepage is on
//   archived  -> taken down from the website, kept for the record
// The body is HTML from the admin's rich-text editor: it is cleaned on every save (sanitize-html),
// so the website can show it as it is.
const path = require('path');
const fs = require('fs/promises');
const { Op } = require('sequelize');
const sanitizeHtml = require('sanitize-html');
const config = require('../config');
const { Blog } = require('../models');
const ApiError = require('../utils/ApiError');
const { getPagination, paginationMeta } = require('../utils/pagination');
const { fileMatchesKind, kindForMimeType, formatLabels } = require('../utils/fileTypes');
const { BLOG_STATUSES, BLOG_IMAGE, BLOG_HTML, BLOG_LIMITS, DEFAULT_AUTHOR, SLUG_RULE } = require('../config/blog');

const notFound = () => new ApiError(404, 'Post not found', { code: 'BLOG_NOT_FOUND' });
const validationError = (field, message) =>
  new ApiError(422, 'Validation failed', { code: 'VALIDATION_ERROR', errors: [{ field, message }] });
const imageUrl = (p) => (p ? `/uploads/${String(p).replace(/^public\//, '')}` : null);

// ---------- HTML ----------

// Only the tags of the editor survive. Links to other websites open in a new tab.
function cleanHtml(html) {
  return sanitizeHtml(String(html || ''), {
    ...BLOG_HTML,
    allowProtocolRelative: false,
    transformTags: {
      a: (tagName, attribs) => {
        const external = /^https?:\/\//i.test(attribs.href || '');
        return {
          tagName: 'a',
          attribs: {
            ...(attribs.href ? { href: attribs.href } : {}),
            ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}),
          },
        };
      },
    },
  }).trim();
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

// The words of the post, without tags ("<p>Hello <b>you</b></p>" -> "Hello you")
function textOf(html) {
  return sanitizeHtml(String(html || '').replace(/<\/(p|h[2-4]|li|blockquote|pre)>|<br\s*\/?>/gi, ' '), { allowedTags: [], allowedAttributes: {} })
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\s+/g, ' ')
    .trim();
}

const readMinutes = (text) => Math.max(1, Math.ceil(text.split(' ').filter(Boolean).length / 200));

// The admin's summary, or the start of the post
function summaryOf(b, text = textOf(b.content)) {
  if (b.excerpt) return b.excerpt;
  if (text.length <= 200) return text;
  return `${text.slice(0, 200).replace(/\s+\S*$/, '')}…`;
}

// ---------- slug ----------

// "Smart irrigation: more crop per drop" -> "smart-irrigation-more-crop-per-drop"
function slugify(title) {
  const slug = String(title || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // remove accents
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return slug || 'post';
}

// A slug no other post uses (deleted posts keep theirs: the column is unique)
async function freeSlug(base, excludeId = null) {
  const rows = await Blog.findAll({
    where: { slug: { [Op.like]: `${base}%` }, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    attributes: ['slug'],
    paranoid: false,
  });
  const used = new Set(rows.map((r) => r.slug));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// A slug the admin typed must be free
async function checkSlug(slug, excludeId = null) {
  const taken = await Blog.findOne({
    where: { slug, ...(excludeId ? { id: { [Op.ne]: excludeId } } : {}) },
    attributes: ['id', 'deletedAt'],
    paranoid: false,
  });
  if (taken) {
    throw validationError(
      'slug',
      taken.deletedAt ? 'A deleted post used this web address. Choose another one.' : 'Another post already uses this web address'
    );
  }
}

// ---------- output ----------

function toAdmin(b) {
  const text = textOf(b.content);
  return {
    id: b.id,
    title: b.title,
    slug: b.slug,
    excerpt: b.excerpt,
    summary: summaryOf(b, text),
    content: b.content,
    category: b.category,
    authorName: b.authorName,
    coverImageUrl: imageUrl(b.coverImagePath),
    status: b.status,
    statusLabel: BLOG_STATUSES[b.status] || b.status,
    showOnHomepage: b.showOnHomepage,
    // What the website shows right now
    visibleOnWebsite: b.status === 'published',
    visibleOnHomepage: b.status === 'published' && b.showOnHomepage,
    readMinutes: readMinutes(text),
    publishedAt: b.publishedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function toPublicSummary(b) {
  const text = textOf(b.content);
  return {
    id: b.id,
    title: b.title,
    slug: b.slug,
    summary: summaryOf(b, text),
    category: b.category,
    authorName: b.authorName || DEFAULT_AUTHOR,
    coverImageUrl: imageUrl(b.coverImagePath),
    readMinutes: readMinutes(text),
    publishedAt: b.publishedAt,
    updatedAt: b.updatedAt,
  };
}

const toPublicDetail = (b) => ({ ...toPublicSummary(b), content: b.content });

// ======================= ADMIN =======================

// GET /admin/blogs/stats
async function stats() {
  const [total, published, draft, archived, onHomepage] = await Promise.all([
    Blog.count(),
    Blog.count({ where: { status: 'published' } }),
    Blog.count({ where: { status: 'draft' } }),
    Blog.count({ where: { status: 'archived' } }),
    Blog.count({ where: { status: 'published', showOnHomepage: true } }),
  ]);
  return { total, published, draft, archived, onHomepage };
}

// GET /admin/blogs?status=&homepage=&id=&search=&page=   (drafts and archived posts included)
async function list(query) {
  const pg = getPagination(query);
  const where = {};
  if (query.status) where.status = query.status;
  if (query.homepage !== undefined) where.showOnHomepage = query.homepage;
  if (query.id) where.id = query.id;
  if (query.search) {
    const like = `%${query.search}%`;
    where[Op.or] = [{ title: { [Op.like]: like } }, { excerpt: { [Op.like]: like } }, { category: { [Op.like]: like } }];
  }
  const { rows, count } = await Blog.findAndCountAll({
    where,
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map(toAdmin), pagination: paginationMeta(pg, count) };
}

async function findOr404(id) {
  const blog = await Blog.findByPk(id);
  if (!blog) throw notFound();
  return blog;
}

const TEXT_FIELDS = ['title', 'excerpt', 'category', 'authorName', 'status', 'showOnHomepage'];
const CLEARABLE = ['excerpt', 'category', 'authorName'];

function pickValues(data, rawBody) {
  const values = {};
  TEXT_FIELDS.forEach((f) => {
    if (data[f] !== undefined) values[f] = data[f];
  });
  CLEARABLE.forEach((f) => {
    if (rawBody[f] === null || rawBody[f] === '') values[f] = null;
  });
  if (data.content !== undefined) {
    const html = cleanHtml(data.content);
    if (textOf(html).length < BLOG_LIMITS.contentText.min) {
      throw validationError('content', `Write at least ${BLOG_LIMITS.contentText.min} characters`);
    }
    values.content = html;
  }
  return values;
}

// POST /admin/blogs   (then POST /admin/blogs/:id/image to add the cover)
async function create(data, rawBody, adminId) {
  const values = pickValues(data, rawBody);
  if (data.slug) await checkSlug(data.slug);
  const status = values.status || 'draft';
  const blog = await Blog.create({
    ...values,
    slug: data.slug || (await freeSlug(slugify(values.title))),
    status,
    publishedAt: status === 'published' ? new Date() : null,
    createdBy: adminId,
    updatedBy: adminId,
  });
  return toAdmin(blog);
}

// PUT /admin/blogs/:id   (send only what changes; null / "" clears the summary, category or author)
// The web address stays when the title changes (links keep working); send `slug` to change it.
async function update(id, data, rawBody, adminId) {
  const blog = await findOr404(id);
  const values = pickValues(data, rawBody);
  if (data.slug && data.slug !== blog.slug) {
    await checkSlug(data.slug, blog.id);
    values.slug = data.slug;
  }
  // The publish date is the first time it went live
  if (values.status === 'published' && !blog.publishedAt) values.publishedAt = new Date();
  await blog.update({ ...values, updatedBy: adminId });
  return toAdmin(blog);
}

// POST /admin/blogs/:id/image   (form-data "file")
const uploadRoot = () => path.resolve(config.upload.dir);
const removeFile = (full) => fs.unlink(full).catch(() => {});

async function setImage(id, file, adminId) {
  const blog = await Blog.findByPk(id);
  if (!blog) {
    await removeFile(file.path);
    throw notFound();
  }
  const kind = kindForMimeType(file.mimetype, BLOG_IMAGE.formats);
  if (!kind || !(await fileMatchesKind(file.path, kind))) {
    await removeFile(file.path);
    throw new ApiError(415, `This file is not a valid image. Allowed: ${formatLabels(BLOG_IMAGE.formats)}`, {
      code: 'INVALID_FILE_CONTENT',
    });
  }
  const oldPath = blog.coverImagePath;
  const relative = path.relative(uploadRoot(), file.path).split(path.sep).join('/');
  await blog.update({ coverImagePath: relative, updatedBy: adminId });
  // The replaced picture file is no longer used
  if (oldPath && oldPath !== relative) {
    const full = path.resolve(uploadRoot(), oldPath);
    if (full.startsWith(uploadRoot() + path.sep)) await removeFile(full);
  }
  return toAdmin(blog);
}

// DELETE /admin/blogs/:id   (soft delete; the web address stays reserved)
async function remove(id) {
  const blog = await findOr404(id);
  await blog.destroy();
  return { id: blog.id, title: blog.title };
}

// ======================= PUBLIC =======================

// GET /blogs?homepage=true&category=&search=&page=   -> published posts, newest first (no body)
async function listPublic(query) {
  const pg = getPagination(query);
  const where = { status: 'published' };
  if (query.homepage) where.showOnHomepage = true;
  if (query.category) where.category = query.category;
  if (query.search) {
    const like = `%${query.search}%`;
    where[Op.or] = [{ title: { [Op.like]: like } }, { excerpt: { [Op.like]: like } }];
  }
  const { rows, count } = await Blog.findAndCountAll({
    where,
    order: [['publishedAt', 'DESC'], ['id', 'DESC']],
    limit: pg.limit,
    offset: pg.offset,
  });
  return { items: rows.map(toPublicSummary), pagination: paginationMeta(pg, count) };
}

// GET /blogs/:slug   -> one published post with its body
async function getPublic(slug) {
  if (!SLUG_RULE.test(slug) || slug.length > BLOG_LIMITS.slug.max) throw notFound();
  const blog = await Blog.findOne({ where: { slug, status: 'published' } });
  if (!blog) throw notFound();
  return toPublicDetail(blog);
}

module.exports = { stats, list, create, update, setImage, remove, listPublic, getPublic, cleanHtml, textOf, slugify };
