var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => GeoGebraPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian2 = require("obsidian");

// src/types.ts
var LANGUAGE_MODE_MAP = {
  "geogebra": "2d" /* Geometry2D */,
  "ggb": "2d" /* Geometry2D */,
  "geogebra-3d": "3d" /* Geometry3D */,
  "ggb-3d": "3d" /* Geometry3D */,
  "geogebra-graph": "graph" /* Graph */,
  "ggb-graph": "graph" /* Graph */
};

// src/geogebra-loader.ts
var import_obsidian = require("obsidian");
var GGB_HOSTS = ["geogebra.org", "geogebra.net"];
var textCache = /* @__PURE__ */ new Map();
var interceptorInstalled = false;
var origAppendChild;
var origInsertBefore;
var origXHROpen;
var origXHRSend;
var origFetch;
var origScriptSrcDescriptor;
var xhrInterceptMap = /* @__PURE__ */ new WeakMap();
var GWT_FRAGMENT_RE = /^(?:.*\/)?[A-F0-9]{32}\.cache\.js$/i;
function isGeoGebraUrl(url) {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return false;
  return GGB_HOSTS.some((host) => url.includes(host));
}
function resolveMisroutedUrl(url) {
  if (!ggbVersion) return null;
  const cdnBase = `https://www.geogebra.org/apps/${ggbVersion}/web3d/`;
  const appBase = `https://www.geogebra.org/apps/${ggbVersion}/`;
  if (isGeoGebraUrl(url)) return null;
  const relativePath = url.replace(/^app:\/\/[^/]+\//, "");
  const filename = relativePath.split("/").pop() || "";
  if (GWT_FRAGMENT_RE.test(filename)) {
    return cdnBase + filename;
  }
  const deferredMatch = relativePath.match(/deferredjs\/.*$/);
  if (deferredMatch) {
    return cdnBase + deferredMatch[0];
  }
  if (relativePath.startsWith("css/") && relativePath.endsWith(".css")) {
    return appBase + relativePath;
  }
  const cleanPath = relativePath.replace(/\?.*$/, "");
  if (cleanPath.startsWith("fonts/") && cleanPath.endsWith(".js")) {
    return cdnBase + cleanPath;
  }
  if (cleanPath.startsWith("js/") && cleanPath.endsWith(".js")) {
    return appBase + cleanPath;
  }
  if (cleanPath.endsWith(".html") && !cleanPath.includes("obsidian")) {
    return appBase + cleanPath;
  }
  return null;
}
function getInterceptUrl(url) {
  if (isGeoGebraUrl(url)) return url;
  return resolveMisroutedUrl(url);
}
var BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://www.geogebra.org/",
  "Origin": "https://www.geogebra.org"
};
function fetchText(url) {
  if (textCache.has(url)) return textCache.get(url);
  const promise = (async () => {
    console.log(`[GeoGebra] Fetching text: ${url.substring(0, 120)}`);
    const response = await (0, import_obsidian.requestUrl)({ url, headers: BROWSER_HEADERS });
    console.log(`[GeoGebra] OK: ${url.split("/").pop()?.substring(0, 50)} (${response.text.length} bytes)`);
    return response.text;
  })();
  textCache.set(url, promise);
  return promise;
}
async function handleScriptInterception(parent, child, fetchUrl, evalContext, refNode) {
  try {
    const code = await fetchText(fetchUrl);
    const blob = new Blob([code], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);
    const filename = fetchUrl.split("/").pop()?.substring(0, 60) || "unknown";
    child.removeAttribute("src");
    child.src = blobUrl;
    const origOnload = child.onload;
    const origOnerror = child.onerror;
    child.onload = function(ev) {
      URL.revokeObjectURL(blobUrl);
      console.log(`[GeoGebra] Script loaded via blob: ${filename}`);
      if (origOnload) {
        try {
          origOnload.call(this, ev);
        } catch (e) {
          console.warn(`[GeoGebra] onload callback error for ${filename}:`, e);
        }
      }
    };
    child.onerror = function(ev) {
      URL.revokeObjectURL(blobUrl);
      console.warn(`[GeoGebra] Blob script failed for ${filename}, falling back to eval`);
      try {
        if (evalContext && evalContext !== window) {
          evalContext.eval(code);
        } else {
          (0, eval)(code);
        }
        console.log(`[GeoGebra] Executed script via eval fallback: ${filename}`);
      } catch (e2) {
        console.error(`[GeoGebra] Eval fallback also failed: ${filename}`, e2);
      }
      if (origOnerror) {
        try {
          origOnerror.call(this, ev);
        } catch {
        }
      }
    };
    if (refNode !== void 0 && refNode !== null) {
      origInsertBefore.call(parent, child, refNode);
    } else {
      origAppendChild.call(parent, child);
    }
    console.log(`[GeoGebra] Appended script with blob URL: ${filename}`);
  } catch (e) {
    console.error(`[GeoGebra] Failed to handle script: ${fetchUrl}`, e);
    if (child.onerror) {
      try {
        child.onerror(e);
      } catch {
      }
    }
    try {
      child.dispatchEvent(new Event("error"));
    } catch {
    }
  }
}
async function handleLinkInterception(parent, child, fetchUrl, refNode) {
  try {
    const cssText = await fetchText(fetchUrl);
    const style = document.createElement("style");
    style.textContent = cssText;
    style.setAttribute("data-geogebra-src", fetchUrl);
    origAppendChild.call(document.head, style);
    console.log(`[GeoGebra] Injected CSS: ${fetchUrl.split("/").pop()?.substring(0, 50)}`);
    if (child.onload) {
      try {
        child.onload(new Event("load"));
      } catch {
      }
    }
    try {
      child.dispatchEvent(new Event("load"));
    } catch {
    }
  } catch (e) {
    console.error(`[GeoGebra] Failed to load CSS: ${fetchUrl}`, e);
    if (refNode !== void 0) {
      origInsertBefore.call(parent, child, refNode);
    } else {
      origAppendChild.call(parent, child);
    }
  }
}
function isScriptElement(node) {
  return node.nodeName === "SCRIPT";
}
function isLinkElement(node) {
  return node.nodeName === "LINK";
}
function patchNodePrototype(win, label) {
  const proto = win.Node.prototype;
  const _origAppend = proto.appendChild;
  const _origInsert = proto.insertBefore;
  proto.appendChild = function(child) {
    if (isScriptElement(child)) {
      const src = child.getAttribute("src") || child.src || "";
      if (src) {
        const interceptUrl = getInterceptUrl(src);
        if (interceptUrl) {
          console.log(`[GeoGebra][${label}] Intercepting script: ${src.substring(0, 80)} \u2192 CDN`);
          handleScriptInterception(this, child, interceptUrl, win);
          return child;
        }
      }
    }
    if (isLinkElement(child)) {
      const href = child.href || child.getAttribute("href") || "";
      if (href) {
        const interceptUrl = getInterceptUrl(href);
        if (interceptUrl) {
          console.log(`[GeoGebra][${label}] Intercepting link: ${href.substring(0, 80)} \u2192 CDN`);
          handleLinkInterception(this, child, interceptUrl);
          return child;
        }
      }
    }
    const result = _origAppend.call(this, child);
    if (child.nodeName === "IFRAME") {
      patchIframe(child);
    }
    return result;
  };
  proto.insertBefore = function(child, ref) {
    if (isScriptElement(child)) {
      const src = child.getAttribute("src") || child.src || "";
      if (src) {
        const interceptUrl = getInterceptUrl(src);
        if (interceptUrl) {
          console.log(`[GeoGebra][${label}] Intercepting script: ${src.substring(0, 80)} \u2192 CDN`);
          handleScriptInterception(this, child, interceptUrl, win, ref);
          return child;
        }
      }
    }
    if (isLinkElement(child)) {
      const href = child.href || child.getAttribute("href") || "";
      if (href) {
        const interceptUrl = getInterceptUrl(href);
        if (interceptUrl) {
          console.log(`[GeoGebra][${label}] Intercepting link: ${href.substring(0, 80)} \u2192 CDN`);
          handleLinkInterception(this, child, interceptUrl, ref);
          return child;
        }
      }
    }
    const result = _origInsert.call(this, child, ref);
    if (child.nodeName === "IFRAME") {
      patchIframe(child);
    }
    return result;
  };
}
var patchedIframes = /* @__PURE__ */ new WeakSet();
function patchIframe(iframe) {
  if (patchedIframes.has(iframe)) return;
  patchedIframes.add(iframe);
  function doPatch() {
    try {
      const iframeWin = iframe.contentWindow;
      if (iframeWin && iframeWin.Node) {
        patchNodePrototype(iframeWin, "iframe");
        console.log("[GeoGebra] Patched iframe Node.prototype");
      }
    } catch (e) {
    }
  }
  doPatch();
  iframe.addEventListener("load", doPatch);
}
function installDOMInterceptor() {
  origAppendChild = Node.prototype.appendChild;
  origInsertBefore = Node.prototype.insertBefore;
  patchNodePrototype(window, "main");
  origScriptSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLScriptElement.prototype,
    "src"
  );
  if (origScriptSrcDescriptor && origScriptSrcDescriptor.set) {
    const origSet = origScriptSrcDescriptor.set;
    const origGet = origScriptSrcDescriptor.get;
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      get() {
        return origGet ? origGet.call(this) : "";
      },
      set(value) {
        const interceptUrl = getInterceptUrl(value);
        if (interceptUrl) {
          const scriptEl = this;
          fetchText(interceptUrl).then((code) => {
            const blob = new Blob([code], { type: "application/javascript" });
            const blobUrl = URL.createObjectURL(blob);
            origSet.call(scriptEl, blobUrl);
            scriptEl.addEventListener("load", () => URL.revokeObjectURL(blobUrl), { once: true });
            scriptEl.addEventListener("error", () => URL.revokeObjectURL(blobUrl), { once: true });
          }).catch((e) => {
            console.warn(`[GeoGebra] src interceptor fetch failed: ${value}`, e);
            origSet.call(scriptEl, value);
          });
          return;
        }
        origSet.call(this, value);
      },
      configurable: true,
      enumerable: true
    });
  }
  console.log("[GeoGebra] DOM interceptor installed");
}
function installXHRInterceptor() {
  origXHROpen = XMLHttpRequest.prototype.open;
  origXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, async, username, password) {
    const urlStr = url.toString();
    const interceptUrl = getInterceptUrl(urlStr);
    if (interceptUrl) {
      xhrInterceptMap.set(this, { url: interceptUrl, method });
      console.log(`[GeoGebra] XHR intercepted: ${method} ${urlStr.substring(0, 100)}`);
    }
    return origXHROpen.call(this, method, url, async ?? true, username, password);
  };
  XMLHttpRequest.prototype.send = function(body) {
    const interceptInfo = xhrInterceptMap.get(this);
    if (interceptInfo) {
      const { url } = interceptInfo;
      (0, import_obsidian.requestUrl)({ url, headers: BROWSER_HEADERS }).then((response) => {
        Object.defineProperty(this, "readyState", { value: 4, writable: true, configurable: true });
        Object.defineProperty(this, "status", { value: 200, writable: true, configurable: true });
        Object.defineProperty(this, "statusText", { value: "OK", writable: true, configurable: true });
        Object.defineProperty(this, "responseText", { value: response.text, writable: true, configurable: true });
        Object.defineProperty(this, "response", { value: response.text, writable: true, configurable: true });
        Object.defineProperty(this, "responseURL", { value: url, writable: true, configurable: true });
        console.log(`[GeoGebra] XHR proxied OK: ${url.split("/").pop()?.substring(0, 50)}`);
        this.dispatchEvent(new Event("readystatechange"));
        this.dispatchEvent(new ProgressEvent("progress"));
        this.dispatchEvent(new Event("load"));
        this.dispatchEvent(new ProgressEvent("loadend"));
        if (this.onreadystatechange) {
          try {
            this.onreadystatechange(new Event("readystatechange"));
          } catch {
          }
        }
        if (this.onload) {
          try {
            this.onload(new ProgressEvent("load"));
          } catch {
          }
        }
      }).catch((e) => {
        console.error(`[GeoGebra] XHR proxy failed: ${url}`, e);
        Object.defineProperty(this, "readyState", { value: 4, writable: true, configurable: true });
        Object.defineProperty(this, "status", { value: 0, writable: true, configurable: true });
        this.dispatchEvent(new ProgressEvent("error"));
        this.dispatchEvent(new ProgressEvent("loadend"));
        if (this.onerror) {
          try {
            this.onerror(new ProgressEvent("error"));
          } catch {
          }
        }
      });
      return;
    }
    return origXHRSend.call(this, body);
  };
  console.log("[GeoGebra] XHR interceptor installed");
}
function installFetchInterceptor() {
  origFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const url = input instanceof Request ? input.url : input.toString();
    const interceptUrl = getInterceptUrl(url);
    if (interceptUrl) {
      console.log(`[GeoGebra] Fetch intercepted: ${url.substring(0, 100)} \u2192 ${interceptUrl.substring(0, 100)}`);
      try {
        const response = await (0, import_obsidian.requestUrl)({ url: interceptUrl, headers: BROWSER_HEADERS });
        const contentType = url.endsWith(".css") ? "text/css" : url.endsWith(".js") ? "application/javascript" : url.endsWith(".json") ? "application/json" : url.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
        console.log(`[GeoGebra] Fetch proxied OK: ${url.split("/").pop()?.substring(0, 50)}`);
        return new Response(response.text, {
          status: 200,
          statusText: "OK",
          headers: new Headers({ "Content-Type": contentType })
        });
      } catch (e) {
        console.error(`[GeoGebra] Fetch proxy failed: ${url}`, e);
        throw e;
      }
    }
    return origFetch(input, init);
  };
  console.log("[GeoGebra] Fetch interceptor installed");
}
function installInterceptor() {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  installDOMInterceptor();
  installXHRInterceptor();
  installFetchInterceptor();
  console.log("[GeoGebra] All interceptors active");
}
function removeInterceptor() {
  if (!interceptorInstalled) return;
  Node.prototype.appendChild = origAppendChild;
  Node.prototype.insertBefore = origInsertBefore;
  XMLHttpRequest.prototype.open = origXHROpen;
  XMLHttpRequest.prototype.send = origXHRSend;
  window.fetch = origFetch;
  if (origScriptSrcDescriptor) {
    Object.defineProperty(HTMLScriptElement.prototype, "src", origScriptSrcDescriptor);
  }
  interceptorInstalled = false;
  console.log("[GeoGebra] All interceptors removed");
}
var ggbVersion = null;
function getGeoGebraVersion() {
  return ggbVersion;
}
async function loadGeoGebra() {
  if (window.GGBApplet) {
    console.log("[GeoGebra] GGBApplet already available");
    return;
  }
  installInterceptor();
  const deployUrl = "https://www.geogebra.org/apps/deployggb.js";
  try {
    const code = await fetchText(deployUrl);
    const versionMatch = code.match(/geogebra\.org\/apps\/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)\//);
    if (versionMatch) {
      ggbVersion = versionMatch[1];
      console.log(`[GeoGebra] Detected version: ${ggbVersion}`);
    } else {
      console.warn("[GeoGebra] Could not extract version from deployggb.js");
    }
    console.log(`[GeoGebra] Executing deployggb.js (${code.length} bytes)...`);
    (0, eval)(code);
    const available = !!window.GGBApplet;
    console.log(`[GeoGebra] deployggb.js executed. GGBApplet: ${available}`);
    if (!available) {
      throw new Error("GGBApplet not defined after executing deployggb.js");
    }
  } catch (e) {
    console.error("[GeoGebra] Failed to load deployggb.js:", e);
    throw e;
  }
}

// src/geogebra-renderer.ts
var APP_NAMES = {
  ["2d" /* Geometry2D */]: "classic",
  ["3d" /* Geometry3D */]: "3d",
  ["graph" /* Graph */]: "graphing"
};
var DEFAULT_PERSPECTIVES = {
  ["2d" /* Geometry2D */]: "AG",
  // Algebra panel (left) + Graphics
  ["3d" /* Geometry3D */]: "AT",
  // Algebra panel (left) + 3D view
  ["graph" /* Graph */]: "AG"
  // Algebra panel (left) + Graphics
};
var DEFAULT_HEIGHTS = {
  ["2d" /* Geometry2D */]: 500,
  ["3d" /* Geometry3D */]: 750,
  ["graph" /* Graph */]: 500
};
var appletCounter = 0;
function waitForLayout() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
function parseSource(source) {
  const params = {};
  const commands = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const paramMatch = line.match(/^@(\w+)\s+(.+)$/);
    if (paramMatch) {
      const key = paramMatch[1].toLowerCase();
      const val = paramMatch[2].trim();
      switch (key) {
        case "width":
          params.width = parseInt(val);
          break;
        case "height":
          params.height = parseInt(val);
          break;
        case "perspective":
          params.perspective = val;
          break;
        case "toolbar":
          params.toolbar = val.toLowerCase() === "true" || val === "1";
          break;
        case "grid":
          params.grid = val.toLowerCase() === "true" || val === "1";
          break;
        case "axes":
          params.axes = val.toLowerCase() === "true" || val === "1";
          break;
      }
      continue;
    }
    commands.push(line);
  }
  return { params, commands };
}
async function renderGeoGebra(container, source, mode, onResetReady) {
  const appletId = `ggb-applet-${Date.now()}-${++appletCounter}`;
  const appletDiv = container.createDiv({ cls: "ggb-applet-container" });
  appletDiv.id = appletId;
  const loadingEl = container.createDiv({ cls: "ggb-loading" });
  loadingEl.setText("Loading GeoGebra...");
  const { params: userParams, commands } = parseSource(source);
  console.log(`[GeoGebra] Rendering ${mode} applet (${APP_NAMES[mode]}) with ${commands.length} commands, params:`, userParams);
  const errorCapture = [];
  const errorHandler = (event) => {
    if (event.filename?.includes("web3d") || event.filename?.includes("geogebra") || event.filename?.includes("VM")) {
      errorCapture.push(`${event.message} at ${event.filename}:${event.lineno}`);
      console.error(`[GeoGebra] Caught error: ${event.message}`, event);
    }
  };
  window.addEventListener("error", errorHandler);
  try {
    await loadGeoGebra();
    if (typeof GGBApplet === "undefined") {
      throw new Error("GGBApplet not available after loading");
    }
    loadingEl.setText("Initializing applet...");
    await waitForLayout();
    await waitForLayout();
    const measuredWidth = appletDiv.clientWidth || appletDiv.offsetWidth || container.clientWidth || container.offsetWidth || 800;
    const width = userParams.width || Math.max(measuredWidth, 400);
    const height = userParams.height || DEFAULT_HEIGHTS[mode];
    if (userParams.height) {
      appletDiv.style.minHeight = `${userParams.height}px`;
    }
    console.log(`[GeoGebra] Measured container width: ${measuredWidth}px \u2192 using ${width}x${height}`);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const errMsg = errorCapture.length > 0 ? `GeoGebra errors:
${errorCapture.join("\n")}` : "GeoGebra applet initialization timed out (60s). Check console for details.";
        reject(new Error(errMsg));
      }, 6e4);
      const perspective = userParams.perspective || DEFAULT_PERSPECTIVES[mode];
      const showToolBar = userParams.toolbar ?? false;
      const params = {
        id: appletId,
        appName: APP_NAMES[mode],
        width,
        height,
        perspective,
        scaleContainerClass: "ggb-applet-container",
        showAlgebraInput: true,
        algebraInputPosition: "algebra",
        showToolBar,
        showToolBarHelp: false,
        showMenuBar: false,
        showResetIcon: false,
        enableLabelDrags: true,
        enableShiftDragZoom: true,
        enableRightClick: true,
        enableCAS: false,
        enableAnimation: true,
        allowStyleBar: false,
        errorDialogsActive: false,
        useBrowserForJS: false,
        preventFocus: true,
        appletOnLoad: (api) => {
          clearTimeout(timeout);
          window.removeEventListener("error", errorHandler);
          console.log(`[GeoGebra] Applet ${appletId} ready, executing ${commands.length} commands...`);
          loadingEl.remove();
          if (userParams.grid !== void 0) {
            api.setGridVisible(userParams.grid);
          }
          if (userParams.axes !== void 0) {
            api.setAxesVisible(userParams.axes, userParams.axes);
          }
          executeCommands(api, commands);
          setTimeout(() => {
            try {
              if (mode === "3d" /* Geometry3D */) {
                api.evalCommand("SetActiveView(2)");
                try {
                  api.evalCommand("CenterView((0,0,0))");
                } catch {
                }
              }
              try {
                api.evalCommand("SelectAll()");
                api.evalCommand("ZoomToFit()");
                api.evalCommand("SelectAll()");
              } catch {
              }
              console.log(`[GeoGebra] Auto-center applied`);
            } catch (e) {
              console.warn("[GeoGebra] Auto-center failed:", e);
            }
          }, 300);
          setTimeout(() => {
            try {
              const savedState = api.getBase64();
              console.log(`[GeoGebra] Initial state saved (${savedState.length} chars)`);
              if (onResetReady) {
                onResetReady(() => {
                  console.log(`[GeoGebra] Restoring initial state...`);
                  api.setBase64(savedState);
                });
              }
            } catch (e) {
              console.warn("[GeoGebra] Could not save initial state:", e);
            }
          }, 800);
          resolve();
        }
      };
      try {
        console.log(`[GeoGebra] Creating GGBApplet(appName="${APP_NAMES[mode]}", ${width}x${height})...`);
        const applet = new GGBApplet(params, true);
        const ver = getGeoGebraVersion();
        if (ver) {
          const codebase = `https://www.geogebra.org/apps/${ver}/web3d/`;
          console.log(`[GeoGebra] Setting codebase: ${codebase}`);
          applet.setHTML5Codebase(codebase);
        }
        console.log(`[GeoGebra] Injecting into #${appletId}...`);
        applet.inject(appletId);
        console.log(`[GeoGebra] inject() called, waiting for appletOnLoad callback...`);
      } catch (e) {
        clearTimeout(timeout);
        window.removeEventListener("error", errorHandler);
        reject(e);
      }
    });
  } catch (e) {
    window.removeEventListener("error", errorHandler);
    loadingEl.remove();
    console.error("[GeoGebra] Render failed:", e);
    const msg = e.message || String(e);
    container.createDiv({
      cls: "geogebra-error",
      text: `Failed to render GeoGebra: ${msg}`
    });
  }
}
var API_COMMAND_HANDLERS = {
  "SetAnimating": (api, args) => {
    const name = args[0]?.trim();
    const anim = args[1]?.trim().toLowerCase() !== "false";
    if (name) api.setAnimating(name, anim);
  },
  "StartAnimation": (api) => {
    api.startAnimation();
  },
  "StopAnimation": (api) => {
    api.stopAnimation();
  },
  "SetAnimationSpeed": (api, args) => {
    const name = args[0]?.trim();
    const speed = parseFloat(args[1]?.trim());
    if (name && !isNaN(speed)) api.setAnimationSpeed(name, speed);
  },
  "SetColor": (api, args) => {
    const name = args[0]?.trim();
    const r = parseInt(args[1]?.trim()), g = parseInt(args[2]?.trim()), b = parseInt(args[3]?.trim());
    if (name) api.setColor(name, r, g, b);
  },
  "SetVisible": (api, args) => {
    const name = args[0]?.trim();
    const vis = args[1]?.trim().toLowerCase() !== "false";
    if (name) api.setVisible(name, vis);
  },
  "SetFixed": (api, args) => {
    const name = args[0]?.trim();
    const fixed = args[1]?.trim().toLowerCase() !== "false";
    if (name) api.setFixed(name, fixed);
  },
  "SetLineThickness": (api, args) => {
    const name = args[0]?.trim();
    const t = parseInt(args[1]?.trim());
    if (name && !isNaN(t)) api.setLineThickness(name, t);
  },
  "SetPointSize": (api, args) => {
    const name = args[0]?.trim();
    const s = parseInt(args[1]?.trim());
    if (name && !isNaN(s)) api.setPointSize(name, s);
  },
  "SetCaption": (api, args) => {
    const name = args[0]?.trim();
    const caption = args.slice(1).join(",").trim().replace(/^["']|["']$/g, "");
    if (name) api.setCaption(name, caption);
  },
  "SetLabelVisible": (api, args) => {
    const name = args[0]?.trim();
    const vis = args[1]?.trim().toLowerCase() !== "false";
    if (name) api.setLabelVisible(name, vis);
  }
};
function tryApiCommand(api, cmd) {
  const match = cmd.match(/^(\w+)\s*\((.*)\)\s*$/);
  if (!match) return false;
  const handler = API_COMMAND_HANDLERS[match[1]];
  if (!handler) return false;
  const args = match[2].split(",").map((a) => a.trim());
  try {
    handler(api, args);
    console.log(`[GeoGebra] API call: ${match[1]}(${args.join(", ")})`);
  } catch (e) {
    console.warn(`[GeoGebra] API call failed: ${cmd}`, e);
  }
  return true;
}
function executeCommands(api, commands) {
  try {
    api.setErrorDialogsActive(false);
    for (const cmd of commands) {
      if (tryApiCommand(api, cmd)) continue;
      console.log(`[GeoGebra] evalCommand: ${cmd}`);
      const success = api.evalCommand(cmd);
      if (!success) {
        console.warn(`[GeoGebra] Command may have failed: ${cmd}`);
      }
    }
    const animCmds = commands.filter((cmd) => {
      const m = cmd.match(/^(\w+)\s*\(/);
      return m && ["SetAnimating", "StartAnimation", "SetAnimationSpeed", "StopAnimation"].includes(m[1]);
    });
    if (animCmds.length > 0) {
      setTimeout(() => {
        for (const cmd of animCmds) tryApiCommand(api, cmd);
        console.log(`[GeoGebra] Animation commands applied`);
      }, 300);
    }
    console.log(`[GeoGebra] All ${commands.length} commands executed`);
  } catch (e) {
    console.error("[GeoGebra] Error executing commands:", e);
  }
}

// src/main.ts
var MODE_LABELS = {
  ["2d" /* Geometry2D */]: "2D Geometry",
  ["3d" /* Geometry3D */]: "3D Geometry",
  ["graph" /* Graph */]: "Function Graph"
};
var GeoGebraPlugin = class extends import_obsidian2.Plugin {
  async onload() {
    console.log("[GeoGebra] Loading plugin");
    installInterceptor();
    for (const [lang, mode] of Object.entries(LANGUAGE_MODE_MAP)) {
      this.registerMarkdownCodeBlockProcessor(
        lang,
        (source, el, ctx) => {
          this.processBlock(source, el, mode);
        }
      );
    }
  }
  processBlock(source, el, mode) {
    const container = el.createDiv({ cls: `geogebra-container geogebra-mode-${mode}` });
    const header = container.createDiv({ cls: "ggb-header" });
    header.createEl("span", {
      cls: "ggb-mode-badge",
      text: MODE_LABELS[mode]
    });
    header.createDiv({ cls: "ggb-header-spacer" });
    const resetBtn = header.createEl("button", {
      cls: "ggb-header-btn ggb-reset-btn",
      text: "\u21BA Reset",
      attr: { title: "Restore to initial state", disabled: "true" }
    });
    renderGeoGebra(container, source, mode, (resetFn) => {
      resetBtn.removeAttribute("disabled");
      resetBtn.addEventListener("click", (e) => {
        e.preventDefault();
        resetFn();
      });
    });
  }
  onunload() {
    console.log("[GeoGebra] Unloading plugin");
    removeInterceptor();
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3R5cGVzLnRzIiwgInNyYy9nZW9nZWJyYS1sb2FkZXIudHMiLCAic3JjL2dlb2dlYnJhLXJlbmRlcmVyLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBQbHVnaW4sIE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgeyBSZW5kZXJNb2RlLCBMQU5HVUFHRV9NT0RFX01BUCB9IGZyb20gJy4vdHlwZXMnO1xuaW1wb3J0IHsgcmVuZGVyR2VvR2VicmEgfSBmcm9tICcuL2dlb2dlYnJhLXJlbmRlcmVyJztcbmltcG9ydCB7IGluc3RhbGxJbnRlcmNlcHRvciwgcmVtb3ZlSW50ZXJjZXB0b3IgfSBmcm9tICcuL2dlb2dlYnJhLWxvYWRlcic7XG5cbmNvbnN0IE1PREVfTEFCRUxTOiBSZWNvcmQ8UmVuZGVyTW9kZSwgc3RyaW5nPiA9IHtcbiAgICBbUmVuZGVyTW9kZS5HZW9tZXRyeTJEXTogJzJEIEdlb21ldHJ5JyxcbiAgICBbUmVuZGVyTW9kZS5HZW9tZXRyeTNEXTogJzNEIEdlb21ldHJ5JyxcbiAgICBbUmVuZGVyTW9kZS5HcmFwaF06ICdGdW5jdGlvbiBHcmFwaCcsXG59O1xuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBHZW9HZWJyYVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gICAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgICBjb25zb2xlLmxvZygnW0dlb0dlYnJhXSBMb2FkaW5nIHBsdWdpbicpO1xuICAgICAgICBpbnN0YWxsSW50ZXJjZXB0b3IoKTtcblxuICAgICAgICBmb3IgKGNvbnN0IFtsYW5nLCBtb2RlXSBvZiBPYmplY3QuZW50cmllcyhMQU5HVUFHRV9NT0RFX01BUCkpIHtcbiAgICAgICAgICAgIHRoaXMucmVnaXN0ZXJNYXJrZG93bkNvZGVCbG9ja1Byb2Nlc3NvcihcbiAgICAgICAgICAgICAgICBsYW5nLFxuICAgICAgICAgICAgICAgIChzb3VyY2U6IHN0cmluZywgZWw6IEhUTUxFbGVtZW50LCBjdHg6IE1hcmtkb3duUG9zdFByb2Nlc3NvckNvbnRleHQpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5wcm9jZXNzQmxvY2soc291cmNlLCBlbCwgbW9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIHByaXZhdGUgcHJvY2Vzc0Jsb2NrKHNvdXJjZTogc3RyaW5nLCBlbDogSFRNTEVsZW1lbnQsIG1vZGU6IFJlbmRlck1vZGUpOiB2b2lkIHtcbiAgICAgICAgY29uc3QgY29udGFpbmVyID0gZWwuY3JlYXRlRGl2KHsgY2xzOiBgZ2VvZ2VicmEtY29udGFpbmVyIGdlb2dlYnJhLW1vZGUtJHttb2RlfWAgfSk7XG5cbiAgICAgICAgLy8gSGVhZGVyIHdpdGggbW9kZSBiYWRnZSArIHJlc2V0IGJ1dHRvblxuICAgICAgICBjb25zdCBoZWFkZXIgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiAnZ2diLWhlYWRlcicgfSk7XG4gICAgICAgIGhlYWRlci5jcmVhdGVFbCgnc3BhbicsIHtcbiAgICAgICAgICAgIGNsczogJ2dnYi1tb2RlLWJhZGdlJyxcbiAgICAgICAgICAgIHRleHQ6IE1PREVfTEFCRUxTW21vZGVdLFxuICAgICAgICB9KTtcblxuICAgICAgICBoZWFkZXIuY3JlYXRlRGl2KHsgY2xzOiAnZ2diLWhlYWRlci1zcGFjZXInIH0pO1xuXG4gICAgICAgIC8vIFJlc2V0IGJ1dHRvblxuICAgICAgICBjb25zdCByZXNldEJ0biA9IGhlYWRlci5jcmVhdGVFbCgnYnV0dG9uJywge1xuICAgICAgICAgICAgY2xzOiAnZ2diLWhlYWRlci1idG4gZ2diLXJlc2V0LWJ0bicsXG4gICAgICAgICAgICB0ZXh0OiAnXHUyMUJBIFJlc2V0JyxcbiAgICAgICAgICAgIGF0dHI6IHsgdGl0bGU6ICdSZXN0b3JlIHRvIGluaXRpYWwgc3RhdGUnLCBkaXNhYmxlZDogJ3RydWUnIH0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFJlbmRlclxuICAgICAgICByZW5kZXJHZW9HZWJyYShjb250YWluZXIsIHNvdXJjZSwgbW9kZSwgKHJlc2V0Rm4pID0+IHtcbiAgICAgICAgICAgIHJlc2V0QnRuLnJlbW92ZUF0dHJpYnV0ZSgnZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIHJlc2V0QnRuLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGUpID0+IHtcbiAgICAgICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgcmVzZXRGbigpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIG9udW5sb2FkKCk6IHZvaWQge1xuICAgICAgICBjb25zb2xlLmxvZygnW0dlb0dlYnJhXSBVbmxvYWRpbmcgcGx1Z2luJyk7XG4gICAgICAgIHJlbW92ZUludGVyY2VwdG9yKCk7XG4gICAgfVxufVxuIiwgIi8qKlxuICogUmVuZGVyaW5nIG1vZGVzIGNvcnJlc3BvbmRpbmcgdG8gZGlmZmVyZW50IGNvZGUgYmxvY2sgbGFuZ3VhZ2VzLlxuICovXG5leHBvcnQgZW51bSBSZW5kZXJNb2RlIHtcbiAgICBHZW9tZXRyeTJEID0gJzJkJyxcbiAgICBHZW9tZXRyeTNEID0gJzNkJyxcbiAgICBHcmFwaCA9ICdncmFwaCcsXG59XG5cbi8qKlxuICogTWFwIG9mIGNvZGUgYmxvY2sgbGFuZ3VhZ2UgaWRlbnRpZmllcnMgdG8gcmVuZGVyaW5nIG1vZGVzLlxuICovXG5leHBvcnQgY29uc3QgTEFOR1VBR0VfTU9ERV9NQVA6IFJlY29yZDxzdHJpbmcsIFJlbmRlck1vZGU+ID0ge1xuICAgICdnZW9nZWJyYSc6IFJlbmRlck1vZGUuR2VvbWV0cnkyRCxcbiAgICAnZ2diJzogUmVuZGVyTW9kZS5HZW9tZXRyeTJELFxuICAgICdnZW9nZWJyYS0zZCc6IFJlbmRlck1vZGUuR2VvbWV0cnkzRCxcbiAgICAnZ2diLTNkJzogUmVuZGVyTW9kZS5HZW9tZXRyeTNELFxuICAgICdnZW9nZWJyYS1ncmFwaCc6IFJlbmRlck1vZGUuR3JhcGgsXG4gICAgJ2dnYi1ncmFwaCc6IFJlbmRlck1vZGUuR3JhcGgsXG59O1xuIiwgIi8qKlxuICogR2VvR2VicmEgTG9hZGVyXG4gKlxuICogQ29tcHJlaGVuc2l2ZSBDU1AgYnlwYXNzIGZvciBHZW9HZWJyYSBpbiBPYnNpZGlhbjpcbiAqIDEuIERPTSBpbnRlcmNlcHRpb246IFBhdGNoZXMgYXBwZW5kQ2hpbGQvaW5zZXJ0QmVmb3JlIHRvIGNhdGNoIDxzY3JpcHQ+LzxsaW5rPiBjcmVhdGlvblxuICogMi4gWEhSIGludGVyY2VwdGlvbjogUGF0Y2hlcyBYTUxIdHRwUmVxdWVzdCB0byBwcm94eSBHZW9HZWJyYSBBUEkgY2FsbHNcbiAqIDMuIEZldGNoIGludGVyY2VwdGlvbjogUGF0Y2hlcyB3aW5kb3cuZmV0Y2ggZm9yIEdlb0dlYnJhIFVSTHNcbiAqIDQuIEFsbCBleHRlcm5hbCByZXF1ZXN0cyByb3V0ZWQgdGhyb3VnaCBPYnNpZGlhbidzIHJlcXVlc3RVcmwgKE5vZGUuanMgSFRUUClcbiAqIDUuIFNjcmlwdHMgZXhlY3V0ZWQgdmlhIGV2YWwoKSAod29ya3MgaW4gRWxlY3Ryb24gY29udGV4dClcbiAqIDYuIENTUyBpbmplY3RlZCBhcyBpbmxpbmUgPHN0eWxlPiAoT2JzaWRpYW4gYWxsb3dzIHVuc2FmZS1pbmxpbmUgc3R5bGVzKVxuICovXG5pbXBvcnQgeyByZXF1ZXN0VXJsIH0gZnJvbSAnb2JzaWRpYW4nO1xuXG5jb25zdCBHR0JfSE9TVFMgPSBbJ2dlb2dlYnJhLm9yZycsICdnZW9nZWJyYS5uZXQnXTtcblxuLy8gQ2FjaGUgZmV0Y2hlZCBjb250ZW50IHRvIGF2b2lkIHJlZHVuZGFudCBuZXR3b3JrIHJlcXVlc3RzXG5jb25zdCB0ZXh0Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUHJvbWlzZTxzdHJpbmc+PigpO1xuY29uc3QgYmluYXJ5Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUHJvbWlzZTxBcnJheUJ1ZmZlcj4+KCk7XG5cbmxldCBpbnRlcmNlcHRvckluc3RhbGxlZCA9IGZhbHNlO1xubGV0IG9yaWdBcHBlbmRDaGlsZDogdHlwZW9mIE5vZGUucHJvdG90eXBlLmFwcGVuZENoaWxkO1xubGV0IG9yaWdJbnNlcnRCZWZvcmU6IHR5cGVvZiBOb2RlLnByb3RvdHlwZS5pbnNlcnRCZWZvcmU7XG5sZXQgb3JpZ1hIUk9wZW46IHR5cGVvZiBYTUxIdHRwUmVxdWVzdC5wcm90b3R5cGUub3BlbjtcbmxldCBvcmlnWEhSU2VuZDogdHlwZW9mIFhNTEh0dHBSZXF1ZXN0LnByb3RvdHlwZS5zZW5kO1xubGV0IG9yaWdGZXRjaDogdHlwZW9mIHdpbmRvdy5mZXRjaDtcbmxldCBvcmlnU2NyaXB0U3JjRGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yIHwgdW5kZWZpbmVkO1xuXG4vLyBUcmFjayB3aGljaCBYSFIgaW5zdGFuY2VzIG5lZWQgaW50ZXJjZXB0aW9uXG5jb25zdCB4aHJJbnRlcmNlcHRNYXAgPSBuZXcgV2Vha01hcDxYTUxIdHRwUmVxdWVzdCwgeyB1cmw6IHN0cmluZzsgbWV0aG9kOiBzdHJpbmcgfT4oKTtcblxuLyoqXG4gKiBHV1QgY2FjaGUvZnJhZ21lbnQgVVJMIHBhdHRlcm46XG4gKiAtIDMyLWNoYXIgaGV4IC5jYWNoZS5qcyBmaWxlcyAocGVybXV0YXRpb24gc2NyaXB0cylcbiAqIC0gZGVmZXJyZWRqcy8gcGF0aHMgKGNvZGUtc3BsaXQgZnJhZ21lbnRzKVxuICogLSAuY2FjaGUuaHRtbCBmaWxlc1xuICovXG5jb25zdCBHV1RfRlJBR01FTlRfUkUgPSAvXig/Oi4qXFwvKT9bQS1GMC05XXszMn1cXC5jYWNoZVxcLmpzJC9pO1xuY29uc3QgR1dUX0RFRkVSUkVEX1JFID0gL2RlZmVycmVkanNcXC8vO1xuXG5mdW5jdGlvbiBpc0dlb0dlYnJhVXJsKHVybDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgaWYgKCF1cmwgfHwgdXJsLnN0YXJ0c1dpdGgoJ2Jsb2I6JykgfHwgdXJsLnN0YXJ0c1dpdGgoJ2RhdGE6JykpIHJldHVybiBmYWxzZTtcbiAgICByZXR1cm4gR0dCX0hPU1RTLnNvbWUoaG9zdCA9PiB1cmwuaW5jbHVkZXMoaG9zdCkpO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgVVJMIGlzIGEgR2VvR2VicmEgcmVzb3VyY2UgbG9hZGVkIGZyb20gYSB3cm9uZyBvcmlnaW5cbiAqIChlLmcuIGFwcDovL29ic2lkaWFuLm1kLykgYW5kIHJlc29sdmUgaXQgdG8gdGhlIGNvcnJlY3QgQ0ROIFVSTC5cbiAqXG4gKiBHZW9HZWJyYSdzIEdXVCBjb2RlIHVzZXMgcmVsYXRpdmUgcGF0aHMgZm9yOlxuICogLSBHV1QgcGVybXV0YXRpb24gZmlsZXM6IDlDQjQ4RS4uLmNhY2hlLmpzXG4gKiAtIENvZGUtc3BsaXQgZnJhZ21lbnRzOiBkZWZlcnJlZGpzLzEyMy8xMC5jYWNoZS5qc1xuICogLSBDU1MgYnVuZGxlczogY3NzL2J1bmRsZXMvYnVuZGxlLmNzcywgY3NzL2ZvbnRzLmNzcywgZXRjLlxuICogLSBKUyByZXNvdXJjZXM6IGpzLy4uLlxuICpcbiAqIFdoZW4gbG9hZGVkIHZpYSBldmFsKCksIHRoZXNlIHJlc29sdmUgdG8gYXBwOi8vb2JzaWRpYW4ubWQvIGluc3RlYWQgb2YgQ0ROLlxuICovXG5mdW5jdGlvbiByZXNvbHZlTWlzcm91dGVkVXJsKHVybDogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgaWYgKCFnZ2JWZXJzaW9uKSByZXR1cm4gbnVsbDtcbiAgICAvLyBHV1QgY29yZSBzY3JpcHRzIGxpdmUgdW5kZXIgd2ViM2QvXG4gICAgY29uc3QgY2RuQmFzZSA9IGBodHRwczovL3d3dy5nZW9nZWJyYS5vcmcvYXBwcy8ke2dnYlZlcnNpb259L3dlYjNkL2A7XG4gICAgLy8gQ1NTLCBKUyByZXNvdXJjZXMgYW5kIEhUTUwgYXJlIG9uZSBsZXZlbCB1cCAoYXBwIHZlcnNpb24gcm9vdClcbiAgICBjb25zdCBhcHBCYXNlID0gYGh0dHBzOi8vd3d3Lmdlb2dlYnJhLm9yZy9hcHBzLyR7Z2diVmVyc2lvbn0vYDtcblxuICAgIC8vIEFscmVhZHkgYSBHZW9HZWJyYSBVUkwgLSBubyBjb3JyZWN0aW9uIG5lZWRlZFxuICAgIGlmIChpc0dlb0dlYnJhVXJsKHVybCkpIHJldHVybiBudWxsO1xuXG4gICAgLy8gU3RyaXAgYXBwOi8vIG9yaWdpbiB0byBnZXQgdGhlIHJlbGF0aXZlIHBhdGhcbiAgICBjb25zdCByZWxhdGl2ZVBhdGggPSB1cmwucmVwbGFjZSgvXmFwcDpcXC9cXC9bXi9dK1xcLy8sICcnKTtcblxuICAgIC8vIEdXVCBjYWNoZSBmaWxlcyAoMzItY2hhciBoZXggaGFzaCArIC5jYWNoZS5qcylcbiAgICBjb25zdCBmaWxlbmFtZSA9IHJlbGF0aXZlUGF0aC5zcGxpdCgnLycpLnBvcCgpIHx8ICcnO1xuICAgIGlmIChHV1RfRlJBR01FTlRfUkUudGVzdChmaWxlbmFtZSkpIHtcbiAgICAgICAgcmV0dXJuIGNkbkJhc2UgKyBmaWxlbmFtZTtcbiAgICB9XG5cbiAgICAvLyBHV1QgZGVmZXJyZWQgSlMgKGNvZGUgc3BsaXR0aW5nKVxuICAgIGNvbnN0IGRlZmVycmVkTWF0Y2ggPSByZWxhdGl2ZVBhdGgubWF0Y2goL2RlZmVycmVkanNcXC8uKiQvKTtcbiAgICBpZiAoZGVmZXJyZWRNYXRjaCkge1xuICAgICAgICByZXR1cm4gY2RuQmFzZSArIGRlZmVycmVkTWF0Y2hbMF07XG4gICAgfVxuXG4gICAgLy8gR2VvR2VicmEgQ1NTIGZpbGVzIGxpdmUgYXQgYXBwcy97dmVyc2lvbn0vY3NzLywgTk9UIHdlYjNkL2Nzcy9cbiAgICBpZiAocmVsYXRpdmVQYXRoLnN0YXJ0c1dpdGgoJ2Nzcy8nKSAmJiByZWxhdGl2ZVBhdGguZW5kc1dpdGgoJy5jc3MnKSkge1xuICAgICAgICByZXR1cm4gYXBwQmFzZSArIHJlbGF0aXZlUGF0aDtcbiAgICB9XG5cbiAgICAvLyBHZW9HZWJyYSBmb250IEpTIGZpbGVzIChMYVRlWCByZW5kZXJlcikgLSBsaXZlIHVuZGVyIHdlYjNkL2ZvbnRzL1xuICAgIC8vIFN0cmlwIHF1ZXJ5IHN0cmluZyBmb3IgbWF0Y2hpbmcgYnV0IGtlZXAgdGhlIGNsZWFuIHBhdGhcbiAgICBjb25zdCBjbGVhblBhdGggPSByZWxhdGl2ZVBhdGgucmVwbGFjZSgvXFw/LiokLywgJycpO1xuICAgIGlmIChjbGVhblBhdGguc3RhcnRzV2l0aCgnZm9udHMvJykgJiYgY2xlYW5QYXRoLmVuZHNXaXRoKCcuanMnKSkge1xuICAgICAgICByZXR1cm4gY2RuQmFzZSArIGNsZWFuUGF0aDtcbiAgICB9XG5cbiAgICAvLyBHZW9HZWJyYSBKUyByZXNvdXJjZXMgKGF0IGFwcCB2ZXJzaW9uIHJvb3QpXG4gICAgaWYgKGNsZWFuUGF0aC5zdGFydHNXaXRoKCdqcy8nKSAmJiBjbGVhblBhdGguZW5kc1dpdGgoJy5qcycpKSB7XG4gICAgICAgIHJldHVybiBhcHBCYXNlICsgY2xlYW5QYXRoO1xuICAgIH1cblxuICAgIC8vIEdlb0dlYnJhIEhUTUwgcmVzb3VyY2VzXG4gICAgaWYgKGNsZWFuUGF0aC5lbmRzV2l0aCgnLmh0bWwnKSAmJiAhY2xlYW5QYXRoLmluY2x1ZGVzKCdvYnNpZGlhbicpKSB7XG4gICAgICAgIHJldHVybiBhcHBCYXNlICsgY2xlYW5QYXRoO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIGEgVVJMIG5lZWRzIGludGVyY2VwdGlvbiAoR2VvR2VicmEgQ0ROIG9yIG1pc3JvdXRlZCBHV1QgZnJhZ21lbnQpLlxuICogUmV0dXJucyB0aGUgY29ycmVjdCBDRE4gVVJMIHRvIGZldGNoLCBvciBudWxsIGlmIG5vIGludGVyY2VwdGlvbiBuZWVkZWQuXG4gKi9cbmZ1bmN0aW9uIGdldEludGVyY2VwdFVybCh1cmw6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIGlmIChpc0dlb0dlYnJhVXJsKHVybCkpIHJldHVybiB1cmw7XG4gICAgcmV0dXJuIHJlc29sdmVNaXNyb3V0ZWRVcmwodXJsKTtcbn1cblxuLyoqXG4gKiBGZXRjaCB0ZXh0IGNvbnRlbnQgdmlhIE9ic2lkaWFuJ3MgcmVxdWVzdFVybCAoYnlwYXNzZXMgQ1NQKS4gQ2FjaGVkLlxuICovXG4vKiogU3RhbmRhcmQgYnJvd3NlciBoZWFkZXJzIHRvIGF2b2lkIDQwMyBmcm9tIENETiAqL1xuY29uc3QgQlJPV1NFUl9IRUFERVJTOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICdVc2VyLUFnZW50JzogJ01vemlsbGEvNS4wIChNYWNpbnRvc2g7IEludGVsIE1hYyBPUyBYIDEwXzE1XzcpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjAuMC4wLjAgU2FmYXJpLzUzNy4zNicsXG4gICAgJ0FjY2VwdCc6ICcqLyonLFxuICAgICdBY2NlcHQtTGFuZ3VhZ2UnOiAnZW4tVVMsZW47cT0wLjknLFxuICAgICdSZWZlcmVyJzogJ2h0dHBzOi8vd3d3Lmdlb2dlYnJhLm9yZy8nLFxuICAgICdPcmlnaW4nOiAnaHR0cHM6Ly93d3cuZ2VvZ2VicmEub3JnJyxcbn07XG5cbmZ1bmN0aW9uIGZldGNoVGV4dCh1cmw6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgaWYgKHRleHRDYWNoZS5oYXModXJsKSkgcmV0dXJuIHRleHRDYWNoZS5nZXQodXJsKSE7XG4gICAgY29uc3QgcHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEZldGNoaW5nIHRleHQ6ICR7dXJsLnN1YnN0cmluZygwLCAxMjApfWApO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHJlcXVlc3RVcmwoeyB1cmwsIGhlYWRlcnM6IEJST1dTRVJfSEVBREVSUyB9KTtcbiAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gT0s6ICR7dXJsLnNwbGl0KCcvJykucG9wKCk/LnN1YnN0cmluZygwLCA1MCl9ICgke3Jlc3BvbnNlLnRleHQubGVuZ3RofSBieXRlcylgKTtcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLnRleHQ7XG4gICAgfSkoKTtcbiAgICB0ZXh0Q2FjaGUuc2V0KHVybCwgcHJvbWlzZSk7XG4gICAgcmV0dXJuIHByb21pc2U7XG59XG5cbi8qKlxuICogRmV0Y2ggYmluYXJ5IGNvbnRlbnQgdmlhIE9ic2lkaWFuJ3MgcmVxdWVzdFVybCAoYnlwYXNzZXMgQ1NQKS4gQ2FjaGVkLlxuICovXG5mdW5jdGlvbiBmZXRjaEJpbmFyeSh1cmw6IHN0cmluZyk6IFByb21pc2U8QXJyYXlCdWZmZXI+IHtcbiAgICBpZiAoYmluYXJ5Q2FjaGUuaGFzKHVybCkpIHJldHVybiBiaW5hcnlDYWNoZS5nZXQodXJsKSE7XG4gICAgY29uc3QgcHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEZldGNoaW5nIGJpbmFyeTogJHt1cmwuc3Vic3RyaW5nKDAsIDEyMCl9YCk7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcmVxdWVzdFVybCh7IHVybCwgaGVhZGVyczogQlJPV1NFUl9IRUFERVJTIH0pO1xuICAgICAgICByZXR1cm4gcmVzcG9uc2UuYXJyYXlCdWZmZXI7XG4gICAgfSkoKTtcbiAgICBiaW5hcnlDYWNoZS5zZXQodXJsLCBwcm9taXNlKTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbn1cblxuLy8gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4vLyBET00gSW50ZXJjZXB0aW9uIChhcHBlbmRDaGlsZCAvIGluc2VydEJlZm9yZSlcbi8vIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVTY3JpcHRJbnRlcmNlcHRpb24oXG4gICAgcGFyZW50OiBOb2RlLFxuICAgIGNoaWxkOiBIVE1MU2NyaXB0RWxlbWVudCxcbiAgICBmZXRjaFVybDogc3RyaW5nLFxuICAgIGV2YWxDb250ZXh0PzogV2luZG93LFxuICAgIHJlZk5vZGU/OiBOb2RlIHwgbnVsbFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29kZSA9IGF3YWl0IGZldGNoVGV4dChmZXRjaFVybCk7XG5cbiAgICAgICAgLy8gU3RyYXRlZ3k6IENyZWF0ZSBhIEJsb2IgVVJMIGFuZCBsZXQgdGhlIGJyb3dzZXIgbG9hZCB0aGUgc2NyaXB0XG4gICAgICAgIC8vIG5hdGl2ZWx5LiBUaGlzIHByZXNlcnZlcyB0aGUgY29ycmVjdCBleGVjdXRpb24gY29udGV4dCAoY3JpdGljYWxcbiAgICAgICAgLy8gZm9yIEdXVCdzIGlmcmFtZS1iYXNlZCAuY2FjaGUuanMgd2hpY2ggbmVlZHMgYHBhcmVudGAsIGB3aW5kb3dgLFxuICAgICAgICAvLyBgZG9jdW1lbnRgIHRvIHJlc29sdmUgaW4gdGhlIGlmcmFtZSBzY29wZSkuXG4gICAgICAgIGNvbnN0IGJsb2IgPSBuZXcgQmxvYihbY29kZV0sIHsgdHlwZTogJ2FwcGxpY2F0aW9uL2phdmFzY3JpcHQnIH0pO1xuICAgICAgICBjb25zdCBibG9iVXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICAgICAgY29uc3QgZmlsZW5hbWUgPSBmZXRjaFVybC5zcGxpdCgnLycpLnBvcCgpPy5zdWJzdHJpbmcoMCwgNjApIHx8ICd1bmtub3duJztcblxuICAgICAgICAvLyBTd2FwIHRoZSBzcmMgdG8gYmxvYiBVUkxcbiAgICAgICAgY2hpbGQucmVtb3ZlQXR0cmlidXRlKCdzcmMnKTtcbiAgICAgICAgY2hpbGQuc3JjID0gYmxvYlVybDtcblxuICAgICAgICAvLyBXcmFwIHRoZSBleGlzdGluZyBvbmxvYWQvb25lcnJvciB0byBhZGQgbG9nZ2luZyBhbmQgY2xlYW51cFxuICAgICAgICBjb25zdCBvcmlnT25sb2FkID0gY2hpbGQub25sb2FkO1xuICAgICAgICBjb25zdCBvcmlnT25lcnJvciA9IGNoaWxkLm9uZXJyb3I7XG4gICAgICAgIGNoaWxkLm9ubG9hZCA9IGZ1bmN0aW9uIChldjogRXZlbnQpIHtcbiAgICAgICAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwoYmxvYlVybCk7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBTY3JpcHQgbG9hZGVkIHZpYSBibG9iOiAke2ZpbGVuYW1lfWApO1xuICAgICAgICAgICAgaWYgKG9yaWdPbmxvYWQpIHtcbiAgICAgICAgICAgICAgICB0cnkgeyBvcmlnT25sb2FkLmNhbGwodGhpcywgZXYpOyB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybihgW0dlb0dlYnJhXSBvbmxvYWQgY2FsbGJhY2sgZXJyb3IgZm9yICR7ZmlsZW5hbWV9OmAsIGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgY2hpbGQub25lcnJvciA9IGZ1bmN0aW9uIChldjogRXZlbnQgfCBzdHJpbmcpIHtcbiAgICAgICAgICAgIFVSTC5yZXZva2VPYmplY3RVUkwoYmxvYlVybCk7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYFtHZW9HZWJyYV0gQmxvYiBzY3JpcHQgZmFpbGVkIGZvciAke2ZpbGVuYW1lfSwgZmFsbGluZyBiYWNrIHRvIGV2YWxgKTtcbiAgICAgICAgICAgIC8vIEJsb2IgVVJMIGJsb2NrZWQgYnkgQ1NQPyBGYWxsIGJhY2sgdG8gZXZhbCBhcHByb2FjaC5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYgKGV2YWxDb250ZXh0ICYmIGV2YWxDb250ZXh0ICE9PSB3aW5kb3cpIHtcbiAgICAgICAgICAgICAgICAgICAgZXZhbENvbnRleHQuZXZhbChjb2RlKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAoMCwgZXZhbCkoY29kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEV4ZWN1dGVkIHNjcmlwdCB2aWEgZXZhbCBmYWxsYmFjazogJHtmaWxlbmFtZX1gKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUyKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0dlb0dlYnJhXSBFdmFsIGZhbGxiYWNrIGFsc28gZmFpbGVkOiAke2ZpbGVuYW1lfWAsIGUyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChvcmlnT25lcnJvcikge1xuICAgICAgICAgICAgICAgIHRyeSB7IChvcmlnT25lcnJvciBhcyBGdW5jdGlvbikuY2FsbCh0aGlzLCBldik7IH0gY2F0Y2gge31cbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBBY3R1YWxseSBhcHBlbmQgdGhlIHNjcmlwdCB0byB0aGUgRE9NIHNvIGl0IGxvYWRzIG5hdHVyYWxseVxuICAgICAgICBpZiAocmVmTm9kZSAhPT0gdW5kZWZpbmVkICYmIHJlZk5vZGUgIT09IG51bGwpIHtcbiAgICAgICAgICAgIG9yaWdJbnNlcnRCZWZvcmUuY2FsbChwYXJlbnQsIGNoaWxkLCByZWZOb2RlKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIG9yaWdBcHBlbmRDaGlsZC5jYWxsKHBhcmVudCwgY2hpbGQpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEFwcGVuZGVkIHNjcmlwdCB3aXRoIGJsb2IgVVJMOiAke2ZpbGVuYW1lfWApO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgW0dlb0dlYnJhXSBGYWlsZWQgdG8gaGFuZGxlIHNjcmlwdDogJHtmZXRjaFVybH1gLCBlKTtcbiAgICAgICAgaWYgKGNoaWxkLm9uZXJyb3IpIHsgdHJ5IHsgKGNoaWxkLm9uZXJyb3IgYXMgYW55KShlKTsgfSBjYXRjaCB7fSB9XG4gICAgICAgIHRyeSB7IGNoaWxkLmRpc3BhdGNoRXZlbnQobmV3IEV2ZW50KCdlcnJvcicpKTsgfSBjYXRjaCB7fVxuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlTGlua0ludGVyY2VwdGlvbihcbiAgICBwYXJlbnQ6IE5vZGUsXG4gICAgY2hpbGQ6IEhUTUxMaW5rRWxlbWVudCxcbiAgICBmZXRjaFVybDogc3RyaW5nLFxuICAgIHJlZk5vZGU/OiBOb2RlIHwgbnVsbFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY3NzVGV4dCA9IGF3YWl0IGZldGNoVGV4dChmZXRjaFVybCk7XG4gICAgICAgIGNvbnN0IHN0eWxlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc3R5bGUnKTtcbiAgICAgICAgc3R5bGUudGV4dENvbnRlbnQgPSBjc3NUZXh0O1xuICAgICAgICBzdHlsZS5zZXRBdHRyaWJ1dGUoJ2RhdGEtZ2VvZ2VicmEtc3JjJywgZmV0Y2hVcmwpO1xuICAgICAgICBvcmlnQXBwZW5kQ2hpbGQuY2FsbChkb2N1bWVudC5oZWFkLCBzdHlsZSk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEluamVjdGVkIENTUzogJHtmZXRjaFVybC5zcGxpdCgnLycpLnBvcCgpPy5zdWJzdHJpbmcoMCwgNTApfWApO1xuICAgICAgICBpZiAoY2hpbGQub25sb2FkKSB7IHRyeSB7IGNoaWxkLm9ubG9hZChuZXcgRXZlbnQoJ2xvYWQnKSBhcyBhbnkpOyB9IGNhdGNoIHt9IH1cbiAgICAgICAgdHJ5IHsgY2hpbGQuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ2xvYWQnKSk7IH0gY2F0Y2gge31cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFtHZW9HZWJyYV0gRmFpbGVkIHRvIGxvYWQgQ1NTOiAke2ZldGNoVXJsfWAsIGUpO1xuICAgICAgICBpZiAocmVmTm9kZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBvcmlnSW5zZXJ0QmVmb3JlLmNhbGwocGFyZW50LCBjaGlsZCwgcmVmTm9kZSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBvcmlnQXBwZW5kQ2hpbGQuY2FsbChwYXJlbnQsIGNoaWxkKTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiBDaGVjayBpZiBhIG5vZGUgaXMgYSBzY3JpcHQgZWxlbWVudCAod29ya3MgYWNyb3NzIGlmcmFtZSBib3VuZGFyaWVzXG4gKiB3aGVyZSBpbnN0YW5jZW9mIEhUTUxTY3JpcHRFbGVtZW50IGZhaWxzKS5cbiAqL1xuZnVuY3Rpb24gaXNTY3JpcHRFbGVtZW50KG5vZGU6IE5vZGUpOiBub2RlIGlzIEhUTUxTY3JpcHRFbGVtZW50IHtcbiAgICByZXR1cm4gbm9kZS5ub2RlTmFtZSA9PT0gJ1NDUklQVCc7XG59XG5cbi8qKlxuICogQ2hlY2sgaWYgYSBub2RlIGlzIGEgPGxpbms+IGVsZW1lbnQgKGFueSBraW5kIC0gR2VvR2VicmEgbWF5IHNldCByZWxcbiAqIEFGVEVSIGFwcGVuZENoaWxkLCBzbyB3ZSBjYW4ndCByZWx5IG9uIHJlbD0nc3R5bGVzaGVldCcgYXQgYXBwZW5kIHRpbWUpLlxuICovXG5mdW5jdGlvbiBpc0xpbmtFbGVtZW50KG5vZGU6IE5vZGUpOiBub2RlIGlzIEhUTUxMaW5rRWxlbWVudCB7XG4gICAgcmV0dXJuIG5vZGUubm9kZU5hbWUgPT09ICdMSU5LJztcbn1cblxuLyoqXG4gKiBQYXRjaCBhIHdpbmRvdydzIE5vZGUucHJvdG90eXBlIHRvIGludGVyY2VwdCBzY3JpcHQvbGluay9pZnJhbWUgYXBwZW5kaW5nLlxuICogQ2FsbGVkIGZvciBtYWluIHdpbmRvdyBBTkQgZm9yIGVhY2ggR1dUIGlmcmFtZS5cbiAqL1xuZnVuY3Rpb24gcGF0Y2hOb2RlUHJvdG90eXBlKHdpbjogV2luZG93LCBsYWJlbDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgcHJvdG8gPSB3aW4uTm9kZS5wcm90b3R5cGU7XG4gICAgY29uc3QgX29yaWdBcHBlbmQgPSBwcm90by5hcHBlbmRDaGlsZDtcbiAgICBjb25zdCBfb3JpZ0luc2VydCA9IHByb3RvLmluc2VydEJlZm9yZTtcblxuICAgIHByb3RvLmFwcGVuZENoaWxkID0gZnVuY3Rpb24gPFQgZXh0ZW5kcyBOb2RlPihjaGlsZDogVCk6IFQge1xuICAgICAgICBpZiAoaXNTY3JpcHRFbGVtZW50KGNoaWxkKSkge1xuICAgICAgICAgICAgY29uc3Qgc3JjID0gY2hpbGQuZ2V0QXR0cmlidXRlKCdzcmMnKSB8fCBjaGlsZC5zcmMgfHwgJyc7XG4gICAgICAgICAgICBpZiAoc3JjKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgaW50ZXJjZXB0VXJsID0gZ2V0SW50ZXJjZXB0VXJsKHNyYyk7XG4gICAgICAgICAgICAgICAgaWYgKGludGVyY2VwdFVybCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXVske2xhYmVsfV0gSW50ZXJjZXB0aW5nIHNjcmlwdDogJHtzcmMuc3Vic3RyaW5nKDAsIDgwKX0gXHUyMTkyIENETmApO1xuICAgICAgICAgICAgICAgICAgICBoYW5kbGVTY3JpcHRJbnRlcmNlcHRpb24odGhpcywgY2hpbGQsIGludGVyY2VwdFVybCwgd2luKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNMaW5rRWxlbWVudChjaGlsZCkpIHtcbiAgICAgICAgICAgIC8vIFRyeSByZXNvbHZlZCBVUkwgZmlyc3QgKGNoaWxkLmhyZWYpLCB0aGVuIHJhdyBhdHRyaWJ1dGVcbiAgICAgICAgICAgIGNvbnN0IGhyZWYgPSBjaGlsZC5ocmVmIHx8IGNoaWxkLmdldEF0dHJpYnV0ZSgnaHJlZicpIHx8ICcnO1xuICAgICAgICAgICAgaWYgKGhyZWYpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbnRlcmNlcHRVcmwgPSBnZXRJbnRlcmNlcHRVcmwoaHJlZik7XG4gICAgICAgICAgICAgICAgaWYgKGludGVyY2VwdFVybCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXVske2xhYmVsfV0gSW50ZXJjZXB0aW5nIGxpbms6ICR7aHJlZi5zdWJzdHJpbmcoMCwgODApfSBcdTIxOTIgQ0ROYCk7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZUxpbmtJbnRlcmNlcHRpb24odGhpcywgY2hpbGQsIGludGVyY2VwdFVybCk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBjaGlsZDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gRGV0ZWN0IGlmcmFtZSBjcmVhdGlvbiBcdTIxOTIgcGF0Y2ggaXRzIHByb3RvdHlwZXMgdG9vXG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IF9vcmlnQXBwZW5kLmNhbGwodGhpcywgY2hpbGQpIGFzIFQ7XG4gICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0lGUkFNRScpIHtcbiAgICAgICAgICAgIHBhdGNoSWZyYW1lKGNoaWxkIGFzIHVua25vd24gYXMgSFRNTElGcmFtZUVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcblxuICAgIHByb3RvLmluc2VydEJlZm9yZSA9IGZ1bmN0aW9uIDxUIGV4dGVuZHMgTm9kZT4oY2hpbGQ6IFQsIHJlZjogTm9kZSB8IG51bGwpOiBUIHtcbiAgICAgICAgaWYgKGlzU2NyaXB0RWxlbWVudChjaGlsZCkpIHtcbiAgICAgICAgICAgIGNvbnN0IHNyYyA9IGNoaWxkLmdldEF0dHJpYnV0ZSgnc3JjJykgfHwgY2hpbGQuc3JjIHx8ICcnO1xuICAgICAgICAgICAgaWYgKHNyYykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGludGVyY2VwdFVybCA9IGdldEludGVyY2VwdFVybChzcmMpO1xuICAgICAgICAgICAgICAgIGlmIChpbnRlcmNlcHRVcmwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV1bJHtsYWJlbH1dIEludGVyY2VwdGluZyBzY3JpcHQ6ICR7c3JjLnN1YnN0cmluZygwLCA4MCl9IFx1MjE5MiBDRE5gKTtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlU2NyaXB0SW50ZXJjZXB0aW9uKHRoaXMsIGNoaWxkLCBpbnRlcmNlcHRVcmwsIHdpbiwgcmVmKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoaXNMaW5rRWxlbWVudChjaGlsZCkpIHtcbiAgICAgICAgICAgIGNvbnN0IGhyZWYgPSBjaGlsZC5ocmVmIHx8IGNoaWxkLmdldEF0dHJpYnV0ZSgnaHJlZicpIHx8ICcnO1xuICAgICAgICAgICAgaWYgKGhyZWYpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbnRlcmNlcHRVcmwgPSBnZXRJbnRlcmNlcHRVcmwoaHJlZik7XG4gICAgICAgICAgICAgICAgaWYgKGludGVyY2VwdFVybCkge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXVske2xhYmVsfV0gSW50ZXJjZXB0aW5nIGxpbms6ICR7aHJlZi5zdWJzdHJpbmcoMCwgODApfSBcdTIxOTIgQ0ROYCk7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZUxpbmtJbnRlcmNlcHRpb24odGhpcywgY2hpbGQsIGludGVyY2VwdFVybCwgcmVmKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGNoaWxkO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXN1bHQgPSBfb3JpZ0luc2VydC5jYWxsKHRoaXMsIGNoaWxkLCByZWYpIGFzIFQ7XG4gICAgICAgIGlmIChjaGlsZC5ub2RlTmFtZSA9PT0gJ0lGUkFNRScpIHtcbiAgICAgICAgICAgIHBhdGNoSWZyYW1lKGNoaWxkIGFzIHVua25vd24gYXMgSFRNTElGcmFtZUVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcbn1cblxuLyoqIFRyYWNrIHBhdGNoZWQgaWZyYW1lcyB0byBhdm9pZCBkb3VibGUtcGF0Y2hpbmcgKi9cbmNvbnN0IHBhdGNoZWRJZnJhbWVzID0gbmV3IFdlYWtTZXQ8SFRNTElGcmFtZUVsZW1lbnQ+KCk7XG5cbi8qKlxuICogUGF0Y2ggYW4gaWZyYW1lJ3MgTm9kZS5wcm90b3R5cGUgc28gR1dUIHNjcmlwdHMgbG9hZGVkIGluc2lkZSBpdFxuICogYXJlIGFsc28gaW50ZXJjZXB0ZWQgYW5kIHJvdXRlZCB0aHJvdWdoIHRoZSBDRE4uXG4gKi9cbmZ1bmN0aW9uIHBhdGNoSWZyYW1lKGlmcmFtZTogSFRNTElGcmFtZUVsZW1lbnQpOiB2b2lkIHtcbiAgICBpZiAocGF0Y2hlZElmcmFtZXMuaGFzKGlmcmFtZSkpIHJldHVybjtcbiAgICBwYXRjaGVkSWZyYW1lcy5hZGQoaWZyYW1lKTtcblxuICAgIGZ1bmN0aW9uIGRvUGF0Y2goKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBpZnJhbWVXaW4gPSBpZnJhbWUuY29udGVudFdpbmRvdztcbiAgICAgICAgICAgIGlmIChpZnJhbWVXaW4gJiYgaWZyYW1lV2luLk5vZGUpIHtcbiAgICAgICAgICAgICAgICBwYXRjaE5vZGVQcm90b3R5cGUoaWZyYW1lV2luLCAnaWZyYW1lJyk7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tHZW9HZWJyYV0gUGF0Y2hlZCBpZnJhbWUgTm9kZS5wcm90b3R5cGUnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgLy8gQ3Jvc3Mtb3JpZ2luIGlmcmFtZSAtIGNhbid0IHBhdGNoIChzaG91bGRuJ3QgaGFwcGVuIGZvciBHV1QgaWZyYW1lcylcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8vIFBhdGNoIGltbWVkaWF0ZWx5IChibGFuayBpZnJhbWUgaGFzIGNvbnRlbnRXaW5kb3cgcmlnaHQgYXdheSlcbiAgICBkb1BhdGNoKCk7XG4gICAgLy8gQWxzbyBwYXRjaCBvbiBsb2FkIGluIGNhc2UgdGhlIGRvY3VtZW50IGdldHMgcmVwbGFjZWRcbiAgICBpZnJhbWUuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsIGRvUGF0Y2gpO1xufVxuXG5mdW5jdGlvbiBpbnN0YWxsRE9NSW50ZXJjZXB0b3IoKTogdm9pZCB7XG4gICAgb3JpZ0FwcGVuZENoaWxkID0gTm9kZS5wcm90b3R5cGUuYXBwZW5kQ2hpbGQ7XG4gICAgb3JpZ0luc2VydEJlZm9yZSA9IE5vZGUucHJvdG90eXBlLmluc2VydEJlZm9yZTtcblxuICAgIC8vIFBhdGNoIHRoZSBtYWluIHdpbmRvdydzIE5vZGUucHJvdG90eXBlXG4gICAgcGF0Y2hOb2RlUHJvdG90eXBlKHdpbmRvdywgJ21haW4nKTtcblxuICAgIC8vIEludGVyY2VwdCBIVE1MU2NyaXB0RWxlbWVudC5zcmMgc2V0dGVyIHRvIGNhdGNoIHNjcmlwdCBsb2FkaW5nXG4gICAgLy8gdGhhdCBieXBhc3NlcyBhcHBlbmRDaGlsZCAoZS5nLiwgR2VvR2VicmEncyBmb250IGxvYWRlcikuXG4gICAgLy8gV2hlbiBzcmMgaXMgc2V0IHRvIGEgVVJMIG5lZWRpbmcgaW50ZXJjZXB0aW9uLCB3ZSByZWRpcmVjdCB0byBhIGJsb2IgVVJMLlxuICAgIG9yaWdTY3JpcHRTcmNEZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihcbiAgICAgICAgSFRNTFNjcmlwdEVsZW1lbnQucHJvdG90eXBlLCAnc3JjJ1xuICAgICk7XG4gICAgaWYgKG9yaWdTY3JpcHRTcmNEZXNjcmlwdG9yICYmIG9yaWdTY3JpcHRTcmNEZXNjcmlwdG9yLnNldCkge1xuICAgICAgICBjb25zdCBvcmlnU2V0ID0gb3JpZ1NjcmlwdFNyY0Rlc2NyaXB0b3Iuc2V0O1xuICAgICAgICBjb25zdCBvcmlnR2V0ID0gb3JpZ1NjcmlwdFNyY0Rlc2NyaXB0b3IuZ2V0O1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoSFRNTFNjcmlwdEVsZW1lbnQucHJvdG90eXBlLCAnc3JjJywge1xuICAgICAgICAgICAgZ2V0KCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBvcmlnR2V0ID8gb3JpZ0dldC5jYWxsKHRoaXMpIDogJyc7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgc2V0KHZhbHVlOiBzdHJpbmcpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBpbnRlcmNlcHRVcmwgPSBnZXRJbnRlcmNlcHRVcmwodmFsdWUpO1xuICAgICAgICAgICAgICAgIGlmIChpbnRlcmNlcHRVcmwpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc2NyaXB0RWwgPSB0aGlzIGFzIEhUTUxTY3JpcHRFbGVtZW50O1xuICAgICAgICAgICAgICAgICAgICAvLyBGZXRjaCB0aGUgc2NyaXB0IGNvbnRlbnQgYW5kIHJlcGxhY2Ugd2l0aCBibG9iIFVSTFxuICAgICAgICAgICAgICAgICAgICBmZXRjaFRleHQoaW50ZXJjZXB0VXJsKS50aGVuKGNvZGUgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgYmxvYiA9IG5ldyBCbG9iKFtjb2RlXSwgeyB0eXBlOiAnYXBwbGljYXRpb24vamF2YXNjcmlwdCcgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBibG9iVXJsID0gVVJMLmNyZWF0ZU9iamVjdFVSTChibG9iKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIG9yaWdTZXQuY2FsbChzY3JpcHRFbCwgYmxvYlVybCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCBvbiBsb2FkXG4gICAgICAgICAgICAgICAgICAgICAgICBzY3JpcHRFbC5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgKCkgPT4gVVJMLnJldm9rZU9iamVjdFVSTChibG9iVXJsKSwgeyBvbmNlOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2NyaXB0RWwuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCAoKSA9PiBVUkwucmV2b2tlT2JqZWN0VVJMKGJsb2JVcmwpLCB7IG9uY2U6IHRydWUgfSk7XG4gICAgICAgICAgICAgICAgICAgIH0pLmNhdGNoKGUgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBbR2VvR2VicmFdIHNyYyBpbnRlcmNlcHRvciBmZXRjaCBmYWlsZWQ6ICR7dmFsdWV9YCwgZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBvcmlnU2V0LmNhbGwoc2NyaXB0RWwsIHZhbHVlKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgb3JpZ1NldC5jYWxsKHRoaXMsIHZhbHVlKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZygnW0dlb0dlYnJhXSBET00gaW50ZXJjZXB0b3IgaW5zdGFsbGVkJyk7XG59XG5cbi8vIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuLy8gWE1MSHR0cFJlcXVlc3QgSW50ZXJjZXB0aW9uXG4vLyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuZnVuY3Rpb24gaW5zdGFsbFhIUkludGVyY2VwdG9yKCk6IHZvaWQge1xuICAgIG9yaWdYSFJPcGVuID0gWE1MSHR0cFJlcXVlc3QucHJvdG90eXBlLm9wZW47XG4gICAgb3JpZ1hIUlNlbmQgPSBYTUxIdHRwUmVxdWVzdC5wcm90b3R5cGUuc2VuZDtcblxuICAgIFhNTEh0dHBSZXF1ZXN0LnByb3RvdHlwZS5vcGVuID0gZnVuY3Rpb24gKFxuICAgICAgICBtZXRob2Q6IHN0cmluZyxcbiAgICAgICAgdXJsOiBzdHJpbmcgfCBVUkwsXG4gICAgICAgIGFzeW5jPzogYm9vbGVhbixcbiAgICAgICAgdXNlcm5hbWU/OiBzdHJpbmcgfCBudWxsLFxuICAgICAgICBwYXNzd29yZD86IHN0cmluZyB8IG51bGxcbiAgICApOiB2b2lkIHtcbiAgICAgICAgY29uc3QgdXJsU3RyID0gdXJsLnRvU3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IGludGVyY2VwdFVybCA9IGdldEludGVyY2VwdFVybCh1cmxTdHIpO1xuICAgICAgICBpZiAoaW50ZXJjZXB0VXJsKSB7XG4gICAgICAgICAgICB4aHJJbnRlcmNlcHRNYXAuc2V0KHRoaXMsIHsgdXJsOiBpbnRlcmNlcHRVcmwsIG1ldGhvZCB9KTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIFhIUiBpbnRlcmNlcHRlZDogJHttZXRob2R9ICR7dXJsU3RyLnN1YnN0cmluZygwLCAxMDApfWApO1xuICAgICAgICB9XG4gICAgICAgIC8vIEFsd2F5cyBjYWxsIG9yaWdpbmFsIG9wZW4gKG5lZWRlZCBmb3Igbm9uLWludGVyY2VwdGVkIHJlcXVlc3RzXG4gICAgICAgIC8vIGFuZCB0byBwcm9wZXJseSBpbml0aWFsaXplIHRoZSBYSFIgc3RhdGUpXG4gICAgICAgIHJldHVybiBvcmlnWEhST3Blbi5jYWxsKHRoaXMsIG1ldGhvZCwgdXJsLCBhc3luYyA/PyB0cnVlLCB1c2VybmFtZSwgcGFzc3dvcmQpO1xuICAgIH07XG5cbiAgICBYTUxIdHRwUmVxdWVzdC5wcm90b3R5cGUuc2VuZCA9IGZ1bmN0aW9uIChib2R5PzogRG9jdW1lbnQgfCBYTUxIdHRwUmVxdWVzdEJvZHlJbml0IHwgbnVsbCk6IHZvaWQge1xuICAgICAgICBjb25zdCBpbnRlcmNlcHRJbmZvID0geGhySW50ZXJjZXB0TWFwLmdldCh0aGlzKTtcbiAgICAgICAgaWYgKGludGVyY2VwdEluZm8pIHtcbiAgICAgICAgICAgIGNvbnN0IHsgdXJsIH0gPSBpbnRlcmNlcHRJbmZvO1xuICAgICAgICAgICAgLy8gVXNlIHJlcXVlc3RVcmwgdG8gcHJveHkgdGhlIHJlcXVlc3RcbiAgICAgICAgICAgIHJlcXVlc3RVcmwoeyB1cmwsIGhlYWRlcnM6IEJST1dTRVJfSEVBREVSUyB9KS50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgICAgICAgICAgICAvLyBPdmVycmlkZSByZXNwb25zZSBwcm9wZXJ0aWVzXG4gICAgICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KHRoaXMsICdyZWFkeVN0YXRlJywgeyB2YWx1ZTogNCwgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3N0YXR1cycsIHsgdmFsdWU6IDIwMCwgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3N0YXR1c1RleHQnLCB7IHZhbHVlOiAnT0snLCB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAncmVzcG9uc2VUZXh0JywgeyB2YWx1ZTogcmVzcG9uc2UudGV4dCwgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3Jlc3BvbnNlJywgeyB2YWx1ZTogcmVzcG9uc2UudGV4dCwgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3Jlc3BvbnNlVVJMJywgeyB2YWx1ZTogdXJsLCB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIFhIUiBwcm94aWVkIE9LOiAke3VybC5zcGxpdCgnLycpLnBvcCgpPy5zdWJzdHJpbmcoMCwgNTApfWApO1xuXG4gICAgICAgICAgICAgICAgLy8gRmlyZSBldmVudHMgaW4gcHJvcGVyIG9yZGVyXG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBFdmVudCgncmVhZHlzdGF0ZWNoYW5nZScpKTtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BhdGNoRXZlbnQobmV3IFByb2dyZXNzRXZlbnQoJ3Byb2dyZXNzJykpO1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgRXZlbnQoJ2xvYWQnKSk7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwYXRjaEV2ZW50KG5ldyBQcm9ncmVzc0V2ZW50KCdsb2FkZW5kJykpO1xuXG4gICAgICAgICAgICAgICAgLy8gQWxzbyBjYWxsIG9ucmVhZHlzdGF0ZWNoYW5nZSAvIG9ubG9hZCBkaXJlY3RseSBpZiBzZXRcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5vbnJlYWR5c3RhdGVjaGFuZ2UpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHsgdGhpcy5vbnJlYWR5c3RhdGVjaGFuZ2UobmV3IEV2ZW50KCdyZWFkeXN0YXRlY2hhbmdlJykgYXMgYW55KTsgfSBjYXRjaCB7fVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAodGhpcy5vbmxvYWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHsgdGhpcy5vbmxvYWQobmV3IFByb2dyZXNzRXZlbnQoJ2xvYWQnKSBhcyBhbnkpOyB9IGNhdGNoIHt9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSkuY2F0Y2goZSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0dlb0dlYnJhXSBYSFIgcHJveHkgZmFpbGVkOiAke3VybH1gLCBlKTtcbiAgICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkodGhpcywgJ3JlYWR5U3RhdGUnLCB7IHZhbHVlOiA0LCB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlIH0pO1xuICAgICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eSh0aGlzLCAnc3RhdHVzJywgeyB2YWx1ZTogMCwgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSB9KTtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BhdGNoRXZlbnQobmV3IFByb2dyZXNzRXZlbnQoJ2Vycm9yJykpO1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGF0Y2hFdmVudChuZXcgUHJvZ3Jlc3NFdmVudCgnbG9hZGVuZCcpKTtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5vbmVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyeSB7IHRoaXMub25lcnJvcihuZXcgUHJvZ3Jlc3NFdmVudCgnZXJyb3InKSBhcyBhbnkpOyB9IGNhdGNoIHt9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXR1cm47IC8vIERvbid0IGNhbGwgb3JpZ2luYWwgc2VuZFxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvcmlnWEhSU2VuZC5jYWxsKHRoaXMsIGJvZHkpO1xuICAgIH07XG5cbiAgICBjb25zb2xlLmxvZygnW0dlb0dlYnJhXSBYSFIgaW50ZXJjZXB0b3IgaW5zdGFsbGVkJyk7XG59XG5cbi8vIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuLy8gRmV0Y2ggSW50ZXJjZXB0aW9uXG4vLyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuZnVuY3Rpb24gaW5zdGFsbEZldGNoSW50ZXJjZXB0b3IoKTogdm9pZCB7XG4gICAgb3JpZ0ZldGNoID0gd2luZG93LmZldGNoLmJpbmQod2luZG93KTtcblxuICAgICh3aW5kb3cgYXMgYW55KS5mZXRjaCA9IGFzeW5jIGZ1bmN0aW9uIChcbiAgICAgICAgaW5wdXQ6IFJlcXVlc3RJbmZvIHwgVVJMLFxuICAgICAgICBpbml0PzogUmVxdWVzdEluaXRcbiAgICApOiBQcm9taXNlPFJlc3BvbnNlPiB7XG4gICAgICAgIGNvbnN0IHVybCA9IGlucHV0IGluc3RhbmNlb2YgUmVxdWVzdCA/IGlucHV0LnVybCA6IGlucHV0LnRvU3RyaW5nKCk7XG4gICAgICAgIGNvbnN0IGludGVyY2VwdFVybCA9IGdldEludGVyY2VwdFVybCh1cmwpO1xuICAgICAgICBpZiAoaW50ZXJjZXB0VXJsKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBGZXRjaCBpbnRlcmNlcHRlZDogJHt1cmwuc3Vic3RyaW5nKDAsIDEwMCl9IFx1MjE5MiAke2ludGVyY2VwdFVybC5zdWJzdHJpbmcoMCwgMTAwKX1gKTtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0VXJsKHsgdXJsOiBpbnRlcmNlcHRVcmwsIGhlYWRlcnM6IEJST1dTRVJfSEVBREVSUyB9KTtcbiAgICAgICAgICAgICAgICBjb25zdCBjb250ZW50VHlwZSA9IHVybC5lbmRzV2l0aCgnLmNzcycpID8gJ3RleHQvY3NzJ1xuICAgICAgICAgICAgICAgICAgICA6IHVybC5lbmRzV2l0aCgnLmpzJykgPyAnYXBwbGljYXRpb24vamF2YXNjcmlwdCdcbiAgICAgICAgICAgICAgICAgICAgOiB1cmwuZW5kc1dpdGgoJy5qc29uJykgPyAnYXBwbGljYXRpb24vanNvbidcbiAgICAgICAgICAgICAgICAgICAgOiB1cmwuZW5kc1dpdGgoJy53YXNtJykgPyAnYXBwbGljYXRpb24vd2FzbSdcbiAgICAgICAgICAgICAgICAgICAgOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJztcblxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEZldGNoIHByb3hpZWQgT0s6ICR7dXJsLnNwbGl0KCcvJykucG9wKCk/LnN1YnN0cmluZygwLCA1MCl9YCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShyZXNwb25zZS50ZXh0LCB7XG4gICAgICAgICAgICAgICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgICAgICAgICAgICAgICBzdGF0dXNUZXh0OiAnT0snLFxuICAgICAgICAgICAgICAgICAgICBoZWFkZXJzOiBuZXcgSGVhZGVycyh7ICdDb250ZW50LVR5cGUnOiBjb250ZW50VHlwZSB9KSxcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbR2VvR2VicmFdIEZldGNoIHByb3h5IGZhaWxlZDogJHt1cmx9YCwgZSk7XG4gICAgICAgICAgICAgICAgdGhyb3cgZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb3JpZ0ZldGNoKGlucHV0LCBpbml0KTtcbiAgICB9O1xuXG4gICAgY29uc29sZS5sb2coJ1tHZW9HZWJyYV0gRmV0Y2ggaW50ZXJjZXB0b3IgaW5zdGFsbGVkJyk7XG59XG5cbi8vIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuLy8gUHVibGljIEFQSVxuLy8gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbi8qKlxuICogSW5zdGFsbCBBTEwgaW50ZXJjZXB0b3JzLiBNdXN0IGJlIGNhbGxlZCBiZWZvcmUgbG9hZGluZyBHZW9HZWJyYS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGluc3RhbGxJbnRlcmNlcHRvcigpOiB2b2lkIHtcbiAgICBpZiAoaW50ZXJjZXB0b3JJbnN0YWxsZWQpIHJldHVybjtcbiAgICBpbnRlcmNlcHRvckluc3RhbGxlZCA9IHRydWU7XG4gICAgaW5zdGFsbERPTUludGVyY2VwdG9yKCk7XG4gICAgaW5zdGFsbFhIUkludGVyY2VwdG9yKCk7XG4gICAgaW5zdGFsbEZldGNoSW50ZXJjZXB0b3IoKTtcbiAgICBjb25zb2xlLmxvZygnW0dlb0dlYnJhXSBBbGwgaW50ZXJjZXB0b3JzIGFjdGl2ZScpO1xufVxuXG4vKipcbiAqIFJlbW92ZSBhbGwgaW50ZXJjZXB0b3JzIGFuZCByZXN0b3JlIG9yaWdpbmFsIG1ldGhvZHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVJbnRlcmNlcHRvcigpOiB2b2lkIHtcbiAgICBpZiAoIWludGVyY2VwdG9ySW5zdGFsbGVkKSByZXR1cm47XG4gICAgTm9kZS5wcm90b3R5cGUuYXBwZW5kQ2hpbGQgPSBvcmlnQXBwZW5kQ2hpbGQ7XG4gICAgTm9kZS5wcm90b3R5cGUuaW5zZXJ0QmVmb3JlID0gb3JpZ0luc2VydEJlZm9yZTtcbiAgICBYTUxIdHRwUmVxdWVzdC5wcm90b3R5cGUub3BlbiA9IG9yaWdYSFJPcGVuO1xuICAgIFhNTEh0dHBSZXF1ZXN0LnByb3RvdHlwZS5zZW5kID0gb3JpZ1hIUlNlbmQ7XG4gICAgd2luZG93LmZldGNoID0gb3JpZ0ZldGNoO1xuICAgIC8vIFJlc3RvcmUgb3JpZ2luYWwgc2NyaXB0IHNyYyBkZXNjcmlwdG9yXG4gICAgaWYgKG9yaWdTY3JpcHRTcmNEZXNjcmlwdG9yKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShIVE1MU2NyaXB0RWxlbWVudC5wcm90b3R5cGUsICdzcmMnLCBvcmlnU2NyaXB0U3JjRGVzY3JpcHRvcik7XG4gICAgfVxuICAgIGludGVyY2VwdG9ySW5zdGFsbGVkID0gZmFsc2U7XG4gICAgY29uc29sZS5sb2coJ1tHZW9HZWJyYV0gQWxsIGludGVyY2VwdG9ycyByZW1vdmVkJyk7XG59XG5cbi8qKiBFeHRyYWN0ZWQgR2VvR2VicmEgQ0ROIHZlcnNpb24gKGUuZy4gXCI1LjIuOTA5LjlcIikgKi9cbmxldCBnZ2JWZXJzaW9uOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuLyoqIEdldCB0aGUgZXh0cmFjdGVkIEdlb0dlYnJhIHZlcnNpb24gc3RyaW5nICovXG5leHBvcnQgZnVuY3Rpb24gZ2V0R2VvR2VicmFWZXJzaW9uKCk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiBnZ2JWZXJzaW9uO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIEdlb0dlYnJhIGRlcGxveW1lbnQgc2NyaXB0LlxuICogQWZ0ZXIgdGhpcyByZXNvbHZlcywgd2luZG93LkdHQkFwcGxldCBpcyBhdmFpbGFibGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkR2VvR2VicmEoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCh3aW5kb3cgYXMgYW55KS5HR0JBcHBsZXQpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ1tHZW9HZWJyYV0gR0dCQXBwbGV0IGFscmVhZHkgYXZhaWxhYmxlJyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpbnN0YWxsSW50ZXJjZXB0b3IoKTtcblxuICAgIGNvbnN0IGRlcGxveVVybCA9ICdodHRwczovL3d3dy5nZW9nZWJyYS5vcmcvYXBwcy9kZXBsb3lnZ2IuanMnO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29kZSA9IGF3YWl0IGZldGNoVGV4dChkZXBsb3lVcmwpO1xuXG4gICAgICAgIC8vIEV4dHJhY3QgdmVyc2lvbiBmcm9tIHRoZSBoYXJkY29kZWQgbW9kdWxlQmFzZSBpbiBkZXBsb3lnZ2IuanNcbiAgICAgICAgLy8gZS5nLiBcImh0dHBzOi8vd3d3Lmdlb2dlYnJhLm9yZy9hcHBzLzUuMi45MDkuOS9cIlxuICAgICAgICBjb25zdCB2ZXJzaW9uTWF0Y2ggPSBjb2RlLm1hdGNoKC9nZW9nZWJyYVxcLm9yZ1xcL2FwcHNcXC8oWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rXFwuWzAtOV0rKVxcLy8pO1xuICAgICAgICBpZiAodmVyc2lvbk1hdGNoKSB7XG4gICAgICAgICAgICBnZ2JWZXJzaW9uID0gdmVyc2lvbk1hdGNoWzFdO1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gRGV0ZWN0ZWQgdmVyc2lvbjogJHtnZ2JWZXJzaW9ufWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKCdbR2VvR2VicmFdIENvdWxkIG5vdCBleHRyYWN0IHZlcnNpb24gZnJvbSBkZXBsb3lnZ2IuanMnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEV4ZWN1dGluZyBkZXBsb3lnZ2IuanMgKCR7Y29kZS5sZW5ndGh9IGJ5dGVzKS4uLmApO1xuICAgICAgICAoMCwgZXZhbCkoY29kZSk7XG5cbiAgICAgICAgY29uc3QgYXZhaWxhYmxlID0gISEod2luZG93IGFzIGFueSkuR0dCQXBwbGV0O1xuICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBkZXBsb3lnZ2IuanMgZXhlY3V0ZWQuIEdHQkFwcGxldDogJHthdmFpbGFibGV9YCk7XG5cbiAgICAgICAgaWYgKCFhdmFpbGFibGUpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignR0dCQXBwbGV0IG5vdCBkZWZpbmVkIGFmdGVyIGV4ZWN1dGluZyBkZXBsb3lnZ2IuanMnKTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignW0dlb0dlYnJhXSBGYWlsZWQgdG8gbG9hZCBkZXBsb3lnZ2IuanM6JywgZSk7XG4gICAgICAgIHRocm93IGU7XG4gICAgfVxufVxuIiwgIi8qKlxuICogR2VvR2VicmEgUmVuZGVyZXJcbiAqXG4gKiBDcmVhdGVzIHJlYWwgR2VvR2VicmEgYXBwbGV0cyBhbmQgZXhlY3V0ZXMgR2VvR2VicmEgY29tbWFuZHNcbiAqIHZpYSB0aGUgZXZhbENvbW1hbmQgQVBJLiBGdWxsIEdlb0dlYnJhIGNvbXBhdGliaWxpdHkuXG4gKi9cbmltcG9ydCB7IGxvYWRHZW9HZWJyYSwgZ2V0R2VvR2VicmFWZXJzaW9uIH0gZnJvbSAnLi9nZW9nZWJyYS1sb2FkZXInO1xuaW1wb3J0IHsgUmVuZGVyTW9kZSB9IGZyb20gJy4vdHlwZXMnO1xuXG5kZWNsYXJlIGNvbnN0IEdHQkFwcGxldDogYW55O1xuXG4vKiogTWFwIFJlbmRlck1vZGUgdG8gR2VvR2VicmEgYXBwIG5hbWUgKi9cbmNvbnN0IEFQUF9OQU1FUzogUmVjb3JkPFJlbmRlck1vZGUsIHN0cmluZz4gPSB7XG4gICAgW1JlbmRlck1vZGUuR2VvbWV0cnkyRF06ICdjbGFzc2ljJyxcbiAgICBbUmVuZGVyTW9kZS5HZW9tZXRyeTNEXTogJzNkJyxcbiAgICBbUmVuZGVyTW9kZS5HcmFwaF06ICdncmFwaGluZycsXG59O1xuXG4vKiogRGVmYXVsdCBwZXJzcGVjdGl2ZXMgZm9yIGVhY2ggbW9kZSAqL1xuY29uc3QgREVGQVVMVF9QRVJTUEVDVElWRVM6IFJlY29yZDxSZW5kZXJNb2RlLCBzdHJpbmc+ID0ge1xuICAgIFtSZW5kZXJNb2RlLkdlb21ldHJ5MkRdOiAnQUcnLCAgLy8gQWxnZWJyYSBwYW5lbCAobGVmdCkgKyBHcmFwaGljc1xuICAgIFtSZW5kZXJNb2RlLkdlb21ldHJ5M0RdOiAnQVQnLCAgLy8gQWxnZWJyYSBwYW5lbCAobGVmdCkgKyAzRCB2aWV3XG4gICAgW1JlbmRlck1vZGUuR3JhcGhdOiAnQUcnLCAgICAgIC8vIEFsZ2VicmEgcGFuZWwgKGxlZnQpICsgR3JhcGhpY3Ncbn07XG5cbi8qKiBEZWZhdWx0IGhlaWdodHMgZm9yIGVhY2ggbW9kZSAqL1xuY29uc3QgREVGQVVMVF9IRUlHSFRTOiBSZWNvcmQ8UmVuZGVyTW9kZSwgbnVtYmVyPiA9IHtcbiAgICBbUmVuZGVyTW9kZS5HZW9tZXRyeTJEXTogNTAwLFxuICAgIFtSZW5kZXJNb2RlLkdlb21ldHJ5M0RdOiA3NTAsXG4gICAgW1JlbmRlck1vZGUuR3JhcGhdOiA1MDAsXG59O1xuXG5sZXQgYXBwbGV0Q291bnRlciA9IDA7XG5cbi8qKiBXYWl0IGZvciBuZXh0IGFuaW1hdGlvbiBmcmFtZSAoZWxlbWVudCBoYXMgbGF5b3V0IGRpbWVuc2lvbnMpICovXG5mdW5jdGlvbiB3YWl0Rm9yTGF5b3V0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHJlcXVlc3RBbmltYXRpb25GcmFtZSgoKSA9PiByZXNvbHZlKCkpKTtcbn1cblxuLyoqXG4gKiBQYXJzZWQgcGFyYW1ldGVycyBmcm9tIGNvZGUgYmxvY2sgZnJvbnRtYXR0ZXIuXG4gKiBMaW5lcyBzdGFydGluZyB3aXRoIEAgYXJlIHRyZWF0ZWQgYXMgcGFyYW1ldGVyczpcbiAqICAgQGhlaWdodCA2MDBcbiAqICAgQHdpZHRoIDgwMFxuICogICBAcGVyc3BlY3RpdmUgQUcgICAoQT1BbGdlYnJhLCBHPUdyYXBoaWNzLCBUPTNELCBTPVNwcmVhZHNoZWV0KVxuICogICBAdG9vbGJhciB0cnVlXG4gKiAgIEBncmlkIHRydWVcbiAqICAgQGF4ZXMgdHJ1ZVxuICovXG5leHBvcnQgaW50ZXJmYWNlIEFwcGxldFBhcmFtcyB7XG4gICAgd2lkdGg/OiBudW1iZXI7XG4gICAgaGVpZ2h0PzogbnVtYmVyO1xuICAgIHBlcnNwZWN0aXZlPzogc3RyaW5nO1xuICAgIHRvb2xiYXI/OiBib29sZWFuO1xuICAgIGdyaWQ/OiBib29sZWFuO1xuICAgIGF4ZXM/OiBib29sZWFuO1xufVxuXG5mdW5jdGlvbiBwYXJzZVNvdXJjZShzb3VyY2U6IHN0cmluZyk6IHsgcGFyYW1zOiBBcHBsZXRQYXJhbXM7IGNvbW1hbmRzOiBzdHJpbmdbXSB9IHtcbiAgICBjb25zdCBwYXJhbXM6IEFwcGxldFBhcmFtcyA9IHt9O1xuICAgIGNvbnN0IGNvbW1hbmRzOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZm9yIChjb25zdCByYXcgb2Ygc291cmNlLnNwbGl0KCdcXG4nKSkge1xuICAgICAgICBjb25zdCBsaW5lID0gcmF3LnRyaW0oKTtcbiAgICAgICAgaWYgKCFsaW5lIHx8IGxpbmUuc3RhcnRzV2l0aCgnIycpIHx8IGxpbmUuc3RhcnRzV2l0aCgnLy8nKSkgY29udGludWU7XG5cbiAgICAgICAgLy8gUGFyc2UgQGtleSB2YWx1ZSBwYXJhbWV0ZXJzXG4gICAgICAgIGNvbnN0IHBhcmFtTWF0Y2ggPSBsaW5lLm1hdGNoKC9eQChcXHcrKVxccysoLispJC8pO1xuICAgICAgICBpZiAocGFyYW1NYXRjaCkge1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gcGFyYW1NYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgY29uc3QgdmFsID0gcGFyYW1NYXRjaFsyXS50cmltKCk7XG4gICAgICAgICAgICBzd2l0Y2ggKGtleSkge1xuICAgICAgICAgICAgICAgIGNhc2UgJ3dpZHRoJzpcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLndpZHRoID0gcGFyc2VJbnQodmFsKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSAnaGVpZ2h0JzpcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLmhlaWdodCA9IHBhcnNlSW50KHZhbCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGNhc2UgJ3BlcnNwZWN0aXZlJzpcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnBlcnNwZWN0aXZlID0gdmFsO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICd0b29sYmFyJzpcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLnRvb2xiYXIgPSB2YWwudG9Mb3dlckNhc2UoKSA9PT0gJ3RydWUnIHx8IHZhbCA9PT0gJzEnO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdncmlkJzpcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLmdyaWQgPSB2YWwudG9Mb3dlckNhc2UoKSA9PT0gJ3RydWUnIHx8IHZhbCA9PT0gJzEnO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlICdheGVzJzpcbiAgICAgICAgICAgICAgICAgICAgcGFyYW1zLmF4ZXMgPSB2YWwudG9Mb3dlckNhc2UoKSA9PT0gJ3RydWUnIHx8IHZhbCA9PT0gJzEnO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgY29tbWFuZHMucHVzaChsaW5lKTtcbiAgICB9XG5cbiAgICByZXR1cm4geyBwYXJhbXMsIGNvbW1hbmRzIH07XG59XG5cbi8qKlxuICogUmVuZGVyIGEgR2VvR2VicmEgY29kZSBibG9jayBpbnRvIHRoZSBnaXZlbiBjb250YWluZXIuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5kZXJHZW9HZWJyYShcbiAgICBjb250YWluZXI6IEhUTUxFbGVtZW50LFxuICAgIHNvdXJjZTogc3RyaW5nLFxuICAgIG1vZGU6IFJlbmRlck1vZGUsXG4gICAgb25SZXNldFJlYWR5PzogKHJlc2V0Rm46ICgpID0+IHZvaWQpID0+IHZvaWRcbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGFwcGxldElkID0gYGdnYi1hcHBsZXQtJHtEYXRlLm5vdygpfS0keysrYXBwbGV0Q291bnRlcn1gO1xuICAgIGNvbnN0IGFwcGxldERpdiA9IGNvbnRhaW5lci5jcmVhdGVEaXYoeyBjbHM6ICdnZ2ItYXBwbGV0LWNvbnRhaW5lcicgfSk7XG4gICAgYXBwbGV0RGl2LmlkID0gYXBwbGV0SWQ7XG5cbiAgICAvLyBTaG93IGxvYWRpbmcgc3RhdGVcbiAgICBjb25zdCBsb2FkaW5nRWwgPSBjb250YWluZXIuY3JlYXRlRGl2KHsgY2xzOiAnZ2diLWxvYWRpbmcnIH0pO1xuICAgIGxvYWRpbmdFbC5zZXRUZXh0KCdMb2FkaW5nIEdlb0dlYnJhLi4uJyk7XG5cbiAgICAvLyBQYXJzZSBwYXJhbWV0ZXJzIGFuZCBjb21tYW5kcyBmcm9tIHNvdXJjZVxuICAgIGNvbnN0IHsgcGFyYW1zOiB1c2VyUGFyYW1zLCBjb21tYW5kcyB9ID0gcGFyc2VTb3VyY2Uoc291cmNlKTtcbiAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBSZW5kZXJpbmcgJHttb2RlfSBhcHBsZXQgKCR7QVBQX05BTUVTW21vZGVdfSkgd2l0aCAke2NvbW1hbmRzLmxlbmd0aH0gY29tbWFuZHMsIHBhcmFtczpgLCB1c2VyUGFyYW1zKTtcblxuICAgIC8vIENhcHR1cmUgYW55IHVuaGFuZGxlZCBlcnJvcnMgZHVyaW5nIEdlb0dlYnJhIGluaXRpYWxpemF0aW9uXG4gICAgY29uc3QgZXJyb3JDYXB0dXJlOiBzdHJpbmdbXSA9IFtdO1xuICAgIGNvbnN0IGVycm9ySGFuZGxlciA9IChldmVudDogRXJyb3JFdmVudCkgPT4ge1xuICAgICAgICBpZiAoZXZlbnQuZmlsZW5hbWU/LmluY2x1ZGVzKCd3ZWIzZCcpIHx8IGV2ZW50LmZpbGVuYW1lPy5pbmNsdWRlcygnZ2VvZ2VicmEnKSB8fCBldmVudC5maWxlbmFtZT8uaW5jbHVkZXMoJ1ZNJykpIHtcbiAgICAgICAgICAgIGVycm9yQ2FwdHVyZS5wdXNoKGAke2V2ZW50Lm1lc3NhZ2V9IGF0ICR7ZXZlbnQuZmlsZW5hbWV9OiR7ZXZlbnQubGluZW5vfWApO1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW0dlb0dlYnJhXSBDYXVnaHQgZXJyb3I6ICR7ZXZlbnQubWVzc2FnZX1gLCBldmVudCk7XG4gICAgICAgIH1cbiAgICB9O1xuICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIGVycm9ySGFuZGxlcik7XG5cbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBsb2FkR2VvR2VicmEoKTtcblxuICAgICAgICBpZiAodHlwZW9mIEdHQkFwcGxldCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignR0dCQXBwbGV0IG5vdCBhdmFpbGFibGUgYWZ0ZXIgbG9hZGluZycpO1xuICAgICAgICB9XG5cbiAgICAgICAgbG9hZGluZ0VsLnNldFRleHQoJ0luaXRpYWxpemluZyBhcHBsZXQuLi4nKTtcblxuICAgICAgICAvLyBXYWl0IGZvciBET00gbGF5b3V0IHNvIHdlIGNhbiBtZWFzdXJlIHRoZSBhY3R1YWwgY29udGFpbmVyIHdpZHRoXG4gICAgICAgIGF3YWl0IHdhaXRGb3JMYXlvdXQoKTtcbiAgICAgICAgYXdhaXQgd2FpdEZvckxheW91dCgpO1xuXG4gICAgICAgIGNvbnN0IG1lYXN1cmVkV2lkdGggPSBhcHBsZXREaXYuY2xpZW50V2lkdGggfHwgYXBwbGV0RGl2Lm9mZnNldFdpZHRoXG4gICAgICAgICAgICB8fCBjb250YWluZXIuY2xpZW50V2lkdGggfHwgY29udGFpbmVyLm9mZnNldFdpZHRoIHx8IDgwMDtcbiAgICAgICAgY29uc3Qgd2lkdGggPSB1c2VyUGFyYW1zLndpZHRoIHx8IE1hdGgubWF4KG1lYXN1cmVkV2lkdGgsIDQwMCk7XG4gICAgICAgIGNvbnN0IGhlaWdodCA9IHVzZXJQYXJhbXMuaGVpZ2h0IHx8IERFRkFVTFRfSEVJR0hUU1ttb2RlXTtcblxuICAgICAgICAvLyBBcHBseSB1c2VyLXNwZWNpZmllZCBoZWlnaHQgdG8gdGhlIGNvbnRhaW5lciBzbyBpdCBkb2Vzbid0IGNvbGxhcHNlXG4gICAgICAgIGlmICh1c2VyUGFyYW1zLmhlaWdodCkge1xuICAgICAgICAgICAgYXBwbGV0RGl2LnN0eWxlLm1pbkhlaWdodCA9IGAke3VzZXJQYXJhbXMuaGVpZ2h0fXB4YDtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIE1lYXN1cmVkIGNvbnRhaW5lciB3aWR0aDogJHttZWFzdXJlZFdpZHRofXB4IFx1MjE5MiB1c2luZyAke3dpZHRofXgke2hlaWdodH1gKTtcblxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZXJyTXNnID0gZXJyb3JDYXB0dXJlLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgICAgICAgPyBgR2VvR2VicmEgZXJyb3JzOlxcbiR7ZXJyb3JDYXB0dXJlLmpvaW4oJ1xcbicpfWBcbiAgICAgICAgICAgICAgICAgICAgOiAnR2VvR2VicmEgYXBwbGV0IGluaXRpYWxpemF0aW9uIHRpbWVkIG91dCAoNjBzKS4gQ2hlY2sgY29uc29sZSBmb3IgZGV0YWlscy4nO1xuICAgICAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoZXJyTXNnKSk7XG4gICAgICAgICAgICB9LCA2MDAwMCk7XG5cbiAgICAgICAgICAgIGNvbnN0IHBlcnNwZWN0aXZlID0gdXNlclBhcmFtcy5wZXJzcGVjdGl2ZSB8fCBERUZBVUxUX1BFUlNQRUNUSVZFU1ttb2RlXTtcbiAgICAgICAgICAgIGNvbnN0IHNob3dUb29sQmFyID0gdXNlclBhcmFtcy50b29sYmFyID8/IGZhbHNlO1xuXG4gICAgICAgICAgICBjb25zdCBwYXJhbXM6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7XG4gICAgICAgICAgICAgICAgaWQ6IGFwcGxldElkLFxuICAgICAgICAgICAgICAgIGFwcE5hbWU6IEFQUF9OQU1FU1ttb2RlXSxcbiAgICAgICAgICAgICAgICB3aWR0aCxcbiAgICAgICAgICAgICAgICBoZWlnaHQsXG4gICAgICAgICAgICAgICAgcGVyc3BlY3RpdmUsXG4gICAgICAgICAgICAgICAgc2NhbGVDb250YWluZXJDbGFzczogJ2dnYi1hcHBsZXQtY29udGFpbmVyJyxcbiAgICAgICAgICAgICAgICBzaG93QWxnZWJyYUlucHV0OiB0cnVlLFxuICAgICAgICAgICAgICAgIGFsZ2VicmFJbnB1dFBvc2l0aW9uOiAnYWxnZWJyYScsXG4gICAgICAgICAgICAgICAgc2hvd1Rvb2xCYXIsXG4gICAgICAgICAgICAgICAgc2hvd1Rvb2xCYXJIZWxwOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBzaG93TWVudUJhcjogZmFsc2UsXG4gICAgICAgICAgICAgICAgc2hvd1Jlc2V0SWNvbjogZmFsc2UsXG4gICAgICAgICAgICAgICAgZW5hYmxlTGFiZWxEcmFnczogdHJ1ZSxcbiAgICAgICAgICAgICAgICBlbmFibGVTaGlmdERyYWdab29tOiB0cnVlLFxuICAgICAgICAgICAgICAgIGVuYWJsZVJpZ2h0Q2xpY2s6IHRydWUsXG4gICAgICAgICAgICAgICAgZW5hYmxlQ0FTOiBmYWxzZSxcbiAgICAgICAgICAgICAgICBlbmFibGVBbmltYXRpb246IHRydWUsXG4gICAgICAgICAgICAgICAgYWxsb3dTdHlsZUJhcjogZmFsc2UsXG4gICAgICAgICAgICAgICAgZXJyb3JEaWFsb2dzQWN0aXZlOiBmYWxzZSxcbiAgICAgICAgICAgICAgICB1c2VCcm93c2VyRm9ySlM6IGZhbHNlLFxuICAgICAgICAgICAgICAgIHByZXZlbnRGb2N1czogdHJ1ZSxcbiAgICAgICAgICAgICAgICBhcHBsZXRPbkxvYWQ6IChhcGk6IGFueSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgICAgICAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIGVycm9ySGFuZGxlcik7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIEFwcGxldCAke2FwcGxldElkfSByZWFkeSwgZXhlY3V0aW5nICR7Y29tbWFuZHMubGVuZ3RofSBjb21tYW5kcy4uLmApO1xuICAgICAgICAgICAgICAgICAgICBsb2FkaW5nRWwucmVtb3ZlKCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gQXBwbHkgZ3JpZC9heGVzIHNldHRpbmdzIGJlZm9yZSBjb21tYW5kc1xuICAgICAgICAgICAgICAgICAgICBpZiAodXNlclBhcmFtcy5ncmlkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGFwaS5zZXRHcmlkVmlzaWJsZSh1c2VyUGFyYW1zLmdyaWQpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh1c2VyUGFyYW1zLmF4ZXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYXBpLnNldEF4ZXNWaXNpYmxlKHVzZXJQYXJhbXMuYXhlcywgdXNlclBhcmFtcy5heGVzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgICAgIGV4ZWN1dGVDb21tYW5kcyhhcGksIGNvbW1hbmRzKTtcblxuICAgICAgICAgICAgICAgICAgICAvLyBBdXRvLWNlbnRlciB0aGUgdmlldyBhZnRlciBjb21tYW5kcyBhcmUgZXhlY3V0ZWRcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChtb2RlID09PSBSZW5kZXJNb2RlLkdlb21ldHJ5M0QpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gRm9yIDNEIHZpZXc6IHJlc2V0IHJvdGF0aW9uIGFuZCB6b29tIHRvIHNob3dcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYWxsIG9iamVjdHMuIFZpZXcgSUQgNTEyID0gM0QgR3JhcGhpY3MgVmlld1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGkuZXZhbENvbW1hbmQoJ1NldEFjdGl2ZVZpZXcoMiknKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gQ2VudGVyVmlldyByZXNldHMgdGhlIDNEIGNhbWVyYSBwb3NpdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkgeyBhcGkuZXZhbENvbW1hbmQoJ0NlbnRlclZpZXcoKDAsMCwwKSknKTsgfSBjYXRjaCB7fVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBTZWxlY3RBbGwgKyBab29tVG9GaXQgYXBwcm9hY2hcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhcGkuZXZhbENvbW1hbmQoJ1NlbGVjdEFsbCgpJyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaS5ldmFsQ29tbWFuZCgnWm9vbVRvRml0KCknKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYXBpLmV2YWxDb21tYW5kKCdTZWxlY3RBbGwoKScpOyAvLyBkZXNlbGVjdFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBab29tVG9GaXQgbWF5IG5vdCBleGlzdCBpbiBhbGwgdmVyc2lvbnNcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gQXV0by1jZW50ZXIgYXBwbGllZGApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignW0dlb0dlYnJhXSBBdXRvLWNlbnRlciBmYWlsZWQ6JywgZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sIDMwMCk7XG5cbiAgICAgICAgICAgICAgICAgICAgLy8gU2F2ZSBpbml0aWFsIHN0YXRlIGZvciByZXNldCAoYWZ0ZXIgYXV0by1jZW50ZXIgc2V0dGxlcylcbiAgICAgICAgICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHNhdmVkU3RhdGUgPSBhcGkuZ2V0QmFzZTY0KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gSW5pdGlhbCBzdGF0ZSBzYXZlZCAoJHtzYXZlZFN0YXRlLmxlbmd0aH0gY2hhcnMpYCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9uUmVzZXRSZWFkeSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBvblJlc2V0UmVhZHkoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gUmVzdG9yaW5nIGluaXRpYWwgc3RhdGUuLi5gKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGFwaS5zZXRCYXNlNjQoc2F2ZWRTdGF0ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1tHZW9HZWJyYV0gQ291bGQgbm90IHNhdmUgaW5pdGlhbCBzdGF0ZTonLCBlKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSwgODAwKTtcblxuICAgICAgICAgICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gQ3JlYXRpbmcgR0dCQXBwbGV0KGFwcE5hbWU9XCIke0FQUF9OQU1FU1ttb2RlXX1cIiwgJHt3aWR0aH14JHtoZWlnaHR9KS4uLmApO1xuICAgICAgICAgICAgICAgIGNvbnN0IGFwcGxldCA9IG5ldyBHR0JBcHBsZXQocGFyYW1zLCB0cnVlKTtcblxuICAgICAgICAgICAgICAgIGNvbnN0IHZlciA9IGdldEdlb0dlYnJhVmVyc2lvbigpO1xuICAgICAgICAgICAgICAgIGlmICh2ZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29kZWJhc2UgPSBgaHR0cHM6Ly93d3cuZ2VvZ2VicmEub3JnL2FwcHMvJHt2ZXJ9L3dlYjNkL2A7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbR2VvR2VicmFdIFNldHRpbmcgY29kZWJhc2U6ICR7Y29kZWJhc2V9YCk7XG4gICAgICAgICAgICAgICAgICAgIGFwcGxldC5zZXRIVE1MNUNvZGViYXNlKGNvZGViYXNlKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBJbmplY3RpbmcgaW50byAjJHthcHBsZXRJZH0uLi5gKTtcbiAgICAgICAgICAgICAgICBhcHBsZXQuaW5qZWN0KGFwcGxldElkKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBpbmplY3QoKSBjYWxsZWQsIHdhaXRpbmcgZm9yIGFwcGxldE9uTG9hZCBjYWxsYmFjay4uLmApO1xuICAgICAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignZXJyb3InLCBlcnJvckhhbmRsZXIpO1xuICAgICAgICAgICAgICAgIHJlamVjdChlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIGVycm9ySGFuZGxlcik7XG4gICAgICAgIGxvYWRpbmdFbC5yZW1vdmUoKTtcbiAgICAgICAgY29uc29sZS5lcnJvcignW0dlb0dlYnJhXSBSZW5kZXIgZmFpbGVkOicsIGUpO1xuICAgICAgICBjb25zdCBtc2cgPSAoZSBhcyBFcnJvcikubWVzc2FnZSB8fCBTdHJpbmcoZSk7XG4gICAgICAgIGNvbnRhaW5lci5jcmVhdGVEaXYoe1xuICAgICAgICAgICAgY2xzOiAnZ2VvZ2VicmEtZXJyb3InLFxuICAgICAgICAgICAgdGV4dDogYEZhaWxlZCB0byByZW5kZXIgR2VvR2VicmE6ICR7bXNnfWAsXG4gICAgICAgIH0pO1xuICAgIH1cbn1cblxuY29uc3QgQVBJX0NPTU1BTkRfSEFORExFUlM6IFJlY29yZDxzdHJpbmcsIChhcGk6IGFueSwgYXJnczogc3RyaW5nW10pID0+IHZvaWQ+ID0ge1xuICAgICdTZXRBbmltYXRpbmcnOiAoYXBpLCBhcmdzKSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzWzBdPy50cmltKCk7XG4gICAgICAgIGNvbnN0IGFuaW0gPSBhcmdzWzFdPy50cmltKCkudG9Mb3dlckNhc2UoKSAhPT0gJ2ZhbHNlJztcbiAgICAgICAgaWYgKG5hbWUpIGFwaS5zZXRBbmltYXRpbmcobmFtZSwgYW5pbSk7XG4gICAgfSxcbiAgICAnU3RhcnRBbmltYXRpb24nOiAoYXBpKSA9PiB7IGFwaS5zdGFydEFuaW1hdGlvbigpOyB9LFxuICAgICdTdG9wQW5pbWF0aW9uJzogKGFwaSkgPT4geyBhcGkuc3RvcEFuaW1hdGlvbigpOyB9LFxuICAgICdTZXRBbmltYXRpb25TcGVlZCc6IChhcGksIGFyZ3MpID0+IHtcbiAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbMF0/LnRyaW0oKTtcbiAgICAgICAgY29uc3Qgc3BlZWQgPSBwYXJzZUZsb2F0KGFyZ3NbMV0/LnRyaW0oKSk7XG4gICAgICAgIGlmIChuYW1lICYmICFpc05hTihzcGVlZCkpIGFwaS5zZXRBbmltYXRpb25TcGVlZChuYW1lLCBzcGVlZCk7XG4gICAgfSxcbiAgICAnU2V0Q29sb3InOiAoYXBpLCBhcmdzKSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzWzBdPy50cmltKCk7XG4gICAgICAgIGNvbnN0IHIgPSBwYXJzZUludChhcmdzWzFdPy50cmltKCkpLCBnID0gcGFyc2VJbnQoYXJnc1syXT8udHJpbSgpKSwgYiA9IHBhcnNlSW50KGFyZ3NbM10/LnRyaW0oKSk7XG4gICAgICAgIGlmIChuYW1lKSBhcGkuc2V0Q29sb3IobmFtZSwgciwgZywgYik7XG4gICAgfSxcbiAgICAnU2V0VmlzaWJsZSc6IChhcGksIGFyZ3MpID0+IHtcbiAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbMF0/LnRyaW0oKTtcbiAgICAgICAgY29uc3QgdmlzID0gYXJnc1sxXT8udHJpbSgpLnRvTG93ZXJDYXNlKCkgIT09ICdmYWxzZSc7XG4gICAgICAgIGlmIChuYW1lKSBhcGkuc2V0VmlzaWJsZShuYW1lLCB2aXMpO1xuICAgIH0sXG4gICAgJ1NldEZpeGVkJzogKGFwaSwgYXJncykgPT4ge1xuICAgICAgICBjb25zdCBuYW1lID0gYXJnc1swXT8udHJpbSgpO1xuICAgICAgICBjb25zdCBmaXhlZCA9IGFyZ3NbMV0/LnRyaW0oKS50b0xvd2VyQ2FzZSgpICE9PSAnZmFsc2UnO1xuICAgICAgICBpZiAobmFtZSkgYXBpLnNldEZpeGVkKG5hbWUsIGZpeGVkKTtcbiAgICB9LFxuICAgICdTZXRMaW5lVGhpY2tuZXNzJzogKGFwaSwgYXJncykgPT4ge1xuICAgICAgICBjb25zdCBuYW1lID0gYXJnc1swXT8udHJpbSgpO1xuICAgICAgICBjb25zdCB0ID0gcGFyc2VJbnQoYXJnc1sxXT8udHJpbSgpKTtcbiAgICAgICAgaWYgKG5hbWUgJiYgIWlzTmFOKHQpKSBhcGkuc2V0TGluZVRoaWNrbmVzcyhuYW1lLCB0KTtcbiAgICB9LFxuICAgICdTZXRQb2ludFNpemUnOiAoYXBpLCBhcmdzKSA9PiB7XG4gICAgICAgIGNvbnN0IG5hbWUgPSBhcmdzWzBdPy50cmltKCk7XG4gICAgICAgIGNvbnN0IHMgPSBwYXJzZUludChhcmdzWzFdPy50cmltKCkpO1xuICAgICAgICBpZiAobmFtZSAmJiAhaXNOYU4ocykpIGFwaS5zZXRQb2ludFNpemUobmFtZSwgcyk7XG4gICAgfSxcbiAgICAnU2V0Q2FwdGlvbic6IChhcGksIGFyZ3MpID0+IHtcbiAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbMF0/LnRyaW0oKTtcbiAgICAgICAgY29uc3QgY2FwdGlvbiA9IGFyZ3Muc2xpY2UoMSkuam9pbignLCcpLnRyaW0oKS5yZXBsYWNlKC9eW1wiJ118W1wiJ10kL2csICcnKTtcbiAgICAgICAgaWYgKG5hbWUpIGFwaS5zZXRDYXB0aW9uKG5hbWUsIGNhcHRpb24pO1xuICAgIH0sXG4gICAgJ1NldExhYmVsVmlzaWJsZSc6IChhcGksIGFyZ3MpID0+IHtcbiAgICAgICAgY29uc3QgbmFtZSA9IGFyZ3NbMF0/LnRyaW0oKTtcbiAgICAgICAgY29uc3QgdmlzID0gYXJnc1sxXT8udHJpbSgpLnRvTG93ZXJDYXNlKCkgIT09ICdmYWxzZSc7XG4gICAgICAgIGlmIChuYW1lKSBhcGkuc2V0TGFiZWxWaXNpYmxlKG5hbWUsIHZpcyk7XG4gICAgfSxcbn07XG5cbmZ1bmN0aW9uIHRyeUFwaUNvbW1hbmQoYXBpOiBhbnksIGNtZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgbWF0Y2ggPSBjbWQubWF0Y2goL14oXFx3KylcXHMqXFwoKC4qKVxcKVxccyokLyk7XG4gICAgaWYgKCFtYXRjaCkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IGhhbmRsZXIgPSBBUElfQ09NTUFORF9IQU5ETEVSU1ttYXRjaFsxXV07XG4gICAgaWYgKCFoYW5kbGVyKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgYXJncyA9IG1hdGNoWzJdLnNwbGl0KCcsJykubWFwKGEgPT4gYS50cmltKCkpO1xuICAgIHRyeSB7XG4gICAgICAgIGhhbmRsZXIoYXBpLCBhcmdzKTtcbiAgICAgICAgY29uc29sZS5sb2coYFtHZW9HZWJyYV0gQVBJIGNhbGw6ICR7bWF0Y2hbMV19KCR7YXJncy5qb2luKCcsICcpfSlgKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgW0dlb0dlYnJhXSBBUEkgY2FsbCBmYWlsZWQ6ICR7Y21kfWAsIGUpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbn1cblxuZnVuY3Rpb24gZXhlY3V0ZUNvbW1hbmRzKGFwaTogYW55LCBjb21tYW5kczogc3RyaW5nW10pOiB2b2lkIHtcbiAgICB0cnkge1xuICAgICAgICBhcGkuc2V0RXJyb3JEaWFsb2dzQWN0aXZlKGZhbHNlKTtcbiAgICAgICAgZm9yIChjb25zdCBjbWQgb2YgY29tbWFuZHMpIHtcbiAgICAgICAgICAgIGlmICh0cnlBcGlDb21tYW5kKGFwaSwgY21kKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBldmFsQ29tbWFuZDogJHtjbWR9YCk7XG4gICAgICAgICAgICBjb25zdCBzdWNjZXNzID0gYXBpLmV2YWxDb21tYW5kKGNtZCk7XG4gICAgICAgICAgICBpZiAoIXN1Y2Nlc3MpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oYFtHZW9HZWJyYV0gQ29tbWFuZCBtYXkgaGF2ZSBmYWlsZWQ6ICR7Y21kfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGFuaW1DbWRzID0gY29tbWFuZHMuZmlsdGVyKGNtZCA9PiB7XG4gICAgICAgICAgICBjb25zdCBtID0gY21kLm1hdGNoKC9eKFxcdyspXFxzKlxcKC8pO1xuICAgICAgICAgICAgcmV0dXJuIG0gJiYgWydTZXRBbmltYXRpbmcnLCAnU3RhcnRBbmltYXRpb24nLCAnU2V0QW5pbWF0aW9uU3BlZWQnLCAnU3RvcEFuaW1hdGlvbiddLmluY2x1ZGVzKG1bMV0pO1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGFuaW1DbWRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgY21kIG9mIGFuaW1DbWRzKSB0cnlBcGlDb21tYW5kKGFwaSwgY21kKTtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBBbmltYXRpb24gY29tbWFuZHMgYXBwbGllZGApO1xuICAgICAgICAgICAgfSwgMzAwKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zb2xlLmxvZyhgW0dlb0dlYnJhXSBBbGwgJHtjb21tYW5kcy5sZW5ndGh9IGNvbW1hbmRzIGV4ZWN1dGVkYCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKCdbR2VvR2VicmFdIEVycm9yIGV4ZWN1dGluZyBjb21tYW5kczonLCBlKTtcbiAgICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQUFxRDs7O0FDWTlDLElBQU0sb0JBQWdEO0FBQUEsRUFDekQsWUFBWTtBQUFBLEVBQ1osT0FBTztBQUFBLEVBQ1AsZUFBZTtBQUFBLEVBQ2YsVUFBVTtBQUFBLEVBQ1Ysa0JBQWtCO0FBQUEsRUFDbEIsYUFBYTtBQUNqQjs7O0FDUkEsc0JBQTJCO0FBRTNCLElBQU0sWUFBWSxDQUFDLGdCQUFnQixjQUFjO0FBR2pELElBQU0sWUFBWSxvQkFBSSxJQUE2QjtBQUduRCxJQUFJLHVCQUF1QjtBQUMzQixJQUFJO0FBQ0osSUFBSTtBQUNKLElBQUk7QUFDSixJQUFJO0FBQ0osSUFBSTtBQUNKLElBQUk7QUFHSixJQUFNLGtCQUFrQixvQkFBSSxRQUF5RDtBQVFyRixJQUFNLGtCQUFrQjtBQUd4QixTQUFTLGNBQWMsS0FBc0I7QUFDekMsTUFBSSxDQUFDLE9BQU8sSUFBSSxXQUFXLE9BQU8sS0FBSyxJQUFJLFdBQVcsT0FBTyxFQUFHLFFBQU87QUFDdkUsU0FBTyxVQUFVLEtBQUssVUFBUSxJQUFJLFNBQVMsSUFBSSxDQUFDO0FBQ3BEO0FBY0EsU0FBUyxvQkFBb0IsS0FBNEI7QUFDckQsTUFBSSxDQUFDLFdBQVksUUFBTztBQUV4QixRQUFNLFVBQVUsaUNBQWlD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
