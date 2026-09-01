import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { webSearch } from './webSearch.js'

/**
 * LangChain tool the agent calls to research SAP tables / fields on the web.
 * Returns [] when TAVILY_API_KEY is missing (agent then relies on its own knowledge).
 */
export const searchWebTool = tool(
  async ({ query }) => {
    const { answer, results } = await webSearch(query, { maxResults: 5 })
    return JSON.stringify({
      answer,
      results: results.map((r) => ({ title: r.title, url: r.url, content: r.content })),
    })
  },
  {
    name: 'search_web',
    description:
      'Search the web for SAP data model details: which standard SAP table holds a ' +
      'given kind of data, its technical field names, and key fields. ' +
      'Input: a concise English search query.',
    schema: z.object({
      query: z.string().describe('Concise English web search query'),
    }),
  }
)
