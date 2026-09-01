sap.ui.define([
    "sap/ui/core/ComponentContainer"
], function (ComponentContainer) {
    "use strict";

    var splash = document.getElementById("kip-splash");
    if (splash) { splash.parentNode.removeChild(splash); }

    new ComponentContainer({
        name: "kip.skillauthoring",
        manifest: true,
        async: true,
        height: "100%",
        settings: { id: "skillauthoring" }
    }).placeAt("content");
});
