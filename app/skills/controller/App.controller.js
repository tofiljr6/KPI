sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    var AUTHORING = "/skill-authoring/";
    var REPOSITORY = "/skill-repository/";

    var EMPTY_SKILL = {
        SkillName: "",
        SkillDescription: "",
        SkillTriggerText: "",
        QueryTable: "",
        QueryFields: "",
        QueryWhere: ""
    };

    return Controller.extend("kip.skillauthoring.controller.App", {

        onInit: function () {
            this.getView().setModel(new JSONModel({
                query: "",
                busy: false,
                generated: false,
                skill: Object.assign({}, EMPTY_SKILL),
                meta: {}
            }));
        },

        _model: function () {
            return this.getView().getModel();
        },

        _i18n: function (key, args) {
            return this.getView().getModel("i18n").getResourceBundle().getText(key, args);
        },

        // Fetch a CSRF token for the given OData service root.
        _csrfToken: function (serviceRoot) {
            return fetch(serviceRoot, {
                method: "GET",
                headers: { "X-CSRF-Token": "Fetch", "Accept": "application/json" }
            }).then(function (res) {
                return res.headers.get("X-CSRF-Token") || "";
            }).catch(function () {
                return "";
            });
        },

        _postAction: function (serviceRoot, action, body) {
            var that = this;
            return this._csrfToken(serviceRoot).then(function (token) {
                return fetch(serviceRoot + action, {
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
                        var msg = (data && data.error && data.error.message) || res.status + " " + res.statusText;
                        throw new Error(typeof msg === "object" ? msg.value : msg);
                    }
                    return ("value" in data) ? data.value : data;
                });
            }).catch(function (err) {
                that._model().setProperty("/busy", false);
                throw err;
            });
        },

        onGenerate: function () {
            var m = this._model();
            var query = (m.getProperty("/query") || "").trim();
            if (!query) { return; }

            m.setProperty("/busy", true);

            this._postAction(AUTHORING, "generateSkill", { query: query })
                .then(function (result) {
                    if (result.error) {
                        throw new Error(result.error);
                    }
                    var skill = result.skill || {};
                    var tc = result.tableChoice || {};
                    m.setProperty("/skill", Object.assign({}, EMPTY_SKILL, skill));
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

        onSave: function () {
            var m = this._model();
            if (!m.getProperty("/generated")) {
                MessageToast.show(this._i18n("nothingToSave"));
                return;
            }
            m.setProperty("/busy", true);

            this._postAction(REPOSITORY, "createSkill", { skill: m.getProperty("/skill") })
                .then(function (created) {
                    m.setProperty("/busy", false);
                    MessageBox.success(this._i18n("saveOk"), {
                        details: typeof created === "string" ? created : JSON.stringify(created, null, 2)
                    });
                }.bind(this))
                .catch(function (err) {
                    m.setProperty("/busy", false);
                    MessageBox.error(this._i18n("saveFail", [err.message]));
                }.bind(this));
        },

        onReset: function () {
            var m = this._model();
            m.setProperty("/skill", Object.assign({}, EMPTY_SKILL));
            m.setProperty("/meta", {});
            m.setProperty("/generated", false);
        }
    });
});
