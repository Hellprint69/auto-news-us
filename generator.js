const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Pasang header User-Agent agar tidak dianggap bot spam
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  timeout: 10000
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Gunakan RSS Yahoo News US yang stabil dan tidak memblokir GitHub Actions
const RSS_URL = 'https://news.yahoo.com/rss/';

async function generateArticles() {
  try {
    console.log('Mengambil berita dari RSS Yahoo News US...');
    const feed = await parser.parseURL(RSS_URL);
    
    // Ambil 3 berita teratas
    const items = feed.items.slice(0, 3);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

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
        console.log(`Artikel sudah ada, lewati: ${item.title}`);
        continue;
      }

      console.log(`Memproses berita: ${item.title}`);

      const prompt = `
You are an expert US news journalist and SEO copywriter.
Rewrite this trending news into an engaging, 100% original news article in native US English.

Source Headline: ${item.title}
Source Details: ${item.contentSnippet || item.content || ''}

Requirements:
1. Write a new captivating headline.
2. Write a 300-400 word well-structured article using HTML paragraphs (<p>), subheadings (<h2>), and unordered lists (<ul>, <li>).
3. Return ONLY a valid JSON object without markdown fences, with these exact keys:
   - "title": (string) The headline
   - "snippet": (string) Short 1-2 sentence meta description
   - "content": (string) Article body in clean HTML format
   - "tags": (array of strings) 3-5 relevant US category tags
`;

      try {
        const response = await model.generateContent(prompt);
        let text = response.response.text().trim();
        
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        const articleData = JSON.parse(text);
        articleData.slug = slug;
        articleData.date = new Date().toISOString();
        articleData.sourceUrl = item.link;

        fs.writeFileSync(filePath, JSON.stringify(articleData, null, 2));
        console.log(`Berhasil disimpan: ${slug}.json`);
      } catch (err) {
        console.error('Gagal generate:', item.title, err.message);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    updatePostIndex(postsDir);

  } catch (error) {
    console.error('Fatal error di generator:', error);
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
        snippet: data.snippet,
        date: data.date,
        tags: data.tags
      };
    } catch (e) {
      return null;
    }
  }).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));

  fs.writeFileSync(path.join(postsDir, 'index.json'), JSON.stringify(allPosts, null, 2));
  console.log(`File manifest index.json diperbarui (${allPosts.length} artikel).`);
}

generateArticles();
