const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure']
    ]
  },
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  },
  timeout: 10000
});

const API_KEY = process.env.GEMINI_API_KEY;
const RSS_URL = 'https://news.yahoo.com/rss/';

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${API_KEY}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Status ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

function extractImage(item) {
  // Cek media:content
  if (item.mediaContent && item.mediaContent.$&& item.mediaContent.$.url) {
    return item.mediaContent.$.url;
  }
  // Cek media:thumbnail
  if (item.mediaThumbnail && item.mediaThumbnail.$&& item.mediaThumbnail.$.url) {
    return item.mediaThumbnail.$.url;
  }
  // Cek enclosure
  if (item.enclosure && item.enclosure.url) {
    return item.enclosure.url;
  }
  // Fallback ke gambar berita random beresolusi tinggi
  return 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800&auto=format&fit=crop&q=80';
}

async function generateArticles() {
  try {
    console.log('Mengambil RSS Yahoo News...');
    const feed = await parser.parseURL(RSS_URL);
    const items = feed.items.slice(0, 4);

    const postsDir = path.join(__dirname, 'posts');
    if (!fs.existsSync(postsDir)) {
      fs.mkdirSync(postsDir, { recursive: true });
    }

    for (const item of items) {
      const slug = item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '')
        .substring(0, 50);

      const filePath = path.join(postsDir, `${slug}.json`);
      if (fs.existsSync(filePath)) {
        console.log(`Sudah ada: ${item.title}`);
        continue;
      }

      console.log(`Memproses berita: ${item.title}`);
      const imageUrl = extractImage(item);

      const prompt = `
You are a US news journalist. Rewrite this news into an original news article in native US English.
Headline: ${item.title}
Snippet: ${item.contentSnippet || item.content || ''}

Return ONLY valid JSON matching this schema:
{
  "title": "New catchy headline",
  "snippet": "Short summary",
  "content": "<p>Paragraph 1...</p><h2>Subheading</h2><p>Paragraph 2...</p>",
  "tags": ["tag1", "tag2", "tag3"]
}
`;

      try {
        let text = await callGemini(prompt);
        text = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        const articleData = JSON.parse(text);
        articleData.slug = slug;
        articleData.image = imageUrl;
        articleData.date = new Date().toISOString();
        articleData.sourceUrl = item.link;

        fs.writeFileSync(filePath, JSON.stringify(articleData, null, 2));
        console.log(`BERHASIL: ${slug}.json`);
      } catch (err) {
        console.error('Gagal generate:', item.title, err.message);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    updatePostIndex(postsDir);
  } catch (err) {
    console.error('Fatal error:', err);
  }
}

function updatePostIndex(postsDir) {
  if (!fs.existsSync(postsDir)) return;
  const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json') && f !== 'index.json');
  const allPosts = files.map(file => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(postsDir, file), 'utf8'));
      return {
        title: data.title,
        slug: data.slug,
        image: data.image || '[https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800&auto=format&fit=crop&q=80](https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=800&auto=format&fit=crop&q=80)',
        snippet: data.snippet,
        date: data.date,
        tags: data.tags
      };
    } catch {
      return null;
    }
  }).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));

  fs.writeFileSync(path.join(postsDir, 'index.json'), JSON.stringify(allPosts, null, 2));
  console.log(`File manifest index.json diperbarui (${allPosts.length} artikel).`);
}

generateArticles();
