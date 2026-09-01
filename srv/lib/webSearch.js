import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search'
import { resilientFetch } from './model.js'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

const ddg = new DuckDuckGoSearch({ maxResults: 5 })

/**
 * Keyless web search via LangChain's DuckDuckGoSearch tool, biased towards SAP.
 * Returns { results: [{ title, url, snippet }] } (empty on any failure).
 */
export async function webSearch(query, { maxResults = 5 } = {}) {
  const q = /\bsap\b/i.test(query) ? query : `${query} SAP`
  try {
    const raw = await ddg.invoke(q)
    const items = Array.isArray(raw) ? raw : JSON.parse(raw)
    return {
      results: items
        .slice(0, maxResults)
        .map((i) => ({ title: i.title, url: i.link || i.url, snippet: i.snippet })),
    }
  } catch (err) {
    console.error('webSearch error:', err.message)
    return { results: [] }
  }
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fetch a result page and return its readable text, capped. */
export async function fetchPageText(url, { maxChars = 2500 } = {}) {
  try {
    const res = await resilientFetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } })
    if (!res.ok) return ''
    const html = await res.text()
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    return stripTags(body).slice(0, maxChars)
  } catch (err) {
    console.error('fetchPageText error:', err.message)
    return ''
  }
}
