sap.ui.define([
  'sap/ui/core/mvc/Controller',
  'sap/ui/model/json/JSONModel',
  'sap/ui/core/HTML',
  'sap/m/VBox',
  'sap/m/HBox',
  'sap/m/Text',
  'sap/m/Title',
  'sap/m/Button',
  'sap/m/Panel',
  'sap/m/Toolbar',
  'sap/m/ToolbarSpacer',
  'sap/m/MessageToast',
  'kip/chat/model/markdown',
], function (Controller, JSONModel, HTML, VBox, HBox, Text, Title, Button, Panel, Toolbar, ToolbarSpacer, MessageToast, markdown) {
  'use strict'

  var SERVICE = '/skill-chat'

  return Controller.extend('kip.chat.controller.Chat', {

    onInit: function () {
      this._model = new JSONModel({
        messages: [],
        commands: [],
        suggestions: [],
        input: '',
        busy: false,
        busyText: 'Thinking…',
      })
      this.getView().setModel(this._model)

      this._renderMessages()
      this._loadCommands()

      // Enter sends, Shift+Enter inserts a newline
      this.byId('input').addEventDelegate({
        onkeydown: function (event) {
          // keyCode as well as key: some environments dispatch keydown without `key`
          var isEnter = event.key === 'Enter' || event.keyCode === 13 || event.which === 13
          if (!isEnter || event.shiftKey) return
          event.preventDefault()
          if (this._model.getProperty('/suggestions').length) {
            this._applySuggestion(this._model.getProperty('/suggestions')[0])
            return
          }
          this.onSend()
        }.bind(this),
      })
    },

    /* ----------------------------------------------------------- backend -- */

    _csrfToken: null,

    _call: async function (path, payload) {
      var options = {
        method: payload ? 'POST' : 'GET',
        headers: { Accept: 'application/json' },
      }
      if (payload) {
        options.headers['Content-Type'] = 'application/json'
        options.body = JSON.stringify(payload)
        if (!this._csrfToken) {
          var probe = await fetch(SERVICE + '/', { headers: { 'X-CSRF-Token': 'Fetch' } })
          this._csrfToken = probe.headers.get('x-csrf-token')
        }
        if (this._csrfToken) options.headers['X-CSRF-Token'] = this._csrfToken
      }
      var response = await fetch(SERVICE + path, options)
      var body = await response.text()
      var data = body ? JSON.parse(body) : {}
      if (!response.ok) {
        throw new Error(data?.error?.message || response.statusText || 'Request failed')
      }
      return data
    },

    _loadCommands: async function () {
      try {
        var data = await this._call('/commands()')
        this._model.setProperty('/commands', data.value || [])
      } catch (err) {
        // the input still works, it just loses the autocomplete
        this._model.setProperty('/commands', [])
      }
      this._renderHeroCommands()
    },

    /* -------------------------------------------------------------- chat -- */

    onSend: async function () {
      var text = (this._model.getProperty('/input') || '').trim()
      if (!text || this._model.getProperty('/busy')) return

      this._push({ role: 'user', text: text })
      this._model.setProperty('/input', '')
      this._model.setProperty('/suggestions', [])
      this._model.setProperty(
        '/busyText',
        text.startsWith('/create-skill') ? 'Building the skill and saving it to SAP…' : 'Thinking…'
      )
      this._model.setProperty('/busy', true)
      this._scrollToBottom()

      try {
        var reply = await this._call('/chat', { message: text })
        this._push(reply)
      } catch (err) {
        this._push({
          role: 'assistant',
          kind: 'error',
          text: 'Something went wrong.\n\n```\n' + String(err.message).split('\n')[0] + '\n```',
        })
      } finally {
        this._model.setProperty('/busy', false)
        this._scrollToBottom()
      }
    },

    onNewChat: function () {
      this._model.setProperty('/messages', [])
      this._model.setProperty('/input', '')
      this._model.setProperty('/suggestions', [])
      this._renderMessages()
    },

    _push: function (message) {
      var messages = this._model.getProperty('/messages').concat([message])
      this._model.setProperty('/messages', messages)
      this._renderMessages()
    },

    /* --------------------------------------------------- slash commands -- */

    onLiveChange: function (event) {
      var value = event.getParameter('value') || ''
      this._model.setProperty('/input', value)
      var isCommand = /^\/\S*$/.test(value.trim())
      var query = value.trim().toLowerCase()
      var matches = !isCommand
        ? []
        : this._model.getProperty('/commands').filter(function (c) {
            return c.name.toLowerCase().indexOf(query) === 0
          })
      this._model.setProperty('/suggestions', matches)
      this._renderSuggestions()
    },

    onInsertCreateSkill: function () {
      this._applySuggestion({ name: '/create-skill' })
    },

    _applySuggestion: function (command) {
      this._model.setProperty('/input', command.name + ' ')
      this._model.setProperty('/suggestions', [])
      this._renderSuggestions()
      var input = this.byId('input')
      input.focus()
      setTimeout(function () {
        var dom = input.getFocusDomRef()
        if (dom) dom.setSelectionRange(dom.value.length, dom.value.length)
      }, 0)
    },

    _commandTile: function (command, compact) {
      var box = new VBox().addStyleClass('kipCmd')
      box.addStyleClass(compact ? 'kipCmd--compact' : 'kipCmd--hero')
      var name = new Text().addStyleClass('kipCmdName')
      name.setText(command.name)
      var args = new Text().addStyleClass('kipCmdArgs')
      args.setText(command.args || '')
      var desc = new Text().addStyleClass('kipCmdDesc')
      desc.setText(command.description || '')
      box.addItem(new HBox({ items: [name, args] }).addStyleClass('kipCmdHead'))
      box.addItem(desc)
      box.attachBrowserEvent('click', this._applySuggestion.bind(this, command))
      return box
    },

    _renderSuggestions: function () {
      var container = this.byId('suggestions')
      container.destroyItems()
      this._model.getProperty('/suggestions').forEach(function (command) {
        container.addItem(this._commandTile(command, true))
      }.bind(this))
    },

    _renderHeroCommands: function () {
      var container = this.byId('heroCommands')
      container.destroyItems()
      this._model.getProperty('/commands').forEach(function (command) {
        container.addItem(this._commandTile(command, false))
      }.bind(this))
    },

    /* ---------------------------------------------------------- messages -- */

    _renderMessages: function () {
      var container = this.byId('messages')
      container.destroyItems()
      this._model.getProperty('/messages').forEach(function (message) {
        container.addItem(
          message.role === 'user' ? this._userMessage(message) : this._assistantMessage(message)
        )
      }.bind(this))
    },

    /**
     * Never pass generated text through a control constructor: ManagedObject runs
     * the binding parser over settings, so a skill's {placeholder} tokens would be
     * swallowed as binding paths. Setters take the string as-is.
     */
    _html: function (content) {
      var html = new HTML({ sanitizeContent: false })
      html.setContent(content)
      return html
    },

    // Rendered as plain HTML: a UI5 FlexBox would wrap the bubble in a flex item
    // that shrinks to min-content and breaks short messages across lines.
    _userMessage: function (message) {
      return this._html(
        '<div class="kipRow kipRow--user"><div class="kipBubble">' +
          markdown.escapeHtml(message.text) +
          '</div></div>'
      )
    },

    _assistantMessage: function (message) {
      var row = new VBox().addStyleClass('kipRow kipRow--assistant')
      if (message.kind === 'error') row.addStyleClass('kipRow--error')

      row.addItem(this._html('<div class="kipMd">' + markdown.render(message.text) + '</div>'))

      if (message.markdown) row.addItem(this._skillCard(message))
      return row
    },

    /** The generated skill document, shown as a collapsible card. */
    _skillCard: function (message) {
      var skill = message.skill || {}
      var badges = [skill.version, skill.status, (skill.queries || []).length + ' query']
        .filter(Boolean)
        .join(' · ')

      var title = new Title({ level: 'H3' }).addStyleClass('kipDocTitle')
      title.setText(skill.name || 'Skill')

      var panel = new Panel({
        expandable: true,
        expanded: true,
        headerToolbar: new Toolbar({
          content: [
            title,
            new Text({ text: badges }).addStyleClass('kipDocBadges'),
            new ToolbarSpacer(),
            new Button({
              icon: 'sap-icon://copy',
              text: 'Copy Markdown',
              type: 'Transparent',
              press: this._copy.bind(this, message.markdown),
            }),
          ],
        }).addStyleClass('kipDocBar'),
        content: [
          this._html('<div class="kipMd kipMd--doc">' + markdown.render(message.markdown) + '</div>'),
        ],
      }).addStyleClass('kipDoc')

      if (!message.saved) panel.addStyleClass('kipDoc--unsaved')
      return panel
    },

    _copy: function (text) {
      navigator.clipboard.writeText(text).then(
        function () { MessageToast.show('Markdown copied') },
        function () { MessageToast.show('Could not copy') }
      )
    },

    // Assign scrollTop directly: ScrollContainer#scrollTo does not move this
    // container, and smooth scrolling stalls when the tab is not in the foreground.
    _scrollToBottom: function () {
      var scroll = this.byId('scroll')
      setTimeout(function () {
        var dom = scroll.getDomRef()
        if (dom) dom.scrollTop = dom.scrollHeight
      }, 60)
    },
  })
})
