(function () {
  try { var lang = localStorage.getItem("toolhub:lang-choice") || "en"; document.documentElement.lang = lang; document.documentElement.dir = /^(ar|ur)$/.test(lang) ? "rtl" : "ltr"; } catch (e) {}
  document.getElementById("retry").addEventListener("click", function () { location.reload(); });
})();
