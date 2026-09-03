const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const parser = new Parser();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const RSS_URL = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';

async function generateArticles() {
  try {
    console.log('Fetching US trending news...');
    const feed = await parser.parseURL(RSS_URL);
    
    // Ambil 3 berita dulu untuk tes cepat
    const items = feed.items.slice(0, 3);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });

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
        console.log(`Article already exists, skipping: ${item.title}`);
        continue;
      }

      console.log(`Writing article for: ${item.title}`);

      const prompt = `
You are a professional US news reporter and SEO writer.
Rewrite this trending news into an original, engaging article in native US English.

Source Headline: ${item.title}
Source Snippet: ${item.contentSnippet || item.content || ''}

Instructions:
1. Provide a brand new, catchy headline.
2. Write a 300-400 word comprehensive article using clean HTML tags (<p>, <h2>, <h3>, <ul>, <li>).
3. Output strictly a JSON object with these keys:
   - "title": (string) The new headline
   - "snippet": (string) Short 1-2 sentence meta description
   - "content": (string) Full article body in clean HTML format
   - "tags": (array of strings) 3-5 relevant US category/tags
Do not wrap in backticks or markdown, just return raw JSON text.
`;

      try {
        // Beri timeout 20 detik agar tidak pernah nyangkut selamanya
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('API Timeout')), 20000));
        const generatePromise = model.generateContent(prompt);

        const response = await Promise.race([generatePromise, timeoutPromise]);
        let text = response.response.text().trim();
        
        // Bersihkan formatting markdown jika ada
        text = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '');

        const articleData = JSON.parse(text);
        articleData.slug = slug;
        articleData.date = new Date().toISOString();
        articleData.sourceUrl = item.link;

        fs.writeFileSync(filePath, JSON.stringify(articleData, null, 2));
        console.log(`Successfully created: ${slug}.json`);
      } catch (err) {
        console.error('Error generating:', item.title, err.message);
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    updatePostIndex(postsDir);

  } catch (error) {
    console.error('Fatal error in news generator:', error);
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
  console.log(`Updated posts manifest: index.json (${allPosts.length} articles).`);
}

generateArticles();
