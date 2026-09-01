import { resilientFetch } from './model.js'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36'

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

function decodeDdgUrl(href) {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) return decodeURIComponent(m[1])
  return href.startsWith('//') ? 'https:' + href : href
}

function parseDdg(html) {
  const out = []
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  let m
  while ((m = linkRe.exec(html))) {
    out.push({ url: decodeDdgUrl(m[1]), title: stripTags(m[2]), snippet: '' })
  }
  const snips = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((s) =>
    stripTags(s[1])
  )
  out.forEach((r, i) => {
    r.snippet = snips[i] || ''
  })
  return out
}

/**
 * Keyless web search via DuckDuckGo's HTML endpoint, biased towards SAP content.
 * Returns { results: [{ title, url, snippet }] } (empty on any failure).
 */
export async function webSearch(query, { maxResults = 5 } = {}) {
  const q = /\bsap\b/i.test(query) ? query : `${query} SAP`
  try {
    const res = await resilientFetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
    })
    if (!res.ok) {
      console.error('webSearch: DuckDuckGo returned', res.status)
      return { results: [] }
    }
    return { results: parseDdg(await res.text()).slice(0, maxResults) }
  } catch (err) {
    console.error('webSearch error:', err.message)
    return { results: [] }
  }
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
