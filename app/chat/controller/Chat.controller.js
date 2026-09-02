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
  'sap/m/TextArea',
  'sap/m/Toolbar',
  'sap/m/ToolbarSpacer',
  'sap/m/MessageToast',
  'kip/chat/model/markdown',
], function (
  Controller, JSONModel, HTML, VBox, HBox, Text, Title, Button, Panel, TextArea,
  Toolbar, ToolbarSpacer, MessageToast, markdown
) {
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

      // The document currently open in this chat; sent with every turn so the
      // assistant revises what the user actually sees, edits included.
      this._context = null

      this._renderMessages()
      this._loadCommands()

      this.byId('input').addEventDelegate({
        onkeydown: function (event) {
          // keyCode as well as key: some environments dispatch keydown without `key`
          var suggestions = this._model.getProperty('/suggestions')

          // Tab completes the top command suggestion, then you type the argument.
          var isTab = event.key === 'Tab' || event.keyCode === 9 || event.which === 9
          if (isTab && !event.shiftKey && suggestions.length) {
            event.preventDefault()
            this._applySuggestion(suggestions[0])
            return
          }

          var isEnter = event.key === 'Enter' || event.keyCode === 13 || event.which === 13
          if (!isEnter || event.shiftKey) return
          event.preventDefault()
          if (suggestions.length) {
            this._applySuggestion(suggestions[0])
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

    /** Runs one backend call as a turn: busy state, reply, scroll. */
    _turn: async function (busyText, run) {
      this._model.setProperty('/busyText', busyText)
      this._model.setProperty('/busy', true)
      this._scrollToBottom()
      try {
        var replyMessage = await run()
        this._push(replyMessage)
        this._syncContext(replyMessage)
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

    /**
     * Keeps the open document in sync with what the assistant last returned.
     * Only an unsaved draft opens for editing. Once the skill is written to SAP
     * (or a routed answer comes back), the next plain message is a data request
     * again — editing a stored skill then needs an explicit `/update-skill`.
     */
    _syncContext: function (message) {
      if (message.saved || message.kind === 'route') {
        this._context = null
        return
      }
      var editable = message.mode === 'create' || message.mode === 'update'
      if (message.markdown && editable) {
        this._context = {
          markdown: message.markdown,
          name: message.target || '',
          mode: message.mode,
          storedVersion: message.storedVersion || '',
        }
      }
    },

    /* -------------------------------------------------------------- chat -- */

    onSend: function () {
      var text = (this._model.getProperty('/input') || '').trim()
      if (!text || this._model.getProperty('/busy')) return
      this._model.setProperty('/input', '')
      this._model.setProperty('/suggestions', [])
      this._renderSuggestions()
      this._sendText(text)
    },

    _sendText: function (text) {
      this._push({ role: 'user', text: text })
      var busy = /^\/(create|update)-skill/.test(text)
        ? 'Drafting the skill…'
        : this._context
          ? 'Revising the document…'
          : 'Looking for a skill that fits…'
      this._turn(busy, function () {
        return this._call('/chat', { message: text, context: this._context || undefined })
      }.bind(this))
    },

    onNewChat: function () {
      this._context = null
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

    /* ------------------------------------------------ save / delete calls -- */

    onSaveSkill: function (message) {
      if (this._model.getProperty('/busy')) return
      this._turn('Saving to SAP…', function () {
        return this._call('/saveSkill', {
          markdown: message.markdown,
          mode: message.mode || 'create',
          name: message.target || '',
          storedVersion: message.storedVersion || '',
        })
      }.bind(this))
    },

    onDeleteSkill: function (message) {
      if (this._model.getProperty('/busy')) return
      this._turn('Deleting from SAP…', function () {
        return this._call('/confirmDelete', { name: message.target })
      }.bind(this))
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
      var messages = this._model.getProperty('/messages')
      messages.forEach(function (message, index) {
        var isLast = index === messages.length - 1
        container.addItem(
          message.role === 'user' ? this._userMessage(message) : this._assistantMessage(message, isLast)
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

    _assistantMessage: function (message, isLast) {
      var row = new VBox().addStyleClass('kipRow kipRow--assistant')
      if (message.kind === 'error') row.addStyleClass('kipRow--error')

      row.addItem(this._html('<div class="kipMd">' + markdown.render(message.text) + '</div>'))

      if (message.candidates && message.candidates.length) {
        row.addItem(this._candidateList(message, isLast))
      }
      if (message.markdown) row.addItem(this._skillCard(message, isLast))
      return row
    },

    /** Ambiguous /delete-skill or /update-skill: let the user pick one. */
    _candidateList: function (message, isLast) {
      var list = new VBox().addStyleClass('kipCandidates')
      var command = message.mode === 'delete' ? '/delete-skill ' : '/update-skill '
      message.candidates.forEach(function (candidate) {
        var tile = new VBox().addStyleClass('kipCandidate')
        var head = new Text().addStyleClass('kipCandidateName')
        head.setText(candidate.name)
        var meta = new Text().addStyleClass('kipCandidateMeta')
        meta.setText([candidate.version, candidate.status].filter(Boolean).join(' · '))
        var desc = new Text().addStyleClass('kipCandidateDesc')
        desc.setText(candidate.description || '')
        tile.addItem(new HBox({ items: [head, meta] }).addStyleClass('kipCandidateHead'))
        tile.addItem(desc)
        if (isLast) {
          tile.attachBrowserEvent('click', this._sendText.bind(this, command + candidate.name))
        } else {
          tile.addStyleClass('kipCandidate--stale')
        }
        list.addItem(tile)
      }.bind(this))
      return list
    },

    /**
     * The skill document. Buttons live only on the newest card, so an older draft
     * in the scrollback can never be saved or deleted by accident.
     */
    _skillCard: function (message, isLast) {
      var skill = message.skill || {}
      var actions = isLast ? message.actions || [] : []
      var badges = [skill.version && 'v' + skill.version, skill.status, message.saved ? 'saved' : null]
        .filter(Boolean)
        .join(' · ')

      var title = new Title({ level: 'H3' }).addStyleClass('kipDocTitle')
      title.setText(skill.name || message.target || 'Skill')
      var badgeText = new Text().addStyleClass('kipDocBadges')
      badgeText.setText(badges)

      var bar = [title, badgeText, new ToolbarSpacer()]

      if (actions.indexOf('save') >= 0) {
        bar.push(new Button({
          icon: message.editing ? 'sap-icon://display' : 'sap-icon://edit',
          text: message.editing ? 'Preview' : 'Edit',
          type: 'Transparent',
          press: this._toggleEdit.bind(this, message),
        }))
      }
      bar.push(new Button({
        icon: 'sap-icon://copy',
        text: 'Copy Markdown',
        type: 'Transparent',
        press: this._copy.bind(this, message.markdown),
      }))
      if (actions.indexOf('save') >= 0) {
        bar.push(new Button({
          icon: 'sap-icon://save',
          text: message.mode === 'update' ? 'Save skill (update)' : 'Save skill',
          type: 'Emphasized',
          press: this.onSaveSkill.bind(this, message),
        }).addStyleClass('kipSave'))
      }
      if (actions.indexOf('delete') >= 0) {
        bar.push(new Button({
          icon: 'sap-icon://delete',
          text: 'Delete skill',
          type: 'Reject',
          press: this.onDeleteSkill.bind(this, message),
        }).addStyleClass('kipDelete'))
      }

      var body
      if (message.editing) {
        body = new TextArea({
          rows: 18,
          width: '100%',
          growing: false,
          liveChange: function (event) {
            message.markdown = event.getParameter('value')
            if (this._context) this._context.markdown = message.markdown
          }.bind(this),
        }).addStyleClass('kipDocEditor')
        body.setValue(message.markdown)
      } else {
        body = this._html('<div class="kipMd kipMd--doc">' + markdown.render(message.markdown) + '</div>')
      }

      var panel = new Panel({
        expandable: true,
        expanded: true,
        headerToolbar: new Toolbar({ content: bar }).addStyleClass('kipDocBar'),
        content: [body],
      }).addStyleClass('kipDoc')

      if (message.kind === 'route') panel.addStyleClass('kipDoc--route')
      else if (message.kind === 'delete') panel.addStyleClass('kipDoc--delete')
      else if (actions.indexOf('save') >= 0 && !message.saved) panel.addStyleClass('kipDoc--unsaved')
      return panel
    },

    _toggleEdit: function (message) {
      message.editing = !message.editing
      this._renderMessages()
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
