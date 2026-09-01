sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, Filter, FilterOperator, Fragment, MessageToast, MessageBox) {
    "use strict";

    var AUTHORING = "/skill-authoring/";
    var REPOSITORY = "/skill-repository/";

    var EMPTY_SKILL = {
        SkillName: "", SkillDescription: "", SkillTriggerText: "",
        QueryTable: "", QueryFields: "", QueryWhere: ""
    };

    return Controller.extend("kip.skillauthoring.controller.App", {

        onInit: function () {
            this.getView().setModel(new JSONModel({ skills: [], busy: false }));
            this.getView().setModel(new JSONModel({
                query: "", busy: false, generated: false,
                skill: Object.assign({}, EMPTY_SKILL), meta: {}
            }), "create");
            this._loadSkills();
        },

        // ---------- helpers ----------

        _nav: function () {
            return this.byId("app");
        },

        _i18n: function (key, args) {
            return this.getView().getModel("i18n").getResourceBundle().getText(key, args);
        },

        _csrfToken: function (root) {
            return fetch(root, { headers: { "X-CSRF-Token": "Fetch", "Accept": "application/json" } })
                .then(function (r) { return r.headers.get("X-CSRF-Token") || ""; })
                .catch(function () { return ""; });
        },

        _postAction: function (root, action, body) {
            return this._csrfToken(root).then(function (token) {
                return fetch(root + action, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                        "X-CSRF-Token": token
                    },
                    body: JSON.stringify(body || {})
                });
            }).then(function (res) {
                return res.text().then(function (text) {
                    var data;
                    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
                    if (!res.ok) {
                        var msg = (data && data.error && data.error.message) || (res.status + " " + res.statusText);
                        throw new Error(typeof msg === "object" ? msg.value : msg);
                    }
                    return ("value" in data) ? data.value : data;
                });
            });
        },

        // ODataV2 -> { d: { results: [] } }, V4 -> { value: [] }, or a bare array/object
        _parseCollection: function (raw) {
            var payload = raw;
            if (typeof payload === "string") {
                try { payload = JSON.parse(payload); } catch (e) { return []; }
            }
            if (!payload) { return []; }
            if (payload.d && payload.d.results) { return payload.d.results; }
            if (payload.d) { return [payload.d]; }
            if (payload.value) { return payload.value; }
            return Array.isArray(payload) ? payload : [payload];
        },

        // ---------- list ----------

        _loadSkills: function () {
            var m = this.getView().getModel();
            m.setProperty("/busy", true);
            fetch(REPOSITORY + "getSkills()", { headers: { Accept: "application/json" } })
                .then(function (r) { return r.text(); })
                .then(function (text) {
                    var data;
                    try { data = JSON.parse(text); } catch (e) { data = text; }
                    var raw = (data && "value" in data) ? data.value : data;
                    m.setProperty("/skills", this._parseCollection(raw));
                    m.setProperty("/busy", false);
                }.bind(this))
                .catch(function (err) {
                    m.setProperty("/busy", false);
                    MessageBox.error(this._i18n("loadFail", [err.message]));
                }.bind(this));
        },

        onRefresh: function () {
            this._loadSkills();
        },

        onSearch: function (oEvent) {
            var q = (oEvent.getParameter("newValue") || oEvent.getParameter("query") || "").trim();
            var binding = this.byId("skillsTable").getBinding("items");
            binding.filter(q ? [new Filter({
                filters: [
                    new Filter("SkillName", FilterOperator.Contains, q),
                    new Filter("QueryTable", FilterOperator.Contains, q),
                    new Filter("SkillDescription", FilterOperator.Contains, q)
                ],
                and: false
            })] : []);
        },

        onOpenDetails: function (oEvent) {
            var ctx = oEvent.getSource().getBindingContext();
            var data = ctx.getObject();
            this.getView().setModel(new JSONModel(data), "detail");

            if (!this._detailDialog) {
                this._detailDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "kip.skillauthoring.view.SkillDetails",
                    controller: this
                }).then(function (dlg) {
                    this.getView().addDependent(dlg);
                    return dlg;
                }.bind(this));
            }
            this._detailDialog.then(function (dlg) { dlg.open(); });
        },

        onCloseDetails: function () {
            this._detailDialog.then(function (dlg) { dlg.close(); });
        },

        // ---------- create (object page) ----------

        onOpenCreate: function () {
            this.getView().getModel("create").setData({
                query: "", busy: false, generated: false,
                skill: Object.assign({}, EMPTY_SKILL), meta: {}
            });
            this._nav().to(this.byId("createPage"));
        },

        onCloseCreate: function () {
            this._nav().back();
        },

        onGenerate: function () {
            var m = this.getView().getModel("create");
            var query = (m.getProperty("/query") || "").trim();
            if (!query) { return; }
            m.setProperty("/busy", true);

            this._postAction(AUTHORING, "generateSkill", { query: query })
                .then(function (result) {
                    if (result.error) { throw new Error(result.error); }
                    var tc = result.tableChoice || {};
                    m.setProperty("/skill", Object.assign({}, EMPTY_SKILL, result.skill || {}));
                    m.setProperty("/meta", {
                        reasoning: result.reasoning || "",
                        table: tc.table || "",
                        keyField: tc.keyField || "",
                        confidence: tc.confidence || "",
                        alternatives: (tc.alternatives || []).join(", "),
                        candidateFields: (tc.candidateFields || []).join(", ")
                    });
                    m.setProperty("/generated", true);
                    m.setProperty("/busy", false);
                    MessageToast.show(this._i18n("genOk"));
                }.bind(this))
                .catch(function (err) {
                    m.setProperty("/busy", false);
                    MessageBox.error(this._i18n("genFail", [err.message]));
                }.bind(this));
        },

        onSaveNew: function () {
            var m = this.getView().getModel("create");
            if (!m.getProperty("/generated")) {
                MessageToast.show(this._i18n("nothingToSave"));
                return;
            }
            m.setProperty("/busy", true);

            this._postAction(REPOSITORY, "createSkill", { skill: m.getProperty("/skill") })
                .then(function () {
                    m.setProperty("/busy", false);
                    MessageToast.show(this._i18n("saveOk"));
                    this._nav().back();
                    this._loadSkills();
                }.bind(this))
                .catch(function (err) {
                    m.setProperty("/busy", false);
                    MessageBox.error(this._i18n("saveFail", [err.message]));
                }.bind(this));
        }
    });
});
