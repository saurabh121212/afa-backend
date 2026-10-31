// Settings for the Blog (Admin "Content Management" -> Blog & Resources, website /blog).

// Post status
//   draft     -> being written, only admins see it
//   published -> on the website (/blog, /blog/<slug>); on the homepage too when showOnHomepage is on
//   archived  -> taken down, kept for the record (not on the website)
const BLOG_STATUSES = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

// Cover image: public file, saved in uploads/public/blogs/
const BLOG_IMAGE = { folder: 'blogs', prefix: 'blog', formats: ['jpg', 'png'], maxSizeMB: 5 };

// The body is HTML from the admin's rich-text editor. Anything not listed here is removed on save.
const BLOG_HTML = {
  allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'hr'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
};

const BLOG_LIMITS = {
  title: { min: 5, max: 200 },
  slug: { max: 200 },
  excerpt: { max: 300 },
  category: { max: 50 },
  authorName: { max: 100 },
  contentText: { min: 20 }, // characters of text (without the HTML tags)
  contentHtml: { max: 100000 },
};

// A post's web address: "preparing-soil-for-summer" (lower-case letters, numbers and single dashes)
const SLUG_RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Shown when a post has no author name
const DEFAULT_AUTHOR = 'AFA Editorial';

module.exports = { BLOG_STATUSES, BLOG_IMAGE, BLOG_HTML, BLOG_LIMITS, DEFAULT_AUTHOR, SLUG_RULE };
