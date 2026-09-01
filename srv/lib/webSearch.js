import { resilientFetch } from './model.js'

/**
 * Web search via Tavily. Returns [] when TAVILY_API_KEY is not set, so the
 * flow degrades to the model's own SAP knowledge instead of failing.
 */
export async function webSearch(query, { maxResults = 5 } = {}) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return { answer: null, results: [] }

  try {
    const res = await resilientFetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'advanced',
        include_answer: true,
        max_results: maxResults,
      }),
    })

    if (!res.ok) {
      console.error('Tavily search failed:', res.status, await res.text())
      return { answer: null, results: [] }
    }

    const data = await res.json()
    return {
      answer: data.answer || null,
      results: (data.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    }
  } catch (err) {
    console.error('Tavily search error:', err.message)
    return { answer: null, results: [] }
  }
}
