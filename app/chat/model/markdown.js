sap.ui.define([], function () {
  'use strict'

  /**
   * Minimal Markdown -> HTML renderer for chat bubbles and skill documents.
   * Everything is HTML-escaped first, so only the tags produced here can occur.
   * Supports: fenced code, headings, bullet/numbered lists, tables, hr,
   * frontmatter (rendered as a metadata table), bold, italics, inline code.
   */

  var escapeHtml = function (text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // Inline formatting, applied to already-escaped text. Code spans are pulled out
  // first so emphasis markers inside them stay literal; the text is escaped by now,
  // so the NUL sentinel cannot collide with anything in it.
  var inline = function (text) {
    var codes = []
    var out = String(text).replace(/`([^`]+)`/g, function (match, code) {
      codes.push(code)
      return '\u0000' + (codes.length - 1) + '\u0000'
    })
    out = out
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      // `_x_` only at word boundaries, so snake_case identifiers survive
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    return out.replace(/\u0000(\d+)\u0000/g, function (match, index) {
      return '<code>' + codes[index] + '</code>'
    })
  }

  var isTableRow = function (line) { return /^\s*\|.*\|\s*$/.test(line) }
  var isDivider = function (line) { return /^\s*\|[\s:|-]+\|\s*$/.test(line) }
  var cells = function (line) {
    return line.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim() })
  }

  var renderTable = function (lines) {
    var head = cells(lines[0])
    var body = lines.slice(2).map(cells)
    var html = '<table class="kipMd-table"><thead><tr>'
    head.forEach(function (c) { html += '<th>' + inline(escapeHtml(c)) + '</th>' })
    html += '</tr></thead><tbody>'
    body.forEach(function (row) {
      html += '<tr>'
      row.forEach(function (c) { html += '<td>' + inline(escapeHtml(c)) + '</td>' })
      html += '</tr>'
    })
    return html + '</tbody></table>'
  }

  var renderFrontmatter = function (lines) {
    var html = '<dl class="kipMd-meta">'
    lines.forEach(function (line) {
      var kv = /^([^:]+):\s*(.*)$/.exec(line)
      if (!kv) return
      var value = kv[2].trim().replace(/^"(.*)"$/, '$1')
      html += '<dt>' + escapeHtml(kv[1].trim()) + '</dt><dd>' + inline(escapeHtml(value)) + '</dd>'
    })
    return html + '</dl>'
  }

  var render = function (markdown) {
    var lines = String(markdown == null ? '' : markdown).replace(/\r\n/g, '\n').split('\n')
    var html = ''
    var paragraph = []
    var list = null

    var flushParagraph = function () {
      if (!paragraph.length) return
      html += '<p>' + inline(escapeHtml(paragraph.join(' '))) + '</p>'
      paragraph = []
    }
    var flushList = function () {
      if (!list) return
      html += '<' + list.tag + '>' + list.items.map(function (i) {
        return '<li>' + inline(escapeHtml(i)) + '</li>'
      }).join('') + '</' + list.tag + '>'
      list = null
    }
    var flush = function () { flushParagraph(); flushList() }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]

      // frontmatter, only at the very top
      if (i === 0 && /^---\s*$/.test(line)) {
        var meta = []
        i++
        while (i < lines.length && !/^---\s*$/.test(lines[i])) { meta.push(lines[i]); i++ }
        html += renderFrontmatter(meta)
        continue
      }

      // fenced code
      var fence = /^\s*(```+|~~~+)\s*(\w+)?\s*$/.exec(line)
      if (fence) {
        flush()
        var code = []
        var marker = fence[1][0]
        i++
        while (i < lines.length && !new RegExp('^\\s*(' + marker + '{3,})\\s*$').test(lines[i])) {
          code.push(lines[i]); i++
        }
        html += '<pre class="kipMd-code"><code>' + escapeHtml(code.join('\n')) + '</code></pre>'
        continue
      }

      // table
      if (isTableRow(line) && isDivider(lines[i + 1] || '')) {
        flush()
        var block = []
        while (i < lines.length && isTableRow(lines[i])) { block.push(lines[i]); i++ }
        i--
        html += renderTable(block)
        continue
      }

      var heading = /^(#{1,6})\s+(.*)$/.exec(line)
      if (heading) {
        flush()
        var level = Math.min(heading[1].length + 1, 6)
        html += '<h' + level + ' class="kipMd-h">' + inline(escapeHtml(heading[2])) + '</h' + level + '>'
        continue
      }

      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { flush(); html += '<hr>'; continue }

      var bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
      var numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
      if (bullet || numbered) {
        flushParagraph()
        var tag = bullet ? 'ul' : 'ol'
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] } }
        list.items.push((bullet || numbered)[1])
        continue
      }

      if (!line.trim()) { flush(); continue }

      flushList()
      paragraph.push(line.trim())
    }

    flush()
    return html
  }

  return { render: render, escapeHtml: escapeHtml }
})
