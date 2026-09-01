sap.ui.define([
    "sap/ui/core/ComponentContainer"
], function (ComponentContainer) {
    "use strict";

    new ComponentContainer({
        name: "kip.skillauthoring",
        manifest: true,
        async: true,
        height: "100%",
        settings: { id: "skillauthoring" }
    }).placeAt("content");
});
