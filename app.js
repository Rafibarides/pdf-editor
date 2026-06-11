(function () {
  "use strict";

  /* ================================================
     Config
  ================================================ */
  const { PDFDocument, rgb, degrees, StandardFonts, grayscale } = PDFLib;

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  /* ================================================
     State
  ================================================ */
  let outputDirHandle = null;
  let signatureDataUrl = null;

  /* ================================================
     DOM Helpers
  ================================================ */
  const $ = (s, p) => (p || document).querySelector(s);
  const main = $("#main");

  /* ================================================
     Tool Definitions
  ================================================ */
  const TOOLS = [
    { id: "merge", icon: "layers", name: "Merge PDFs", desc: "Combine multiple PDFs into one document", accent: "blue" },
    { id: "compress", icon: "minimize-2", name: "Compress PDF", desc: "Reduce file size for easy sharing", accent: "pink" },
    { id: "split", icon: "scissors", name: "Split PDF", desc: "Divide a PDF into smaller parts", accent: "blue" },
    { id: "convert", icon: "file-up", name: "Convert to PDF", desc: "Turn images and documents into PDF", accent: "pink" },
    { id: "sign", icon: "pen-tool", name: "Sign PDF", desc: "Add your signature to a document", accent: "blue" },
    { id: "rotate", icon: "rotate-cw", name: "Rotate Pages", desc: "Change page orientation", accent: "pink" },
    { id: "extract", icon: "file-output", name: "Extract Pages", desc: "Pull specific pages from a PDF", accent: "blue" },
    { id: "reorder", icon: "arrow-down-up", name: "Reorder Pages", desc: "Drag and drop pages into a new order", accent: "pink" },
    { id: "watermark", icon: "droplets", name: "Add Watermark", desc: "Overlay text across every page", accent: "pink" },
    { id: "pagenums", icon: "hash", name: "Page Numbers", desc: "Add numbering to your pages", accent: "blue" },
    { id: "textbox", icon: "type", name: "Add Textbox", desc: "Place custom text anywhere on a page", accent: "pink" },
    { id: "imgconvert", icon: "repeat", name: "Image Converter", desc: "Convert images between JPG, PNG, and WEBP", accent: "blue" },
    { id: "imgresize", icon: "scaling", name: "Image Resize", desc: "Resize by width or set a file size limit", accent: "pink" },
    { id: "colorpicker", icon: "pipette", name: "Color Picker", desc: "Pick colors from any image and build a palette", accent: "blue" },
  ];

  const RENDERERS = {
    merge: renderMerge,
    split: renderSplit,
    convert: renderConvert,
    sign: renderSign,
    rotate: renderRotate,
    extract: renderExtract,
    reorder: renderReorder,
    watermark: renderWatermark,
    pagenums: renderPageNums,
    textbox: renderTextbox,
    imgconvert: renderImgConvert,
    imgresize: renderImgResize,
    colorpicker: renderColorPicker,
    compress: renderCompress,
  };

  const PDF_TOOL_IDS = new Set([
    "merge", "compress", "split", "sign", "rotate", "extract", "reorder",
    "watermark", "pagenums", "textbox",
  ]);
  const MULTI_PDF_TOOLS = new Set(["merge"]);

  let _initialToolFiles = null;
  function takeInitialFiles() {
    const f = _initialToolFiles;
    _initialToolFiles = null;
    return f;
  }
  function bootToolFiles(onFiles) {
    const init = takeInitialFiles();
    if (init?.length) onFiles(init);
  }

  /* ================================================
     Utilities
  ================================================ */
  function readFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.onerror = rej;
      r.readAsArrayBuffer(file);
    });
  }

  function readAsDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function dataUrlToBytes(url) {
    const b = atob(url.split(",")[1]);
    const a = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }

  function imgToCanvas(dataUrl) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        c.toBlob((blob) => blob.arrayBuffer().then((buf) => res(new Uint8Array(buf))), "image/png");
      };
      img.src = dataUrl;
    });
  }

  async function saveBlobAs(blob, filename) {
    if (outputDirHandle) {
      try {
        const fh = await outputDirHandle.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
        toast(`Saved: ${filename}`, "success");
        return;
      } catch (_) { /* fall through */ }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Downloaded: ${filename}`, "success");
  }

  async function savePdf(bytes, name) {
    await saveBlobAs(new Blob([bytes], { type: "application/pdf" }), name);
  }

  async function saveZip(zip, name) {
    const blob = await zip.generateAsync({ type: "blob" });
    await saveBlobAs(blob, name);
  }

  function toast(msg, type = "info") {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    $("#toast-container").appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 3000);
  }

  function showLoading(text) {
    $("#loading-text").textContent = text || "Processing\u2026";
    $("#loading-overlay").classList.remove("hidden");
  }
  function hideLoading() {
    $("#loading-overlay").classList.add("hidden");
  }

  const WINANSI_EXTRA = new Set([
    0x20AC,0x201A,0x0192,0x201E,0x2026,0x2020,0x2021,0x02C6,
    0x2030,0x0160,0x2039,0x0152,0x017D,0x2018,0x2019,0x201C,
    0x201D,0x2022,0x2013,0x2014,0x02DC,0x2122,0x0161,0x203A,
    0x0153,0x017E,0x0178,
  ]);
  const UNICODE_SUBS = {
    "\u2192":"->","\u2190":"<-","\u2191":"^","\u2193":"v",
    "\u21D2":"=>","\u21D0":"<=",
    "\u2713":"v","\u2714":"v","\u2717":"x","\u2718":"x",
    "\u25CF":"*","\u25CB":"o","\u25A0":"#","\u25A1":"[]",
    "\u2605":"*","\u2606":"*","\u2610":"[ ]","\u2611":"[x]","\u2612":"[x]",
    "\u2003":" ","\u2002":" ","\u2009":" ","\u200B":"",
    "\u00AD":"","\uFEFF":"",
  };
  function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  function sanitizeForPdf(str) {
    let out = "";
    for (const ch of str) {
      if (UNICODE_SUBS[ch] !== undefined) { out += UNICODE_SUBS[ch]; continue; }
      const c = ch.codePointAt(0);
      if (c >= 0x20 && c <= 0x7E) { out += ch; continue; }
      if (c >= 0xA0 && c <= 0xFF) { out += ch; continue; }
      if (c === 0x0A || c === 0x0D || c === 0x09) { out += ch; continue; }
      if (WINANSI_EXTRA.has(c)) { out += ch; continue; }
      out += " ";
    }
    return out;
  }

  function parsePageRange(str, max) {
    const pages = new Set();
    str.split(",").map((s) => s.trim()).filter(Boolean).forEach((part) => {
      if (part.includes("-")) {
        const [a, b] = part.split("-").map(Number);
        for (let i = a; i <= Math.min(b, max); i++) if (i >= 1) pages.add(i - 1);
      } else {
        const n = parseInt(part, 10);
        if (n >= 1 && n <= max) pages.add(n - 1);
      }
    });
    return [...pages].sort((a, b) => a - b);
  }

  /* ================================================
     Shared Components
  ================================================ */
  function makeDropZone(opts = {}) {
    const { accept = "*", multiple = false, label = "Drop files here or click to browse", hint = "" } = opts;
    const z = document.createElement("div");
    z.className = "drop-zone";
    z.innerHTML = `
      <div class="drop-zone-icon"><i data-lucide="upload-cloud"></i></div>
      <p class="drop-zone-label">${label}</p>
      ${hint ? `<p class="drop-zone-hint">${hint}</p>` : ""}
      <input type="file" accept="${accept}" ${multiple ? "multiple" : ""}>`;
    const input = $("input", z);
    z.addEventListener("click", () => input.click());
    z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("drag-over"); });
    z.addEventListener("dragleave", () => z.classList.remove("drag-over"));
    z.addEventListener("drop", (e) => {
      e.preventDefault();
      z.classList.remove("drag-over");
      if (e.dataTransfer.files.length && opts.onFiles) opts.onFiles([...e.dataTransfer.files]);
    });
    input.addEventListener("change", () => { if (input.files.length && opts.onFiles) opts.onFiles([...input.files]); input.value = ""; });
    return z;
  }

  function makeOutputSel() {
    const w = document.createElement("div");
    w.className = "output-sel";
    if ("showDirectoryPicker" in window) {
      w.innerHTML = `<button class="btn btn-outline"><i data-lucide="folder-open"></i><span>Output folder</span></button><span class="output-sel-hint">or saves to Downloads</span>`;
      $("button", w).addEventListener("click", async () => {
        try {
          outputDirHandle = await window.showDirectoryPicker();
          $("span", $("button", w)).textContent = outputDirHandle.name;
          $(".output-sel-hint", w).textContent = "";
          toast("Output folder set", "success");
        } catch (_) { /* cancelled */ }
      });
    } else {
      w.innerHTML = `<span>Files save to Downloads</span>`;
    }
    return w;
  }

  function makeOutputName(defaultName) {
    const w = document.createElement("div");
    w.className = "output-name";
    w.innerHTML = `<label for="oname"><i data-lucide="file-edit"></i>Output filename</label><input type="text" id="oname" class="input" value="${defaultName}" placeholder="${defaultName}">`;
    return w;
  }

  function getOutputName(el, fallback) {
    const inp = $("#oname", el);
    const val = inp ? inp.value.trim() : "";
    return val || fallback;
  }

  /* ================================================
     Navigation
  ================================================ */
  function navigate(toolId) {
    if (!toolId) {
      showHome();
    } else {
      showTool(toolId);
    }
  }

  function showHome() {
    $("#breadcrumb").classList.add("hidden");
    main.innerHTML = `
      <div class="home-start">
        <h2 class="home-start-title">Start with a pdf</h2>
        <div id="home-dz" class="drop-zone drop-zone-hero">
          <div class="drop-zone-icon"><i data-lucide="upload-cloud"></i></div>
          <p class="drop-zone-label">Drop your PDF here, or click to choose a file</p>
          <input type="file" accept=".pdf" multiple>
        </div>
      </div>
      <p class="home-or">Or pick a tool first\u2026</p>
      <div class="tool-grid">${TOOLS.map((t) => `
        <button class="tool-card" data-tool="${t.id}" data-accent="${t.accent}">
          <div class="tool-card-icon"><i data-lucide="${t.icon}"></i></div>
          <h3>${t.name}</h3>
          <p>${t.desc}</p>
        </button>`).join("")}
      </div>`;

    const homeDz = $("#home-dz", main);
    const homeInput = $("input", homeDz);
    function openWorkbench(files) {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length) { toast("Choose a PDF file", "error"); return; }
      showWorkbench(pdfs);
    }
    homeDz.addEventListener("click", () => homeInput.click());
    homeDz.addEventListener("dragover", (e) => { e.preventDefault(); homeDz.classList.add("drag-over"); });
    homeDz.addEventListener("dragleave", () => homeDz.classList.remove("drag-over"));
    homeDz.addEventListener("drop", (e) => {
      e.preventDefault();
      homeDz.classList.remove("drag-over");
      if (e.dataTransfer.files.length) openWorkbench([...e.dataTransfer.files]);
    });
    homeInput.addEventListener("change", () => {
      if (homeInput.files.length) openWorkbench([...homeInput.files]);
      homeInput.value = "";
    });

    main.querySelectorAll(".tool-card").forEach((c) => {
      c.addEventListener("click", () => navigate(c.dataset.tool));
      c.addEventListener("dragover", (e) => { e.preventDefault(); c.classList.add("drag-over"); });
      c.addEventListener("dragleave", () => c.classList.remove("drag-over"));
      c.addEventListener("drop", (e) => {
        e.preventDefault();
        c.classList.remove("drag-over");
        if (!e.dataTransfer.files.length) return;
        const toolId = c.dataset.tool;
        const files = [...e.dataTransfer.files];
        if (PDF_TOOL_IDS.has(toolId)) {
          const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
          if (!pdfs.length) { toast("Drop a PDF file", "error"); return; }
          if (MULTI_PDF_TOOLS.has(toolId)) showTool(toolId, pdfs);
          else if (pdfs.length > 1) { toast("One PDF at a time for this tool", "error"); return; }
          else showTool(toolId, [pdfs[0]]);
        } else {
          showTool(toolId, files);
        }
      });
    });
    lucide.createIcons();
  }

  function showWorkbench(initialFiles, startMode) {
    const bc = $("#breadcrumb");
    bc.classList.remove("hidden");
    bc.innerHTML = `<a href="#" id="bc-home">Tools</a><i data-lucide="chevron-right"></i><span class="breadcrumb-current">Edit PDF</span>`;
    $("#bc-home").addEventListener("click", (e) => { e.preventDefault(); showHome(); });
    main.innerHTML = `<div class="tool-view" id="tv"></div>`;
    renderWorkbench($("#tv"), initialFiles || null, startMode || "browse");
    lucide.createIcons();
  }

  function showTool(id, files) {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) return;
    _initialToolFiles = files || null;
    const bc = $("#breadcrumb");
    bc.classList.remove("hidden");
    bc.innerHTML = `<a href="#" id="bc-home">Tools</a><i data-lucide="chevron-right"></i><span class="breadcrumb-current">${tool.name}</span>`;
    $("#bc-home").addEventListener("click", (e) => { e.preventDefault(); showHome(); });
    main.innerHTML = `<div class="tool-view" id="tv"></div>`;
    if (RENDERERS[id]) RENDERERS[id]($("#tv"));
    lucide.createIcons();
  }

  /* ================================================
     Tool: Merge PDFs
  ================================================ */
  function renderMerge(el) {
    let files = [];
    el.innerHTML = `
      <div class="tool-head"><h2>Merge PDFs</h2><p>Combine multiple PDF files into one. Drag items to reorder.</p></div>
      <div id="dz"></div>
      <div id="flist" class="file-list"></div>
      <div class="form-group mt-1">
        <label for="psize">Page size</label>
        <div class="select-wrap"><select id="psize" class="input">
          <option value="original">Keep each page's original size (mixed dimensions)</option>
          <option value="first">Match first PDF's first page</option>
          <option value="largest">Match the largest page across all PDFs</option>
          <option value="a4p">A4 Portrait (210 \u00d7 297 mm)</option>
          <option value="a4l">A4 Landscape (297 \u00d7 210 mm)</option>
          <option value="letterp">US Letter Portrait (8.5 \u00d7 11 in)</option>
          <option value="letterl">US Letter Landscape (11 \u00d7 8.5 in)</option>
        </select></div>
        <p class="info-hint">Choose a uniform size to fix funky viewing from mixed orientations and resolutions. Pages are scaled to fit and centered.</p>
      </div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="layers"></i>Merge</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", multiple: true, label: "Drop PDFs here or click to browse", hint: ".pdf files", onFiles: (f) => { files = files.concat(f.filter((x) => x.name.endsWith(".pdf"))); renderList(); } }));
    $("#out", el).appendChild(makeOutputSel());
    $("#oname-wrap", el).appendChild(makeOutputName("merged.pdf"));
    lucide.createIcons();

    function renderList() {
      const fl = $("#flist", el);
      $("#go", el).disabled = files.length < 2;
      if (!files.length) { fl.innerHTML = ""; return; }
      fl.innerHTML = files.map((f, i) => `
        <div class="file-item" draggable="true" data-i="${i}">
          <span class="file-grip"><i data-lucide="grip-vertical"></i></span>
          <span class="file-icon"><i data-lucide="file-text"></i></span>
          <span class="file-name">${f.name}</span>
          <span class="file-size">${(f.size / 1024).toFixed(0)} KB</span>
          <span class="file-reorder">
            <button class="file-move" data-dir="up" data-i="${i}" ${i === 0 ? "disabled" : ""}><i data-lucide="chevron-up"></i></button>
            <button class="file-move" data-dir="down" data-i="${i}" ${i === files.length - 1 ? "disabled" : ""}><i data-lucide="chevron-down"></i></button>
          </span>
          <button class="file-remove" data-i="${i}"><i data-lucide="x"></i></button>
        </div>`).join("");

      fl.querySelectorAll(".file-remove").forEach((b) =>
        b.addEventListener("click", () => { files.splice(+b.dataset.i, 1); renderList(); })
      );

      fl.querySelectorAll(".file-move").forEach((b) =>
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const i = +b.dataset.i;
          const dir = b.dataset.dir;
          if (dir === "up" && i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; renderList(); }
          if (dir === "down" && i < files.length - 1) { [files[i], files[i + 1]] = [files[i + 1], files[i]]; renderList(); }
        })
      );

      let dragI = null;
      fl.querySelectorAll(".file-item").forEach((item) => {
        item.addEventListener("dragstart", (e) => { dragI = +item.dataset.i; item.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
        item.addEventListener("dragend", () => item.classList.remove("dragging"));
        item.addEventListener("dragover", (e) => { e.preventDefault(); item.classList.add("drag-target"); });
        item.addEventListener("dragleave", () => item.classList.remove("drag-target"));
        item.addEventListener("drop", (e) => {
          e.preventDefault(); item.classList.remove("drag-target");
          const j = +item.dataset.i;
          if (dragI !== null && dragI !== j) { const [m] = files.splice(dragI, 1); files.splice(j, 0, m); renderList(); }
        });
      });

      /* Touch-based reordering */
      let touchDragI = null, touchClone = null, touchTargetI = null;
      fl.querySelectorAll(".file-grip").forEach((grip) => {
        grip.addEventListener("touchstart", (e) => {
          e.preventDefault();
          const item = grip.closest(".file-item");
          touchDragI = +item.dataset.i;
          touchTargetI = null;
          item.classList.add("dragging");

          touchClone = item.cloneNode(true);
          touchClone.classList.add("file-item-ghost");
          const rect = item.getBoundingClientRect();
          touchClone.style.width = rect.width + "px";
          touchClone.style.left = rect.left + "px";
          touchClone.style.top = rect.top + "px";
          document.body.appendChild(touchClone);
        }, { passive: false });
      });

      fl.addEventListener("touchmove", (e) => {
        if (touchDragI === null) return;
        e.preventDefault();
        const touch = e.touches[0];
        if (touchClone) touchClone.style.top = (touch.clientY - 20) + "px";

        fl.querySelectorAll(".file-item").forEach((it) => it.classList.remove("drag-target"));
        touchTargetI = null;
        if (touchClone) touchClone.style.pointerEvents = "none";
        const hit = document.elementFromPoint(touch.clientX, touch.clientY);
        if (touchClone) touchClone.style.pointerEvents = "";
        if (hit) {
          const fi = hit.closest(".file-item");
          if (fi && +fi.dataset.i !== touchDragI) {
            fi.classList.add("drag-target");
            touchTargetI = +fi.dataset.i;
          }
        }
      }, { passive: false });

      const touchEnd = () => {
        if (touchDragI === null) return;
        if (touchClone) { touchClone.remove(); touchClone = null; }
        fl.querySelectorAll(".file-item").forEach((it) => it.classList.remove("dragging", "drag-target"));
        if (touchTargetI !== null && touchTargetI !== touchDragI) {
          const [m] = files.splice(touchDragI, 1);
          files.splice(touchTargetI, 0, m);
        }
        touchDragI = null;
        touchTargetI = null;
        renderList();
      };
      fl.addEventListener("touchend", touchEnd, { passive: false });
      fl.addEventListener("touchcancel", touchEnd, { passive: false });

      lucide.createIcons();
    }

    const _initMerge = takeInitialFiles();
    if (_initMerge?.length) {
      files = files.concat(_initMerge.filter((x) => x.name.toLowerCase().endsWith(".pdf")));
      renderList();
    }

    $("#go", el).addEventListener("click", async () => {
      if (files.length < 2) return;
      const sizeMode = $("#psize", el).value;
      showLoading("Merging PDFs\u2026");
      try {
        const merged = await PDFDocument.create();

        if (sizeMode === "original") {
          for (const f of files) {
            const src = await PDFDocument.load(await readFile(f));
            (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
          }
        } else {
          /* Load all source docs first so we can compute target dimensions */
          const srcs = [];
          for (const f of files) {
            srcs.push(await PDFDocument.load(await readFile(f)));
          }

          const [targetW, targetH] = resolveTargetPageSize(sizeMode, srcs);

          let pageCounter = 0;
          let totalPages = 0;
          srcs.forEach((s) => { totalPages += s.getPageCount(); });

          for (const src of srcs) {
            for (const srcPage of src.getPages()) {
              pageCounter++;
              $("#loading-text").textContent = `Merging page ${pageCounter} / ${totalPages}\u2026`;
              const ep = await merged.embedPage(srcPage);
              const newPage = merged.addPage([targetW, targetH]);
              drawEmbeddedPageFit(newPage, ep, srcPage.getRotation().angle, targetW, targetH);
            }
          }
        }

        const outName = getOutputName(el, "merged.pdf");
        await savePdf(await merged.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
  }

  /* ================================================
     Helpers for uniform-size merge
  ================================================ */
  function resolveTargetPageSize(mode, srcs) {
    const PRESETS = {
      a4p:     [595.28, 841.89],
      a4l:     [841.89, 595.28],
      letterp: [612,    792],
      letterl: [792,    612],
    };
    if (PRESETS[mode]) return PRESETS[mode];

    if (mode === "first") {
      const p = srcs[0].getPage(0);
      const angle = ((p.getRotation().angle % 360) + 360) % 360;
      const { width, height } = p.getSize();
      return angle === 90 || angle === 270 ? [height, width] : [width, height];
    }

    /* largest by visible area */
    let bestW = 0, bestH = 0, bestArea = 0;
    for (const src of srcs) {
      for (const p of src.getPages()) {
        const angle = ((p.getRotation().angle % 360) + 360) % 360;
        const { width, height } = p.getSize();
        const w = angle === 90 || angle === 270 ? height : width;
        const h = angle === 90 || angle === 270 ? width  : height;
        const area = w * h;
        if (area > bestArea) { bestArea = area; bestW = w; bestH = h; }
      }
    }
    return [bestW || 595.28, bestH || 841.89];
  }

  /* Draws an embedded page scaled to fit, centered, with rotation preserved */
  function drawEmbeddedPageFit(page, ep, srcRotation, boxW, boxH) {
    const angle = ((srcRotation % 360) + 360) % 360;
    const rotated = angle === 90 || angle === 270;
    const natW = ep.width;
    const natH = ep.height;
    const visW = rotated ? natH : natW;
    const visH = rotated ? natW : natH;
    const scale = Math.min(boxW / visW, boxH / visH);
    const drawVisW = visW * scale;
    const drawVisH = visH * scale;
    const offX = (boxW - drawVisW) / 2;
    const offY = (boxH - drawVisH) / 2;
    const sw = natW * scale;
    const sh = natH * scale;

    let x = offX, y = offY;
    if (angle === 90)       { x = offX + drawVisW; y = offY; }
    else if (angle === 180) { x = offX + drawVisW; y = offY + drawVisH; }
    else if (angle === 270) { x = offX;            y = offY + drawVisH; }

    page.drawPage(ep, {
      x, y,
      width: sw,
      height: sh,
      rotate: degrees(angle),
    });
  }

  /* ================================================
     Tool: Split PDF
  ================================================ */
  function renderSplit(el) {
    let file = null, total = 0;
    el.innerHTML = `
      <div class="tool-head"><h2>Split PDF</h2><p>Divide a PDF into smaller files with a set number of pages each.</p></div>
      <div id="dz"></div>
      <div id="info" class="info-panel hidden">
        <div class="info-row"><span>File</span><span id="fname"></span></div>
        <div class="info-row"><span>Total pages</span><span id="pcount"></span></div>
        <div class="form-group mt-1"><label for="ppp">Pages per part</label><input type="number" id="ppp" class="input" min="1" value="1"></div>
        <div id="preview" class="info-hint"></div>
      </div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="scissors"></i>Split</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", hint: ".pdf", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0];
      showLoading("Reading PDF\u2026");
      try {
        const pdf = await PDFDocument.load(await readFile(file));
        total = pdf.getPageCount();
        $("#fname", el).textContent = file.name;
        $("#pcount", el).textContent = total;
        $("#info", el).classList.remove("hidden");
        $("#go", el).disabled = false;
        const base = file.name.replace(/\.pdf$/i, "");
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(`${base}_split.zip`));
        lucide.createIcons();
        updatePreview();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    function updatePreview() {
      const ppp = Math.max(1, parseInt($("#ppp", el).value) || 1);
      const parts = Math.ceil(total / ppp);
      const last = total % ppp || ppp;
      $("#preview", el).textContent = `Creates ${parts} file${parts > 1 ? "s" : ""}` + (parts > 1 ? ` \u2014 last file has ${last} page${last > 1 ? "s" : ""}` : "");
    }

    $("#ppp", el).addEventListener("input", updatePreview);

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      const ppp = Math.max(1, parseInt($("#ppp", el).value) || 1);
      showLoading("Splitting PDF\u2026");
      try {
        const src = await PDFDocument.load(await readFile(file));
        const n = src.getPageCount();
        const parts = Math.ceil(n / ppp);
        const pad = String(parts).length;
        const base = file.name.replace(/\.pdf$/i, "");
        const zip = new JSZip();
        for (let i = 0; i < parts; i++) {
          const indices = [];
          for (let p = i * ppp; p < Math.min((i + 1) * ppp, n); p++) indices.push(p);
          const doc = await PDFDocument.create();
          (await doc.copyPages(src, indices)).forEach((pg) => doc.addPage(pg));
          zip.file(`${base}_${String(i + 1).padStart(pad, "0")}.pdf`, await doc.save());
        }
        const outName = getOutputName(el, `${base}_split.zip`);
        await saveZip(zip, outName.endsWith(".zip") ? outName : outName + ".zip");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Convert to PDF
  ================================================ */
  function renderConvert(el) {
    let files = [], srcType = "image";
    el.innerHTML = `
      <div class="tool-head"><h2>Convert to PDF</h2><p>Turn images, text, and Word documents into PDF files.</p></div>
      <div class="form-group"><label>Source type</label>
        <div class="select-wrap"><select id="stype" class="input">
          <option value="image">Images (JPG, PNG, GIF, WEBP, BMP)</option>
          <option value="text">Text files (TXT, CSV)</option>
          <option value="word">Word Documents (DOCX)</option>
        </select></div>
      </div>
      <div id="dz"></div>
      <div id="finfo" class="info-panel hidden"><span id="fcnt"></span></div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="file-up"></i>Convert</button></div>`;
    $("#out", el).appendChild(makeOutputSel());

    function accepts() {
      if (srcType === "image") return ".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg";
      if (srcType === "word") return ".docx";
      return ".txt,.csv";
    }

    const DZ_LABELS = { image: "Drop images here", text: "Drop a text file here", word: "Drop a Word document here" };

    function loadConvertFiles(f) {
      files = f;
      $("#finfo", el).classList.remove("hidden");
      $("#fcnt", el).textContent = `${f.length} file${f.length > 1 ? "s" : ""} selected`;
      $("#go", el).disabled = false;
      const defaultName = srcType === "image"
        ? (f.length === 1 ? f[0].name.replace(/\.[^.]+$/, "") + ".pdf" : "images.pdf")
        : f[0].name.replace(/\.[^.]+$/, "") + ".pdf";
      const wrap = $("#oname-wrap", el);
      wrap.innerHTML = "";
      wrap.appendChild(makeOutputName(defaultName));
      lucide.createIcons();
    }

    function buildDZ() {
      const dz = $("#dz", el);
      dz.innerHTML = "";
      files = [];
      $("#finfo", el).classList.add("hidden");
      $("#go", el).disabled = true;
      dz.appendChild(makeDropZone({
        accept: accepts(), multiple: srcType === "image",
        label: DZ_LABELS[srcType],
        onFiles: loadConvertFiles,
      }));
      lucide.createIcons();
    }

    $("#stype", el).addEventListener("change", (e) => { srcType = e.target.value; buildDZ(); });
    buildDZ();

    const _initConvert = takeInitialFiles();
    if (_initConvert?.length) {
      const n = _initConvert[0].name.toLowerCase();
      if (n.endsWith(".docx")) { srcType = "word"; $("#stype", el).value = "word"; buildDZ(); }
      else if (/\.(txt|csv)$/.test(n)) { srcType = "text"; $("#stype", el).value = "text"; buildDZ(); }
      else { srcType = "image"; $("#stype", el).value = "image"; buildDZ(); }
      loadConvertFiles(_initConvert);
    }

    $("#go", el).addEventListener("click", async () => {
      if (!files.length) return;
      showLoading("Converting\u2026");
      try {
        const defaultName = srcType === "image"
          ? (files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") + ".pdf" : "images.pdf")
          : files[0].name.replace(/\.[^.]+$/, "") + ".pdf";
        const outName = getOutputName(el, defaultName);
        const finalName = outName.endsWith(".pdf") ? outName : outName + ".pdf";
        if (srcType === "image") await convertImages(files, finalName);
        else if (srcType === "word") await convertWord(files[0], finalName);
        else await convertText(files[0], finalName);
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    lucide.createIcons();
  }

  async function convertImages(imgs, outName) {
    const doc = await PDFDocument.create();
    for (const f of imgs) {
      const bytes = await readFile(f);
      let img;
      if (/jpe?g$/i.test(f.name)) img = await doc.embedJpg(bytes);
      else if (/png$/i.test(f.name)) img = await doc.embedPng(bytes);
      else { const png = await imgToCanvas(await readAsDataURL(f)); img = await doc.embedPng(png); }
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    await savePdf(await doc.save(), outName);
  }

  async function convertText(file, outName) {
    const text = await file.text();
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sz = 11, margin = 50, pw = 595.28, ph = 841.89;
    const maxW = pw - 2 * margin, lh = sz * 1.5;
    const maxLines = Math.floor((ph - 2 * margin) / lh);
    const lines = [];
    for (const raw of text.split("\n")) {
      if (!raw.trim()) { lines.push(""); continue; }
      let cur = "";
      for (const w of raw.split(" ")) {
        const test = cur ? cur + " " + w : w;
        if (font.widthOfTextAtSize(test, sz) > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
      }
      if (cur) lines.push(cur);
    }
    for (let i = 0; i < lines.length; i += maxLines) {
      const pg = doc.addPage([pw, ph]);
      lines.slice(i, i + maxLines).forEach((ln, idx) => {
        if (ln) pg.drawText(ln, { x: margin, y: ph - margin - idx * lh, size: sz, font, color: rgb(0.1, 0.1, 0.1) });
      });
    }
    await savePdf(await doc.save(), outName);
  }

  async function convertWord(file, outName) {
    const ab = await file.arrayBuffer();
    const result = await mammoth.convertToHtml(
      { arrayBuffer: ab },
      {
        convertImage: mammoth.images.imgElement(function (image) {
          return image.read("base64").then(function (buf) {
            return { src: "data:" + image.contentType + ";base64," + buf };
          });
        }),
      }
    );

    const html = result.value;
    const dom = new DOMParser().parseFromString(html, "text/html");

    const doc = await PDFDocument.create();
    const fReg = await doc.embedFont(StandardFonts.Helvetica);
    const fBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const fIt = await doc.embedFont(StandardFonts.HelveticaOblique);
    const fBI = await doc.embedFont(StandardFonts.HelveticaBoldOblique);

    function pickFont(b, i) {
      if (b && i) return fBI;
      if (b) return fBold;
      if (i) return fIt;
      return fReg;
    }

    const pw = 595.28, ph = 841.89, mg = 50;
    const maxW = pw - 2 * mg;
    const clr = rgb(0.1, 0.1, 0.1);

    let page = doc.addPage([pw, ph]);
    let y = ph - mg;

    function needPage(h) {
      if (y - h < mg) { page = doc.addPage([pw, ph]); y = ph - mg; }
    }

    function extractRuns(node, bold, italic) {
      const runs = [];
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) {
          const t = sanitizeForPdf(ch.textContent);
          if (t) runs.push({ t, b: bold, i: italic });
        } else if (ch.nodeType === 1) {
          const tag = ch.tagName.toLowerCase();
          if (["ul", "ol", "table", "div", "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "img"].includes(tag)) continue;
          if (tag === "br") { runs.push({ t: "\n", b: bold, i: italic }); continue; }
          const nb = bold || tag === "strong" || tag === "b";
          const ni = italic || tag === "em" || tag === "i";
          runs.push(...extractRuns(ch, nb, ni));
        }
      }
      return runs;
    }

    function wrapRuns(runs, fontSize, width) {
      const words = [];
      for (const r of runs) {
        if (r.t === "\n") { words.push({ br: true }); continue; }
        const f = pickFont(r.b, r.i);
        for (const p of r.t.split(/\s+/)) {
          if (p) words.push({ t: p, f, sz: fontSize });
        }
      }
      const lines = [[]];
      let lw = 0;
      const spW = fReg.widthOfTextAtSize(" ", fontSize);
      for (const w of words) {
        if (w.br) { lines.push([]); lw = 0; continue; }
        const ww = w.f.widthOfTextAtSize(w.t, w.sz);
        if (lines[lines.length - 1].length && lw + spW + ww > width) {
          lines.push([w]); lw = ww;
        } else {
          if (lines[lines.length - 1].length) lw += spW;
          lines[lines.length - 1].push(w); lw += ww;
        }
      }
      return lines;
    }

    function drawLine(words, x, yPos, fontSize) {
      const spW = fReg.widthOfTextAtSize(" ", fontSize);
      let cx = x;
      for (let i = 0; i < words.length; i++) {
        if (i > 0) cx += spW;
        page.drawText(words[i].t, { x: cx, y: yPos, size: words[i].sz, font: words[i].f, color: clr });
        cx += words[i].f.widthOfTextAtSize(words[i].t, words[i].sz);
      }
    }

    function renderBlock(runs, fontSize, indent, spaceBefore, spaceAfter) {
      y -= spaceBefore;
      const lh = fontSize * 1.4;
      const lines = wrapRuns(runs, fontSize, maxW - indent);
      for (const line of lines) {
        needPage(lh);
        y -= lh;
        if (line.length) drawLine(line, mg + indent, y, fontSize);
      }
      y -= spaceAfter;
    }

    async function renderImg(src) {
      if (!src || !src.startsWith("data:")) return;
      try {
        const bytes = dataUrlToBytes(src);
        let img;
        if (/image\/jpe?g/.test(src)) img = await doc.embedJpg(bytes);
        else if (/image\/png/.test(src)) img = await doc.embedPng(bytes);
        else { img = await doc.embedPng(await imgToCanvas(src)); }
        let w = img.width, h = img.height;
        if (w > maxW) { h *= maxW / w; w = maxW; }
        const mxH = ph - 2 * mg;
        if (h > mxH) { w *= mxH / h; h = mxH; }
        needPage(h + 10);
        y -= h;
        page.drawImage(img, { x: mg, y, width: w, height: h });
        y -= 10;
      } catch (_) { /* skip unembeddable images */ }
    }

    const H_SZ = { h1: 24, h2: 20, h3: 16, h4: 14, h5: 12, h6: 11 };

    async function processEl(el, indent) {
      const tag = el.tagName?.toLowerCase();
      if (!tag) return;

      if (H_SZ[tag]) {
        const sz = H_SZ[tag];
        const runs = extractRuns(el, true, false);
        if (runs.some((r) => r.t.trim())) renderBlock(runs, sz, indent, sz * 0.5, sz * 0.3);
      } else if (tag === "p") {
        const imgEl = el.querySelector("img");
        if (imgEl) await renderImg(imgEl.getAttribute("src"));
        const runs = extractRuns(el, false, false);
        if (runs.some((r) => r.t.trim())) {
          renderBlock(runs, 11, indent, 2, 6);
        } else if (!imgEl) {
          y -= 11;
        }
      } else if (tag === "ul" || tag === "ol") {
        let counter = 0;
        for (const li of el.children) {
          if (li.tagName?.toLowerCase() !== "li") continue;
          counter++;
          const prefix = tag === "ul" ? "\u2022  " : counter + ". ";
          const runs = extractRuns(li, false, false);
          runs.unshift({ t: prefix, b: false, i: false });
          renderBlock(runs, 11, indent + 18, 1, 3);
          for (const child of li.children) {
            const ct = child.tagName?.toLowerCase();
            if (ct === "ul" || ct === "ol") await processEl(child, indent + 18);
          }
        }
        y -= 4;
      } else if (tag === "table") {
        for (const row of el.querySelectorAll("tr")) {
          const cells = [...row.querySelectorAll("td, th")];
          const isHead = cells[0]?.tagName?.toLowerCase() === "th";
          const text = sanitizeForPdf(cells.map((c) => c.textContent.trim()).join("    "));
          if (text) renderBlock([{ t: text, b: isHead, i: false }], 10, indent, 1, 1);
        }
        y -= 6;
      } else if (tag === "img") {
        await renderImg(el.getAttribute("src"));
      } else {
        for (const child of el.children) {
          await processEl(child, indent);
        }
      }
    }

    for (const child of dom.body.children) {
      await processEl(child, 0);
    }

    await savePdf(await doc.save(), outName);
  }

  /* ================================================
     Tool: Sign PDF
  ================================================ */
  function renderSign(el) {
    let pdfFile = null, pdfJsDoc = null, currentPage = 0, totalPages = 0;
    let sigPos = { x: 60, y: 60, w: 200, h: 70 };
    const SCALE = 1.5;

    el.innerHTML = `
      <div class="tool-head"><h2>Sign PDF</h2><p>Draw or type your signature, then position it on any page.</p></div>
      <div id="dz"></div>
      <div id="ws" class="hidden">
        <div class="sign-toolbar">
          <div class="sig-btn-group">
            <button class="btn btn-secondary" id="drawBtn"><i data-lucide="pen-tool"></i>Draw</button>
            <button class="btn btn-secondary" id="typeBtn"><i data-lucide="type"></i>Type</button>
          </div>
          <div class="page-nav">
            <button class="btn-icon" id="prevP"><i data-lucide="chevron-left"></i></button>
            <span id="pgInd">1 / 1</span>
            <button class="btn-icon" id="nextP"><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
        <div id="typeSigPanel" class="sig-type-panel hidden">
          <input type="text" id="sigText" class="input" placeholder="Type your name\u2026" autocomplete="off">
          <div class="sig-font-options">
            <button class="sig-font-btn active" data-font="'Great Vibes', cursive">Elegant</button>
            <button class="sig-font-btn" data-font="'Dancing Script', cursive">Flowing</button>
            <button class="sig-font-btn" data-font="'Caveat', cursive">Casual</button>
          </div>
          <div class="sig-type-preview"><canvas id="sigTypeCanvas" height="70"></canvas></div>
          <button class="btn btn-primary" id="sigTypeUse" disabled>Use This Signature</button>
        </div>
        <div class="pdf-preview-wrap" id="pvw"><canvas id="pcanvas"></canvas><div id="sigOv" class="sig-overlay hidden"><img id="sigImg" src="" alt=""><div class="resize-h" id="sigRz"></div></div></div>
        <div id="oname-wrap" class="mt-1"></div>
        <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="apply" disabled><i data-lucide="check"></i>Apply &amp; Download</button></div>
      </div>`;

    const pvw = $("#pvw", el), canvas = $("#pcanvas", el), sigOv = $("#sigOv", el), sigImg = $("#sigImg", el);
    $("#out", el).appendChild(makeOutputSel());
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    lucide.createIcons();

    async function onFile(files) {
      pdfFile = files[0];
      showLoading("Loading PDF\u2026");
      try {
        pdfJsDoc = await pdfjsLib.getDocument({ data: await readFile(pdfFile) }).promise;
        totalPages = pdfJsDoc.numPages;
        currentPage = 0;
        $("#dz", el).classList.add("hidden");
        $("#ws", el).classList.remove("hidden");
        const defName = pdfFile.name.replace(/\.pdf$/i, "_signed.pdf");
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(defName));
        lucide.createIcons();
        await renderPg();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    async function renderPg() {
      const pg = await pdfJsDoc.getPage(currentPage + 1);
      const vp = pg.getViewport({ scale: SCALE });
      canvas.width = vp.width;
      canvas.height = vp.height;
      await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      $("#pgInd", el).textContent = `${currentPage + 1} / ${totalPages}`;
      $("#prevP", el).disabled = currentPage === 0;
      $("#nextP", el).disabled = currentPage === totalPages - 1;
    }

    $("#prevP", el).addEventListener("click", async () => { if (currentPage > 0) { currentPage--; await renderPg(); } });
    $("#nextP", el).addEventListener("click", async () => { if (currentPage < totalPages - 1) { currentPage++; await renderPg(); } });

    /* --- Signature draw modal --- */
    let sigController = null;
    $("#drawBtn", el).addEventListener("click", () => {
      const modal = $("#sig-modal");
      const cv = $("#sig-canvas");
      const ctx = cv.getContext("2d");
      if (sigController) sigController.abort();
      sigController = new AbortController();
      const sig = sigController.signal;
      ctx.clearRect(0, 0, cv.width, cv.height);
      let drawing = false;

      function pos(e) {
        const r = cv.getBoundingClientRect();
        const t = e.touches ? e.touches[0] : e;
        return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
      }

      cv.addEventListener("mousedown", (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { signal: sig });
      cv.addEventListener("mousemove", (e) => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); }, { signal: sig });
      cv.addEventListener("mouseup", () => { drawing = false; }, { signal: sig });
      cv.addEventListener("mouseleave", () => { drawing = false; }, { signal: sig });
      cv.addEventListener("touchstart", (e) => { e.preventDefault(); drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { signal: sig, passive: false });
      cv.addEventListener("touchmove", (e) => { e.preventDefault(); if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.strokeStyle = "#1E293B"; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); }, { signal: sig, passive: false });
      cv.addEventListener("touchend", (e) => { e.preventDefault(); drawing = false; }, { signal: sig, passive: false });

      modal.classList.remove("hidden");

      $("#sig-clear").onclick = () => ctx.clearRect(0, 0, cv.width, cv.height);
      $("#sig-save").onclick = () => {
        signatureDataUrl = cv.toDataURL("image/png");
        modal.classList.add("hidden");
        sigImg.src = signatureDataUrl;
        sigOv.classList.remove("hidden");
        Object.assign(sigOv.style, { left: sigPos.x + "px", top: sigPos.y + "px", width: sigPos.w + "px", height: sigPos.h + "px" });
        $("#apply", el).disabled = false;
        toast("Signature ready \u2014 drag to position", "success");
      };
      $("#sig-modal-close").onclick = () => modal.classList.add("hidden");
    });

    /* --- Type signature panel --- */
    let typedFont = "'Great Vibes', cursive";
    const typePanel = $("#typeSigPanel", el);
    const sigTextInput = $("#sigText", el);
    const sigTypeCanvas = $("#sigTypeCanvas", el);
    const sigTypeCtx = sigTypeCanvas.getContext("2d");

    $("#typeBtn", el).addEventListener("click", () => {
      typePanel.classList.toggle("hidden");
    });

    function renderTypedPreview() {
      const text = sigTextInput.value.trim();
      sigTypeCanvas.width = sigTypeCanvas.parentElement.clientWidth || 400;
      sigTypeCtx.clearRect(0, 0, sigTypeCanvas.width, sigTypeCanvas.height);
      $("#sigTypeUse", el).disabled = !text;
      if (!text) return;
      const fontSize = 48;
      sigTypeCtx.font = `${fontSize}px ${typedFont}`;
      sigTypeCtx.fillStyle = "#1E293B";
      sigTypeCtx.textBaseline = "middle";
      sigTypeCtx.fillText(text, 12, sigTypeCanvas.height / 2);
    }

    sigTextInput.addEventListener("input", renderTypedPreview);

    typePanel.querySelectorAll(".sig-font-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        typePanel.querySelectorAll(".sig-font-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        typedFont = btn.dataset.font;
        renderTypedPreview();
      });
    });

    $("#sigTypeUse", el).addEventListener("click", () => {
      const text = sigTextInput.value.trim();
      if (!text) return;
      const fontSize = 64;
      const c = document.createElement("canvas");
      const ctx2 = c.getContext("2d");
      ctx2.font = `${fontSize}px ${typedFont}`;
      const metrics = ctx2.measureText(text);
      const w = Math.ceil(metrics.width) + 24;
      const h = Math.ceil(fontSize * 1.6);
      c.width = w; c.height = h;
      ctx2.font = `${fontSize}px ${typedFont}`;
      ctx2.fillStyle = "#1E293B";
      ctx2.textBaseline = "middle";
      ctx2.fillText(text, 12, h / 2);

      signatureDataUrl = c.toDataURL("image/png");
      typePanel.classList.add("hidden");
      sigImg.src = signatureDataUrl;
      sigOv.classList.remove("hidden");
      sigPos.w = Math.min(w * 0.6, pvw.clientWidth * 0.4);
      sigPos.h = sigPos.w * (h / w);
      Object.assign(sigOv.style, { left: sigPos.x + "px", top: sigPos.y + "px", width: sigPos.w + "px", height: sigPos.h + "px" });
      $("#apply", el).disabled = false;
      toast("Signature ready \u2014 drag to position", "success");
    });

    /* --- Drag & resize signature overlay (mouse + touch) --- */
    let dragging = false, resizing = false, dOff = {}, rStart = {};

    function getPointer(e) {
      if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function startDrag(e) {
      if (e.target.id === "sigRz") return;
      dragging = true;
      const ptr = getPointer(e);
      const r = sigOv.getBoundingClientRect();
      dOff = { x: ptr.x - r.left, y: ptr.y - r.top };
      e.preventDefault();
    }

    function startResize(e) {
      resizing = true;
      const ptr = getPointer(e);
      rStart = { x: ptr.x, w: sigOv.offsetWidth, h: sigOv.offsetHeight };
      e.stopPropagation();
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging && !resizing) return;
      e.preventDefault();
      const ptr = getPointer(e);
      if (dragging) {
        const cr = pvw.getBoundingClientRect();
        let x = ptr.x - cr.left - dOff.x, y = ptr.y - cr.top - dOff.y;
        x = Math.max(0, Math.min(x, pvw.clientWidth - sigOv.offsetWidth));
        y = Math.max(0, Math.min(y, pvw.clientHeight - sigOv.offsetHeight));
        sigOv.style.left = x + "px";
        sigOv.style.top = y + "px";
        sigPos.x = x; sigPos.y = y;
      }
      if (resizing) {
        const nw = Math.max(60, rStart.w + (ptr.x - rStart.x));
        const nh = nw * (rStart.h / rStart.w);
        sigOv.style.width = nw + "px";
        sigOv.style.height = nh + "px";
        sigPos.w = nw; sigPos.h = nh;
      }
    }

    function onPointerUp() { dragging = false; resizing = false; }

    sigOv.addEventListener("mousedown", startDrag);
    sigOv.addEventListener("touchstart", startDrag, { passive: false });

    const sigRz = $("#sigRz", el);
    sigRz.addEventListener("mousedown", startResize);
    sigRz.addEventListener("touchstart", startResize, { passive: false });

    document.addEventListener("mousemove", onPointerMove);
    document.addEventListener("touchmove", onPointerMove, { passive: false });
    document.addEventListener("mouseup", onPointerUp);
    document.addEventListener("touchend", onPointerUp);
    document.addEventListener("touchcancel", onPointerUp);

    /* --- Apply signature --- */
    $("#apply", el).addEventListener("click", async () => {
      if (!signatureDataUrl || !pdfFile) return;
      showLoading("Applying signature\u2026");
      try {
        const doc = await PDFDocument.load(await readFile(pdfFile));
        const page = doc.getPage(currentPage);
        const { width: pgW, height: pgH } = page.getSize();
        const sx = pgW / canvas.clientWidth;
        const sy = pgH / canvas.clientHeight;
        const pngBytes = dataUrlToBytes(signatureDataUrl);
        const img = await doc.embedPng(pngBytes);
        page.drawImage(img, {
          x: sigPos.x * sx,
          y: pgH - (sigPos.y + sigPos.h) * sy,
          width: sigPos.w * sx,
          height: sigPos.h * sy,
        });
        const defName = pdfFile.name.replace(/\.pdf$/i, "_signed.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Rotate Pages
  ================================================ */
  function renderRotate(el) {
    let file = null, total = 0;
    el.innerHTML = `
      <div class="tool-head"><h2>Rotate Pages</h2><p>Rotate all pages or a specific range by 90, 180, or 270 degrees.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel">
          <div class="info-row"><span>File</span><span id="fn"></span></div>
          <div class="info-row"><span>Pages</span><span id="pc"></span></div>
        </div>
        <div class="inline-fields mt-1">
          <div class="form-group"><label>Rotation</label>
            <div class="select-wrap"><select id="deg" class="input"><option value="90">90\u00b0 clockwise</option><option value="180">180\u00b0</option><option value="270">270\u00b0 (90\u00b0 counter-clockwise)</option></select></div>
          </div>
          <div class="form-group"><label>Pages (e.g. 1-3, 5)</label><input id="rng" class="input" placeholder="All pages"></div>
        </div>
      </div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="rotate-cw"></i>Rotate</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0]; showLoading("Reading\u2026");
      try {
        const d = await PDFDocument.load(await readFile(file));
        total = d.getPageCount();
        $("#fn", el).textContent = file.name;
        $("#pc", el).textContent = total;
        $("#opts", el).classList.remove("hidden");
        $("#go", el).disabled = false;
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(file.name.replace(/\.pdf$/i, "_rotated.pdf")));
        lucide.createIcons();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    $("#go", el).addEventListener("click", async () => {
      if (!file) return; showLoading("Rotating\u2026");
      try {
        const doc = await PDFDocument.load(await readFile(file));
        const deg = parseInt($("#deg", el).value);
        const rng = $("#rng", el).value.trim();
        const indices = rng ? parsePageRange(rng, total) : doc.getPageIndices();
        indices.forEach((i) => { const p = doc.getPage(i); p.setRotation(degrees(p.getRotation().angle + deg)); });
        const defName = file.name.replace(/\.pdf$/i, "_rotated.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Extract Pages
  ================================================ */
  function renderExtract(el) {
    let file = null, total = 0;
    el.innerHTML = `
      <div class="tool-head"><h2>Extract Pages</h2><p>Pull specific pages out of a PDF into a new file.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel">
          <div class="info-row"><span>File</span><span id="fn"></span></div>
          <div class="info-row"><span>Pages</span><span id="pc"></span></div>
        </div>
        <div class="form-group mt-1"><label>Pages to extract (e.g. 1-3, 5, 8-10)</label><input id="rng" class="input" placeholder="1-3, 5"></div>
      </div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="file-output"></i>Extract</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0]; showLoading("Reading\u2026");
      try {
        const d = await PDFDocument.load(await readFile(file));
        total = d.getPageCount();
        $("#fn", el).textContent = file.name;
        $("#pc", el).textContent = total;
        $("#opts", el).classList.remove("hidden");
        $("#go", el).disabled = false;
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(file.name.replace(/\.pdf$/i, "_extracted.pdf")));
        lucide.createIcons();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      const rng = $("#rng", el).value.trim();
      if (!rng) { toast("Enter a page range", "error"); return; }
      const indices = parsePageRange(rng, total);
      if (!indices.length) { toast("No valid pages in range", "error"); return; }
      showLoading("Extracting\u2026");
      try {
        const src = await PDFDocument.load(await readFile(file));
        const doc = await PDFDocument.create();
        (await doc.copyPages(src, indices)).forEach((p) => doc.addPage(p));
        const defName = file.name.replace(/\.pdf$/i, "_extracted.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Reorder Pages
  ================================================ */
  function renderReorder(el) {
    let file = null;
    let pdfJsDoc = null;
    let originalOrder = [];
    let pages = [];
    let nextId = 1;

    el.innerHTML = `
      <div class="tool-head">
        <h2>Reorder Pages</h2>
        <p>Upload a PDF, drag pages into a new order, delete any you don't want, then download the result.</p>
      </div>
      <div id="dz"></div>
      <div id="ws" class="hidden">
        <div class="reorder-toolbar">
          <span id="pgInfo" class="reorder-stats"></span>
          <div class="reorder-actions">
            <button class="btn btn-outline btn-sm" id="resetBtn"><i data-lucide="rotate-ccw"></i>Reset</button>
            <button class="btn btn-ghost btn-sm" id="clearBtn"><i data-lucide="upload"></i>Change PDF</button>
          </div>
        </div>
        <p class="reorder-hint"><i data-lucide="info"></i>Drag tiles to reorder. Hover and click the <i data-lucide="x"></i> to remove a page.</p>
        <div id="pgrid" class="page-grid"></div>
        <div id="oname-wrap" class="mt-1"></div>
        <div class="tool-actions">
          <div id="out"></div>
          <button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="download"></i>Save Reordered PDF</button>
        </div>
      </div>`;

    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", hint: ".pdf", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    $("#resetBtn", el).addEventListener("click", () => {
      pages = originalOrder.map((p) => ({ ...p }));
      renderGrid();
    });

    $("#clearBtn", el).addEventListener("click", () => {
      file = null;
      pdfJsDoc = null;
      originalOrder = [];
      pages = [];
      $("#ws", el).classList.add("hidden");
      $("#dz", el).classList.remove("hidden");
      $("#go", el).disabled = true;
    });

    $("#go", el).addEventListener("click", saveReordered);

    async function onFile(files) {
      file = files[0];
      showLoading("Loading PDF\u2026");
      try {
        const bytes = await readFile(file);
        pdfJsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
        const total = pdfJsDoc.numPages;
        originalOrder = [];
        pages = [];
        for (let i = 0; i < total; i++) {
          $("#loading-text").textContent = `Rendering page ${i + 1} / ${total}\u2026`;
          const pg = await pdfJsDoc.getPage(i + 1);
          const vp = pg.getViewport({ scale: 0.35 });
          const c = document.createElement("canvas");
          c.width = vp.width;
          c.height = vp.height;
          await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
          const dataUrl = c.toDataURL("image/jpeg", 0.75);
          const entry = { origIndex: i, id: nextId++, thumb: dataUrl };
          originalOrder.push({ ...entry });
          pages.push(entry);
        }
        $("#dz", el).classList.add("hidden");
        $("#ws", el).classList.remove("hidden");
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(file.name.replace(/\.pdf$/i, "_reordered.pdf")));
        $("#go", el).disabled = pages.length === 0;
        lucide.createIcons();
        renderGrid();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    function renderGrid() {
      const grid = $("#pgrid", el);
      const total = originalOrder.length;
      const kept = pages.length;
      const removed = total - kept;
      $("#pgInfo", el).textContent = removed > 0
        ? `${kept} of ${total} pages \u2014 ${removed} removed`
        : `${kept} page${kept === 1 ? "" : "s"}`;
      $("#go", el).disabled = pages.length === 0;

      grid.innerHTML = pages.map((p, i) => `
        <div class="page-tile" draggable="true" data-i="${i}" data-id="${p.id}">
          <div class="page-tile-grip" aria-label="Drag"><i data-lucide="grip-horizontal"></i></div>
          <button class="page-tile-del" data-i="${i}" aria-label="Remove page"><i data-lucide="x"></i></button>
          <div class="page-tile-img"><img src="${p.thumb}" alt="Page ${p.origIndex + 1}" draggable="false"></div>
          <div class="page-tile-foot">
            <span class="page-tile-num">${i + 1}</span>
            <span class="page-tile-orig">was p. ${p.origIndex + 1}</span>
          </div>
        </div>`).join("");

      grid.querySelectorAll(".page-tile-del").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          pages.splice(+b.dataset.i, 1);
          renderGrid();
        });
        b.addEventListener("dragstart", (e) => e.preventDefault());
      });

      let dragI = null;
      grid.querySelectorAll(".page-tile").forEach((tile) => {
        tile.addEventListener("dragstart", (e) => {
          dragI = +tile.dataset.i;
          tile.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", String(dragI)); } catch (_) {}
        });
        tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
        tile.addEventListener("dragover", (e) => {
          e.preventDefault();
          if (dragI === null || dragI === +tile.dataset.i) return;
          tile.classList.add("drag-target");
        });
        tile.addEventListener("dragleave", () => tile.classList.remove("drag-target"));
        tile.addEventListener("drop", (e) => {
          e.preventDefault();
          tile.classList.remove("drag-target");
          const j = +tile.dataset.i;
          if (dragI !== null && dragI !== j) {
            const [m] = pages.splice(dragI, 1);
            pages.splice(j, 0, m);
            renderGrid();
          }
          dragI = null;
        });
      });

      /* Touch-based reordering via grip handle */
      let touchDragI = null, touchClone = null, touchTargetI = null;
      grid.querySelectorAll(".page-tile-grip").forEach((grip) => {
        grip.addEventListener("touchstart", (e) => {
          e.preventDefault();
          const tile = grip.closest(".page-tile");
          touchDragI = +tile.dataset.i;
          touchTargetI = null;
          tile.classList.add("dragging");
          touchClone = tile.cloneNode(true);
          touchClone.classList.add("page-tile-ghost");
          const rect = tile.getBoundingClientRect();
          touchClone.style.width = rect.width + "px";
          touchClone.style.left = rect.left + "px";
          touchClone.style.top = rect.top + "px";
          document.body.appendChild(touchClone);
        }, { passive: false });
      });

      grid.addEventListener("touchmove", (e) => {
        if (touchDragI === null) return;
        e.preventDefault();
        const touch = e.touches[0];
        if (touchClone) {
          touchClone.style.left = (touch.clientX - touchClone.offsetWidth / 2) + "px";
          touchClone.style.top  = (touch.clientY - 30) + "px";
        }
        grid.querySelectorAll(".page-tile").forEach((t) => t.classList.remove("drag-target"));
        touchTargetI = null;
        if (touchClone) touchClone.style.pointerEvents = "none";
        const hit = document.elementFromPoint(touch.clientX, touch.clientY);
        if (touchClone) touchClone.style.pointerEvents = "";
        if (hit) {
          const ti = hit.closest(".page-tile");
          if (ti && +ti.dataset.i !== touchDragI) {
            ti.classList.add("drag-target");
            touchTargetI = +ti.dataset.i;
          }
        }
      }, { passive: false });

      const touchEnd = () => {
        if (touchDragI === null) return;
        if (touchClone) { touchClone.remove(); touchClone = null; }
        grid.querySelectorAll(".page-tile").forEach((t) => t.classList.remove("dragging", "drag-target"));
        if (touchTargetI !== null && touchTargetI !== touchDragI) {
          const [m] = pages.splice(touchDragI, 1);
          pages.splice(touchTargetI, 0, m);
        }
        touchDragI = null;
        touchTargetI = null;
        renderGrid();
      };
      grid.addEventListener("touchend", touchEnd, { passive: false });
      grid.addEventListener("touchcancel", touchEnd, { passive: false });

      lucide.createIcons();
    }

    async function saveReordered() {
      if (!pages.length) { toast("No pages to save", "error"); return; }
      showLoading("Saving reordered PDF\u2026");
      try {
        const src = await PDFDocument.load(await readFile(file));
        const doc = await PDFDocument.create();
        const indices = pages.map((p) => p.origIndex);
        const copied = await doc.copyPages(src, indices);
        copied.forEach((p) => doc.addPage(p));
        const defName = file.name.replace(/\.pdf$/i, "_reordered.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Add Watermark
  ================================================ */
  function renderWatermark(el) {
    let file = null;
    el.innerHTML = `
      <div class="tool-head"><h2>Add Watermark</h2><p>Overlay repeating text across every page of a PDF.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel"><div class="info-row"><span>File</span><span id="fn"></span></div></div>
        <div class="inline-fields mt-1">
          <div class="form-group"><label>Watermark text</label><input id="wtxt" class="input" value="CONFIDENTIAL" placeholder="DRAFT"></div>
          <div class="form-group"><label>Font size</label><input type="number" id="wsz" class="input" value="48" min="8" max="200"></div>
          <div class="form-group"><label>Opacity</label><input type="number" id="wop" class="input" value="0.12" min="0.01" max="1" step="0.01"></div>
        </div>
      </div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="droplets"></i>Apply Watermark</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0];
      $("#fn", el).textContent = file.name;
      $("#opts", el).classList.remove("hidden");
      $("#go", el).disabled = false;
      const wrap = $("#oname-wrap", el);
      wrap.innerHTML = "";
      wrap.appendChild(makeOutputName(file.name.replace(/\.pdf$/i, "_watermarked.pdf")));
      lucide.createIcons();
    }

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      const txt = $("#wtxt", el).value.trim();
      if (!txt) { toast("Enter watermark text", "error"); return; }
      const sz = parseInt($("#wsz", el).value) || 48;
      const op = parseFloat($("#wop", el).value) || 0.12;
      showLoading("Adding watermark\u2026");
      try {
        const doc = await PDFDocument.load(await readFile(file));
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        const pages = doc.getPages();
        for (const page of pages) {
          const { width, height } = page.getSize();
          const tw = font.widthOfTextAtSize(txt, sz);
          const th = sz;
          const diag = Math.sqrt(width * width + height * height);
          const angle = Math.atan2(height, width);
          const step = th * 4;
          for (let y = -diag; y < diag * 2; y += step) {
            page.drawText(txt, {
              x: width / 2 - tw / 2 * Math.cos(angle),
              y: height / 2 + y - th / 2,
              size: sz,
              font,
              color: grayscale(0.5),
              opacity: op,
              rotate: degrees(Math.round((angle * 180) / Math.PI)),
            });
          }
        }
        const defName = file.name.replace(/\.pdf$/i, "_watermarked.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Page Numbers
  ================================================ */
  function renderPageNums(el) {
    let file = null;
    el.innerHTML = `
      <div class="tool-head"><h2>Page Numbers</h2><p>Add page numbering to every page in the document.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel"><div class="info-row"><span>File</span><span id="fn"></span></div><div class="info-row"><span>Pages</span><span id="pc"></span></div></div>
        <div class="inline-fields mt-1">
          <div class="form-group"><label>Position</label>
            <div class="select-wrap"><select id="pos" class="input">
              <option value="bc">Bottom center</option><option value="br">Bottom right</option><option value="bl">Bottom left</option>
              <option value="tc">Top center</option><option value="tr">Top right</option><option value="tl">Top left</option>
            </select></div>
          </div>
          <div class="form-group"><label>Start number</label><input type="number" id="start" class="input" value="1" min="0"></div>
          <div class="form-group"><label>Font size</label><input type="number" id="fsz" class="input" value="11" min="6" max="72"></div>
        </div>
      </div>
      <div id="oname-wrap" class="mt-1"></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="hash"></i>Add Numbers</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0]; showLoading("Reading\u2026");
      try {
        const d = await PDFDocument.load(await readFile(file));
        $("#fn", el).textContent = file.name;
        $("#pc", el).textContent = d.getPageCount();
        $("#opts", el).classList.remove("hidden");
        $("#go", el).disabled = false;
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(file.name.replace(/\.pdf$/i, "_numbered.pdf")));
        lucide.createIcons();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      const position = $("#pos", el).value;
      const startNum = parseInt($("#start", el).value) || 1;
      const fontSize = parseInt($("#fsz", el).value) || 11;
      showLoading("Adding page numbers\u2026");
      try {
        const doc = await PDFDocument.load(await readFile(file));
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pages = doc.getPages();
        const margin = 36;
        pages.forEach((page, i) => {
          const { width, height } = page.getSize();
          const txt = String(startNum + i);
          const tw = font.widthOfTextAtSize(txt, fontSize);
          let x, y;
          if (position.startsWith("b")) y = margin;
          else y = height - margin;
          if (position.endsWith("c")) x = (width - tw) / 2;
          else if (position.endsWith("r")) x = width - margin - tw;
          else x = margin;
          page.drawText(txt, { x, y, size: fontSize, font, color: rgb(0.35, 0.35, 0.35) });
        });
        const defName = file.name.replace(/\.pdf$/i, "_numbered.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Add Textbox
  ================================================ */
  function renderTextbox(el) {
    let pdfFile = null, pdfJsDoc = null, currentPage = 0, totalPages = 0;
    const SCALE = 1.5;
    const textboxes = [];

    el.innerHTML = `
      <div class="tool-head"><h2>Add Textbox</h2><p>Tap the button or draw on the page to add textboxes. Drag the grip to move.</p></div>
      <div id="dz"></div>
      <div id="ws" class="hidden">
        <div class="sign-toolbar">
          <div class="tb-controls">
            <button class="btn btn-secondary" id="addTbBtn"><i data-lucide="plus"></i>Add Textbox</button>
            <div class="form-group-inline"><label>Size</label><input type="number" id="tbSize" class="input input-sm" value="14" min="6" max="120"></div>
            <div class="form-group-inline"><label>Color</label><input type="color" id="tbColor" class="input-color" value="#000000"></div>
          </div>
          <div class="page-nav">
            <button class="btn-icon" id="prevP"><i data-lucide="chevron-left"></i></button>
            <span id="pgInd">1 / 1</span>
            <button class="btn-icon" id="nextP"><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
        <div class="pdf-preview-wrap" id="pvw">
          <canvas id="pcanvas"></canvas>
          <div id="drawRect" class="draw-rect hidden"></div>
        </div>
        <div id="oname-wrap" class="mt-1"></div>
        <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="apply" disabled><i data-lucide="check"></i>Apply &amp; Download</button></div>
      </div>`;

    const pvw = $("#pvw", el), canvas = $("#pcanvas", el);
    const drawRectEl = $("#drawRect", el);
    $("#out", el).appendChild(makeOutputSel());
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    lucide.createIcons();

    async function onFile(files) {
      pdfFile = files[0];
      showLoading("Loading PDF\u2026");
      try {
        pdfJsDoc = await pdfjsLib.getDocument({ data: await readFile(pdfFile) }).promise;
        totalPages = pdfJsDoc.numPages;
        currentPage = 0;
        $("#dz", el).classList.add("hidden");
        $("#ws", el).classList.remove("hidden");
        canvas.style.cursor = "crosshair";
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(pdfFile.name.replace(/\.pdf$/i, "_edited.pdf")));
        lucide.createIcons();
        await renderPg();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    async function renderPg() {
      const pg = await pdfJsDoc.getPage(currentPage + 1);
      const vp = pg.getViewport({ scale: SCALE });
      canvas.width = vp.width;
      canvas.height = vp.height;
      await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      $("#pgInd", el).textContent = `${currentPage + 1} / ${totalPages}`;
      $("#prevP", el).disabled = currentPage === 0;
      $("#nextP", el).disabled = currentPage === totalPages - 1;
    }

    function clearAllBoxes() {
      textboxes.forEach((tb) => tb.el.remove());
      textboxes.length = 0;
      $("#apply", el).disabled = true;
    }

    $("#prevP", el).addEventListener("click", async () => { if (currentPage > 0) { clearAllBoxes(); currentPage--; await renderPg(); } });
    $("#nextP", el).addEventListener("click", async () => { if (currentPage < totalPages - 1) { clearAllBoxes(); currentPage++; await renderPg(); } });

    /* Tap canvas = deselect all textboxes */
    canvas.addEventListener("click", () => { if (document.activeElement?.closest && document.activeElement.closest(".text-overlay")) document.activeElement.blur(); });

    function getPtr(e) {
      if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    function visFontSize(pdfPt) {
      return pdfPt * canvas.clientWidth * SCALE / canvas.width;
    }

    /* --- "Add Textbox" button (primary mobile method) --- */
    $("#addTbBtn", el).addEventListener("click", () => {
      const w = Math.min(200, pvw.clientWidth * 0.55);
      const h = Math.min(80, pvw.clientHeight * 0.15);
      const x = (pvw.clientWidth - w) / 2;
      const y = (pvw.clientHeight - h) / 3;
      createTextbox(x, y, w, Math.max(h, 40));
    });

    /* --- Draw-to-create (mouse only — touch is left free for scroll/zoom) --- */
    let drawing = false, drawStart = null;
    let activeDrag = null, activeResize = null;

    pvw.addEventListener("mousedown", (e) => {
      if (e.target !== canvas) return;
      drawing = true;
      const cr = pvw.getBoundingClientRect();
      drawStart = { x: e.clientX - cr.left, y: e.clientY - cr.top };
      drawRectEl.classList.remove("hidden");
      Object.assign(drawRectEl.style, { left: drawStart.x + "px", top: drawStart.y + "px", width: "0px", height: "0px" });
      e.preventDefault();
    });

    function onDocMove(e) {
      const ptr = getPtr(e);
      if (drawing && drawStart) {
        e.preventDefault();
        const cr = pvw.getBoundingClientRect();
        const cx = Math.max(0, Math.min(ptr.x - cr.left, pvw.clientWidth));
        const cy = Math.max(0, Math.min(ptr.y - cr.top, pvw.clientHeight));
        const x = Math.min(drawStart.x, cx), y = Math.min(drawStart.y, cy);
        Object.assign(drawRectEl.style, { left: x + "px", top: y + "px", width: Math.abs(cx - drawStart.x) + "px", height: Math.abs(cy - drawStart.y) + "px" });
        return;
      }
      if (activeDrag) {
        e.preventDefault();
        const cr = pvw.getBoundingClientRect();
        let nx = ptr.x - cr.left - activeDrag.ox, ny = ptr.y - cr.top - activeDrag.oy;
        nx = Math.max(0, Math.min(nx, pvw.clientWidth - activeDrag.tb.el.offsetWidth));
        ny = Math.max(0, Math.min(ny, pvw.clientHeight - activeDrag.tb.el.offsetHeight));
        activeDrag.tb.el.style.left = nx + "px";
        activeDrag.tb.el.style.top = ny + "px";
        return;
      }
      if (activeResize) {
        e.preventDefault();
        const nw = Math.max(40, activeResize.sw + (ptr.x - activeResize.sx));
        const nh = Math.max(20, activeResize.sh + (ptr.y - activeResize.sy));
        activeResize.tb.el.style.width = nw + "px";
        activeResize.tb.el.style.height = nh + "px";
      }
    }

    function onDocUp() {
      if (drawing) {
        drawing = false;
        drawRectEl.classList.add("hidden");
        const x = parseFloat(drawRectEl.style.left), y = parseFloat(drawRectEl.style.top);
        const w = parseFloat(drawRectEl.style.width), h = parseFloat(drawRectEl.style.height);
        drawStart = null;
        if (w >= 20 && h >= 12) createTextbox(x, y, w, h);
      }
      activeDrag = null;
      activeResize = null;
    }

    document.addEventListener("mousemove", onDocMove);
    document.addEventListener("touchmove", onDocMove, { passive: false });
    document.addEventListener("mouseup", onDocUp);
    document.addEventListener("touchend", onDocUp);
    document.addEventListener("touchcancel", onDocUp);

    /* --- Create a textbox --- */
    function createTextbox(x, y, w, h) {
      const fontSize = parseInt($("#tbSize", el).value) || 14;
      const color = $("#tbColor", el).value;

      const box = document.createElement("div");
      box.className = "text-overlay";
      box.innerHTML = `<div class="text-ov-grip"><i data-lucide="grip-horizontal"></i></div><textarea class="text-ov-input" spellcheck="false" placeholder="Type\u2026"></textarea><button class="text-ov-del"><i data-lucide="x"></i></button><div class="resize-h"></div>`;
      Object.assign(box.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });

      const ta = box.querySelector(".text-ov-input");
      const vfs = visFontSize(fontSize);
      ta.style.fontSize = vfs + "px";
      ta.style.lineHeight = (vfs * 1.35) + "px";
      ta.style.color = color;

      pvw.appendChild(box);
      lucide.createIcons();

      const tb = { el: box, ta, fontSize, color };
      textboxes.push(tb);
      ta.focus();
      $("#apply", el).disabled = false;

      box.querySelector(".text-ov-del").addEventListener("click", (e) => {
        e.stopPropagation();
        box.remove();
        const idx = textboxes.indexOf(tb);
        if (idx >= 0) textboxes.splice(idx, 1);
        if (!textboxes.length) $("#apply", el).disabled = true;
      });

      const grip = box.querySelector(".text-ov-grip");
      function gripDown(e) {
        const ptr = getPtr(e);
        const r = box.getBoundingClientRect();
        activeDrag = { tb, ox: ptr.x - r.left, oy: ptr.y - r.top };
        e.preventDefault();
        e.stopPropagation();
      }
      grip.addEventListener("mousedown", gripDown);
      grip.addEventListener("touchstart", gripDown, { passive: false });

      const rz = box.querySelector(".resize-h");
      function rzDown(e) {
        const ptr = getPtr(e);
        activeResize = { tb, sx: ptr.x, sy: ptr.y, sw: box.offsetWidth, sh: box.offsetHeight };
        e.stopPropagation();
        e.preventDefault();
      }
      rz.addEventListener("mousedown", rzDown);
      rz.addEventListener("touchstart", rzDown, { passive: false });
    }

    /* --- Apply all textboxes --- */
    $("#apply", el).addEventListener("click", async () => {
      const filled = textboxes.filter((tb) => tb.ta.value.trim());
      if (!filled.length || !pdfFile) { toast("Enter text in at least one textbox", "error"); return; }
      showLoading("Adding text\u2026");
      try {
        const doc = await PDFDocument.load(await readFile(pdfFile));
        const page = doc.getPage(currentPage);
        const { width: pgW, height: pgH } = page.getSize();
        const sx = pgW / canvas.clientWidth;
        const sy = pgH / canvas.clientHeight;
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pvwRect = pvw.getBoundingClientRect();

        for (const tb of filled) {
          const text = tb.ta.value.trim();
          const taRect = tb.ta.getBoundingClientRect();
          const textLeft = (taRect.left - pvwRect.left) * sx;
          const textTop = (taRect.top - pvwRect.top) * sy;
          const maxWidth = tb.ta.clientWidth * sx;
          const pdfFontSize = tb.fontSize;
          const lineHeight = pdfFontSize * 1.35;

          const hex = tb.color;
          const cr = parseInt(hex.slice(1, 3), 16) / 255;
          const cg = parseInt(hex.slice(3, 5), 16) / 255;
          const cb = parseInt(hex.slice(5, 7), 16) / 255;
          const color = rgb(cr, cg, cb);

          const wrappedLines = [];
          for (const rawLine of text.split("\n")) {
            if (!rawLine.trim()) { wrappedLines.push(""); continue; }
            let cur = "";
            for (const word of rawLine.split(" ")) {
              const test = cur ? cur + " " + word : word;
              if (font.widthOfTextAtSize(test, pdfFontSize) > maxWidth && cur) {
                wrappedLines.push(cur); cur = word;
              } else { cur = test; }
            }
            if (cur) wrappedLines.push(cur);
          }

          wrappedLines.forEach((line, i) => {
            const pdfY = pgH - textTop - pdfFontSize * 0.82 - i * lineHeight;
            if (line) page.drawText(line, { x: textLeft, y: pdfY, size: pdfFontSize, font, color });
          });
        }

        const defName = pdfFile.name.replace(/\.pdf$/i, "_edited.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Image Converter
  ================================================ */
  function renderImgConvert(el) {
    let file = null;
    const IMG_ACCEPT = ".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.ico,.avif,.tiff";
    const EXT = { png: ".png", jpeg: ".jpg", webp: ".webp" };

    el.innerHTML = `
      <div class="tool-head"><h2>Image Converter</h2><p>Convert any image to PNG, JPG, or WEBP.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel">
          <div class="info-row"><span>File</span><span id="fn"></span></div>
          <div class="info-row"><span>Size</span><span id="fsz"></span></div>
        </div>
        <div class="inline-fields mt-1">
          <div class="form-group"><label>Output format</label>
            <div class="select-wrap"><select id="fmt" class="input">
              <option value="png">PNG</option>
              <option value="jpeg">JPG</option>
              <option value="webp">WEBP</option>
            </select></div>
          </div>
          <div class="form-group hidden" id="qwrap"><label>Quality (%)</label><input type="number" id="qual" class="input" value="92" min="10" max="100"></div>
        </div>
        <div id="oname-wrap" class="mt-1"></div>
      </div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="repeat"></i>Convert</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: IMG_ACCEPT, label: "Drop an image here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    function updateQualVis() {
      const fmt = $("#fmt", el).value;
      $("#qwrap", el).classList.toggle("hidden", fmt === "png");
    }

    function defaultName() {
      const base = file ? file.name.replace(/\.[^.]+$/, "") : "image";
      return base + EXT[$("#fmt", el).value];
    }

    function refreshName() {
      const wrap = $("#oname-wrap", el);
      wrap.innerHTML = "";
      wrap.appendChild(makeOutputName(defaultName()));
      lucide.createIcons();
    }

    function onFile(files) {
      file = files[0];
      $("#fn", el).textContent = file.name;
      $("#fsz", el).textContent = formatBytes(file.size);
      $("#opts", el).classList.remove("hidden");
      $("#go", el).disabled = false;
      updateQualVis();
      refreshName();
    }

    $("#fmt", el).addEventListener("change", () => { updateQualVis(); refreshName(); });

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      showLoading("Converting\u2026");
      try {
        const img = await loadImage(URL.createObjectURL(file));
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        const fmt = $("#fmt", el).value;
        const q = fmt === "png" ? undefined : (parseInt($("#qual", el).value) || 92) / 100;
        const blob = await new Promise((res) => c.toBlob(res, "image/" + fmt, q));
        const name = getOutputName(el, defaultName());
        await saveBlobAs(blob, name);
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Image Resize
  ================================================ */
  function renderImgResize(el) {
    let file = null, origW = 0, origH = 0;

    el.innerHTML = `
      <div class="tool-head"><h2>Image Resize</h2><p>Resize by exact width or set a file size limit. Aspect ratio is always maintained.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel">
          <div class="info-row"><span>File</span><span id="fn"></span></div>
          <div class="info-row"><span>Dimensions</span><span id="dims"></span></div>
          <div class="info-row"><span>Size</span><span id="fsz"></span></div>
        </div>
        <div class="form-group mt-1"><label>Resize mode</label>
          <div class="select-wrap"><select id="mode" class="input">
            <option value="width">Set exact width (px)</option>
            <option value="filesize">Max file size (KB)</option>
          </select></div>
        </div>
        <div id="widthMode">
          <div class="form-group"><label>Width (px)</label><input type="number" id="rw" class="input" min="1"></div>
          <div id="newdims" class="info-hint"></div>
        </div>
        <div id="fsMode" class="hidden">
          <div class="form-group"><label>Max file size (KB)</label><input type="number" id="maxkb" class="input" min="1" value="200"></div>
          <p class="info-hint">Outputs as JPG. Reduces quality then dimensions until under limit.</p>
        </div>
        <div id="oname-wrap" class="mt-1"></div>
      </div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="scaling"></i>Resize</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.avif", label: "Drop an image here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    function onFile(files) {
      file = files[0];
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        origW = img.naturalWidth; origH = img.naturalHeight;
        $("#fn", el).textContent = file.name;
        $("#dims", el).textContent = `${origW} \u00d7 ${origH} px`;
        $("#fsz", el).textContent = formatBytes(file.size);
        $("#rw", el).value = origW;
        $("#newdims", el).textContent = `\u2192 ${origW} \u00d7 ${origH} px`;
        $("#opts", el).classList.remove("hidden");
        $("#go", el).disabled = false;
        const base = file.name.replace(/\.[^.]+$/, "");
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(base + "_resized.jpg"));
        lucide.createIcons();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }

    $("#mode", el).addEventListener("change", () => {
      const isW = $("#mode", el).value === "width";
      $("#widthMode", el).classList.toggle("hidden", !isW);
      $("#fsMode", el).classList.toggle("hidden", isW);
    });

    $("#rw", el).addEventListener("input", () => {
      const nw = parseInt($("#rw", el).value) || origW;
      const nh = Math.round(nw * origH / origW);
      $("#newdims", el).textContent = `\u2192 ${nw} \u00d7 ${nh} px`;
    });

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      showLoading("Resizing\u2026");
      try {
        const img = await loadImage(URL.createObjectURL(file));
        const mode = $("#mode", el).value;
        let blob;

        if (mode === "width") {
          const nw = Math.max(1, parseInt($("#rw", el).value) || origW);
          const nh = Math.round(nw * origH / origW);
          const c = document.createElement("canvas");
          c.width = nw; c.height = nh;
          c.getContext("2d").drawImage(img, 0, 0, nw, nh);
          blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
        } else {
          const maxBytes = (parseInt($("#maxkb", el).value) || 200) * 1024;
          let w = origW, h = origH, q = 0.92;
          while (true) {
            const c = document.createElement("canvas");
            c.width = w; c.height = h;
            c.getContext("2d").drawImage(img, 0, 0, w, h);
            blob = await new Promise((res) => c.toBlob(res, "image/jpeg", q));
            if (blob.size <= maxBytes || (w < 10 && q <= 0.1)) break;
            if (q > 0.15) { q -= 0.08; } else { w = Math.round(w * 0.85); h = Math.round(h * 0.85); q = 0.80; }
          }
        }

        const defName = file.name.replace(/\.[^.]+$/, "") + "_resized.jpg";
        const name = getOutputName(el, defName);
        await saveBlobAs(blob, name);
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Color Picker
  ================================================ */
  function renderColorPicker(el) {
    const palette = [];
    let pickedHex = null;

    el.innerHTML = `
      <div class="tool-head"><h2>Color Picker</h2><p>Upload an image and click to pick colors. Build a palette with hex codes.</p></div>
      <div id="dz"></div>
      <div id="ws" class="hidden">
        <div class="picker-wrap"><canvas id="pickCanvas"></canvas></div>
        <div class="picker-info mt-1">
          <div id="pickSwatch" class="pick-swatch"></div>
          <span id="pickHex" class="pick-hex">\u2014</span>
          <button class="btn btn-secondary btn-sm" id="addColor" disabled><i data-lucide="plus"></i>Add to palette</button>
        </div>
        <div id="paletteWrap" class="hidden mt-1">
          <div class="palette-head"><span class="palette-title">Palette</span><button class="btn btn-ghost btn-sm" id="copyAll"><i data-lucide="copy"></i>Copy all</button></div>
          <div id="palette" class="color-palette"></div>
        </div>
      </div>`;

    const canvasEl = $("#pickCanvas", el);
    const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
    $("#dz", el).appendChild(makeDropZone({ accept: ".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.avif", label: "Drop an image here", onFiles: onFile }));
    lucide.createIcons();

    function onFile(files) {
      const url = URL.createObjectURL(files[0]);
      const img = new Image();
      img.onload = () => {
        const maxW = Math.min(img.naturalWidth, 800);
        const scale = maxW / img.naturalWidth;
        canvasEl.width = Math.round(img.naturalWidth * scale);
        canvasEl.height = Math.round(img.naturalHeight * scale);
        ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
        $("#dz", el).classList.add("hidden");
        $("#ws", el).classList.remove("hidden");
        lucide.createIcons();
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }

    function sampleColor(e) {
      const rect = canvasEl.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      const x = Math.floor((t.clientX - rect.left) * (canvasEl.width / rect.width));
      const y = Math.floor((t.clientY - rect.top) * (canvasEl.height / rect.height));
      if (x < 0 || y < 0 || x >= canvasEl.width || y >= canvasEl.height) return null;
      const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
      return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
    }

    let locked = false;

    function updatePreview(hex) {
      if (!hex) return;
      pickedHex = hex;
      $("#pickSwatch", el).style.background = hex;
      $("#pickHex", el).textContent = hex;
      $("#addColor", el).disabled = false;
    }

    canvasEl.addEventListener("mousemove", (e) => { if (!locked) { const h = sampleColor(e); if (h) updatePreview(h); } });
    canvasEl.addEventListener("touchmove", (e) => { e.preventDefault(); if (!locked) { const h = sampleColor(e); if (h) updatePreview(h); } }, { passive: false });
    canvasEl.addEventListener("click", (e) => {
      const h = sampleColor(e);
      if (h) { updatePreview(h); locked = true; canvasEl.classList.add("pick-locked"); }
    });
    canvasEl.addEventListener("touchend", (e) => { e.preventDefault(); locked = true; canvasEl.classList.add("pick-locked"); });

    $("#addColor", el).addEventListener("click", () => {
      if (!pickedHex || palette.includes(pickedHex)) return;
      palette.push(pickedHex);
      renderPalette();
      locked = false;
      canvasEl.classList.remove("pick-locked");
    });

    $("#copyAll", el).addEventListener("click", () => {
      if (!palette.length) return;
      navigator.clipboard.writeText(palette.join("\n")).then(() => toast("Copied " + palette.length + " colors", "success"));
    });

    function renderPalette() {
      const wrap = $("#paletteWrap", el);
      const cont = $("#palette", el);
      if (!palette.length) { wrap.classList.add("hidden"); cont.innerHTML = ""; return; }
      wrap.classList.remove("hidden");
      cont.innerHTML = palette.map((hex, i) => `
        <div class="color-swatch" data-i="${i}">
          <div class="color-swatch-dot" style="background:${hex}"></div>
          <span class="color-swatch-hex">${hex}</span>
          <button class="color-swatch-copy" title="Copy"><i data-lucide="copy"></i></button>
          <button class="color-swatch-del" title="Remove"><i data-lucide="x"></i></button>
        </div>`).join("");
      cont.querySelectorAll(".color-swatch-copy").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const hex = palette[+btn.closest(".color-swatch").dataset.i];
          navigator.clipboard.writeText(hex).then(() => toast("Copied " + hex, "success"));
        });
      });
      cont.querySelectorAll(".color-swatch-del").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          palette.splice(+btn.closest(".color-swatch").dataset.i, 1);
          renderPalette();
        });
      });
      lucide.createIcons();
    }
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Compress PDF
  ================================================ */
  function renderCompress(el) {
    let file = null;
    el.innerHTML = `
      <div class="tool-head"><h2>Compress PDF</h2><p>Reduce PDF file size by re-rendering pages as compressed images. Optionally set a target size.</p></div>
      <div id="dz"></div>
      <div id="opts" class="hidden">
        <div class="info-panel">
          <div class="info-row"><span>File</span><span id="fn"></span></div>
          <div class="info-row"><span>Original size</span><span id="origSz"></span></div>
          <div class="info-row"><span>Pages</span><span id="pgCnt"></span></div>
        </div>
        <div class="inline-fields mt-1">
          <div class="form-group"><label>Quality</label>
            <div class="select-wrap"><select id="cQual" class="input">
              <option value="high">High (best quality)</option>
              <option value="medium" selected>Medium (balanced)</option>
              <option value="low">Low (smallest file)</option>
            </select></div>
          </div>
          <div class="form-group"><label>Target size (KB, optional)</label><input type="number" id="targetKB" class="input" placeholder="e.g. 500" min="50"></div>
        </div>
        <p class="info-hint mt-half">Leave target size blank to compress with the selected quality. Set a target to keep shrinking until the file fits.</p>
        <div id="oname-wrap" class="mt-1"></div>
      </div>
      <div id="result" class="info-panel hidden mt-1">
        <div class="info-row"><span>New size</span><span id="newSz"></span></div>
        <div class="info-row"><span>Reduction</span><span id="reduction"></span></div>
      </div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="minimize-2"></i>Compress</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0];
      showLoading("Reading PDF\u2026");
      try {
        const bytes = await readFile(file);
        const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        $("#fn", el).textContent = file.name;
        $("#origSz", el).textContent = formatBytes(file.size);
        $("#pgCnt", el).textContent = pdfJsDoc.numPages;
        $("#opts", el).classList.remove("hidden");
        $("#result", el).classList.add("hidden");
        $("#go", el).disabled = false;
        const wrap = $("#oname-wrap", el);
        wrap.innerHTML = "";
        wrap.appendChild(makeOutputName(file.name.replace(/\.pdf$/i, "_compressed.pdf")));
        lucide.createIcons();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    $("#go", el).addEventListener("click", async () => {
      if (!file) return;
      showLoading("Compressing PDF\u2026");
      try {
        const bytes = await readFile(file);
        const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        const numPages = pdfJsDoc.numPages;
        const qualSel = $("#cQual", el).value;
        const targetKB = parseInt($("#targetKB", el).value) || 0;
        const targetBytes = targetKB > 0 ? targetKB * 1024 : 0;

        const qualMap = { high: 0.82, medium: 0.55, low: 0.3 };
        const scaleMap = { high: 2, medium: 1.5, low: 1 };
        let quality = qualMap[qualSel];
        let renderScale = scaleMap[qualSel];

        let resultBlob = null;

        for (let attempt = 0; attempt < 6; attempt++) {
          const newDoc = await PDFDocument.create();

          for (let i = 0; i < numPages; i++) {
            $("#loading-text").textContent = `Compressing page ${i + 1} / ${numPages}\u2026`;
            const pg = await pdfJsDoc.getPage(i + 1);
            const origVp = pg.getViewport({ scale: 1 });
            const vp = pg.getViewport({ scale: renderScale });

            const c = document.createElement("canvas");
            c.width = vp.width;
            c.height = vp.height;
            await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;

            const jpgBlob = await new Promise((res) => c.toBlob(res, "image/jpeg", quality));
            const jpgBytes = new Uint8Array(await jpgBlob.arrayBuffer());
            const img = await newDoc.embedJpg(jpgBytes);
            const page = newDoc.addPage([origVp.width, origVp.height]);
            page.drawImage(img, { x: 0, y: 0, width: origVp.width, height: origVp.height });
          }

          const savedBytes = await newDoc.save();
          resultBlob = new Blob([savedBytes], { type: "application/pdf" });

          if (!targetBytes || resultBlob.size <= targetBytes) break;

          quality = Math.max(0.1, quality * 0.7);
          renderScale = Math.max(0.5, renderScale * 0.85);
        }

        const newSize = resultBlob.size;
        const pct = ((1 - newSize / file.size) * 100).toFixed(1);
        $("#newSz", el).textContent = formatBytes(newSize);
        $("#reduction", el).textContent = pct > 0 ? `${pct}% smaller` : "No reduction (already optimized)";
        $("#result", el).classList.remove("hidden");

        const defName = file.name.replace(/\.pdf$/i, "_compressed.pdf");
        const outName = getOutputName(el, defName);
        await saveBlobAs(blob, outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    bootToolFiles(onFile);
  }

  /* ================================================
     Tool: Fill Form (hidden — not production ready)
  ================================================ */
  function renderFormFill(el) {
    let pdfFile = null, pdfBytes = null, pdfJsDoc = null;
    let currentPage = 0, totalPages = 0;
    let mode = null; // "acroform" | "visual"
    let acroFields = [];
    let visualFields = []; // { id, el, x, y, w, h, placeholder }
    let nextFieldId = 0;
    const SCALE = 2;

    el.innerHTML = `
      <div class="tool-head"><h2>Fill Form</h2><p>Fill interactive PDF forms or type onto scanned forms. Auto-detects form type.</p></div>
      <div id="dz"></div>
      <div id="acroMode" class="hidden">
        <div class="info-panel"><div class="info-row"><span>Mode</span><span>Interactive Form (AcroForm)</span></div><div class="info-row"><span>Fields detected</span><span id="afCount">0</span></div></div>
        <div id="acroFields" class="acro-fields mt-1"></div>
        <div id="oname-wrap" class="mt-1"></div>
        <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="acroGo"><i data-lucide="check"></i>Fill &amp; Download</button></div>
      </div>
      <div id="visualMode" class="hidden">
        <div class="sign-toolbar">
          <div class="tb-controls">
            <button class="btn btn-secondary" id="addFieldBtn"><i data-lucide="plus"></i>Add Field</button>
            <div class="form-group-inline"><label>Size</label><input type="number" id="ffSize" class="input input-sm" value="11" min="6" max="36"></div>
          </div>
          <div class="page-nav">
            <button class="btn-icon" id="prevP"><i data-lucide="chevron-left"></i></button>
            <span id="pgInd">1 / 1</span>
            <button class="btn-icon" id="nextP"><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
        <div class="pdf-preview-wrap" id="pvw"><canvas id="pcanvas"></canvas></div>
        <div id="oname-wrap2" class="mt-1"></div>
        <div class="tool-actions"><div id="out2"></div><button class="btn btn-primary btn-lg" id="visualGo"><i data-lucide="check"></i>Fill &amp; Download</button></div>
      </div>`;

    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF form here", onFiles: onFile }));
    lucide.createIcons();

    async function onFile(files) {
      pdfFile = files[0];
      showLoading("Analyzing form\u2026");
      try {
        pdfBytes = await readFile(pdfFile);
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        let hasAcro = false;
        try {
          const form = pdfDoc.getForm();
          const fields = form.getFields();
          if (fields.length > 0) { hasAcro = true; acroFields = fields; }
        } catch (_) {}

        if (hasAcro) {
          mode = "acroform";
          initAcroMode(pdfDoc);
        } else {
          mode = "visual";
          await initVisualMode();
        }
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    /* ========== ACROFORM MODE ========== */
    function initAcroMode(pdfDoc) {
      $("#dz", el).classList.add("hidden");
      $("#acroMode", el).classList.remove("hidden");
      $("#afCount", el).textContent = acroFields.length;

      const container = $("#acroFields", el);
      container.innerHTML = acroFields.map((field, i) => {
        const type = field.constructor.name;
        const name = field.getName();
        if (type === "PDFTextField") {
          const cur = field.getText() || "";
          return `<div class="acro-field"><label>${name}</label><input type="text" class="input acro-input" data-i="${i}" value="${cur}" placeholder="${name}"></div>`;
        } else if (type === "PDFCheckBox") {
          const checked = field.isChecked() ? "checked" : "";
          return `<div class="acro-field acro-field-check"><label><input type="checkbox" class="acro-check" data-i="${i}" ${checked}> ${name}</label></div>`;
        } else if (type === "PDFDropdown") {
          const opts = field.getOptions();
          const sel = field.getSelected();
          return `<div class="acro-field"><label>${name}</label><div class="select-wrap"><select class="input acro-select" data-i="${i}">${opts.map((o) => `<option ${sel.includes(o) ? "selected" : ""}>${o}</option>`).join("")}</select></div></div>`;
        }
        return "";
      }).join("");

      const wrap = $("#oname-wrap", el);
      wrap.innerHTML = "";
      wrap.appendChild(makeOutputName(pdfFile.name.replace(/\.pdf$/i, "_filled.pdf")));
      if (!$("#out", el).children.length) $("#out", el).appendChild(makeOutputSel());
      lucide.createIcons();
    }

    $("#acroGo", el).addEventListener("click", async () => {
      showLoading("Filling form\u2026");
      try {
        const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const form = pdfDoc.getForm();
        const fields = form.getFields();

        el.querySelectorAll(".acro-input").forEach((inp) => {
          const f = fields[+inp.dataset.i];
          if (f && f.setText) f.setText(inp.value);
        });
        el.querySelectorAll(".acro-check").forEach((inp) => {
          const f = fields[+inp.dataset.i];
          if (f) { if (inp.checked) f.check(); else f.uncheck(); }
        });
        el.querySelectorAll(".acro-select").forEach((sel) => {
          const f = fields[+sel.dataset.i];
          if (f && f.select) f.select(sel.value);
        });

        form.flatten();
        const defName = pdfFile.name.replace(/\.pdf$/i, "_filled.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await pdfDoc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });

    /* ========== VISUAL MODE ========== */
    const pvw = () => $("#pvw", el);
    const canvas = () => $("#pcanvas", el);

    async function initVisualMode() {
      $("#dz", el).classList.add("hidden");
      $("#visualMode", el).classList.remove("hidden");
      pdfJsDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      totalPages = pdfJsDoc.numPages;
      currentPage = 0;

      const wrap = $("#oname-wrap2", el);
      wrap.innerHTML = "";
      wrap.appendChild(makeOutputName(pdfFile.name.replace(/\.pdf$/i, "_filled.pdf")));
      if (!$("#out2", el).children.length) $("#out2", el).appendChild(makeOutputSel());
      lucide.createIcons();

      await renderPage();
      pvw().addEventListener("click", onCanvasClick);
      await detectFields();
    }

    async function renderPage() {
      const pg = await pdfJsDoc.getPage(currentPage + 1);
      const vp = pg.getViewport({ scale: SCALE });
      const c = canvas();
      c.width = vp.width;
      c.height = vp.height;
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      c.style.cursor = "crosshair";
      $("#pgInd", el).textContent = `${currentPage + 1} / ${totalPages}`;
      $("#prevP", el).disabled = currentPage === 0;
      $("#nextP", el).disabled = currentPage === totalPages - 1;
    }

    function clearVisualFields() {
      visualFields.forEach((f) => f.el.remove());
      visualFields.length = 0;
    }

    $("#prevP", el).addEventListener("click", async () => { if (currentPage > 0) { clearVisualFields(); currentPage--; await renderPage(); await detectFields(); } });
    $("#nextP", el).addEventListener("click", async () => { if (currentPage < totalPages - 1) { clearVisualFields(); currentPage++; await renderPage(); await detectFields(); } });

    /* --- Field detection using pdf.js text extraction --- */
    async function detectFields() {
      showLoading("Detecting form fields\u2026");
      try {
        const pg = await pdfJsDoc.getPage(currentPage + 1);
        const textContent = await pg.getTextContent();
        const vp = pg.getViewport({ scale: SCALE });
        const c = canvas();
        const displayScale = c.clientWidth / c.width;

        const items = textContent.items.filter((it) => it.str !== undefined);
        if (items.length < 3) {
          await detectFieldsOCR();
          return;
        }

        const pageW = vp.width * displayScale;

        const lineGroups = {};
        for (const item of items) {
          const tx = pdfjsLib.Util.transform(vp.transform, item.transform);
          const x = tx[4] * displayScale;
          const y = tx[5] * displayScale;
          const w = item.width * SCALE * displayScale;
          const h = item.height * SCALE * displayScale;
          const lineKey = Math.round(y / 6);
          if (!lineGroups[lineKey]) lineGroups[lineKey] = [];
          lineGroups[lineKey].push({ str: item.str, x, y, w, h });
        }

        let fieldsPlaced = 0;
        const margin = 30 * displayScale;

        for (const key of Object.keys(lineGroups).sort((a, b) => a - b)) {
          const lineItems = lineGroups[key].sort((a, b) => a.x - b.x);
          if (!lineItems.length) continue;

          const lastItem = lineItems[lineItems.length - 1];
          const lineEndX = lastItem.x + lastItem.w;
          const lineY = lineItems[0].y;
          const lineH = Math.max(...lineItems.map((it) => it.h), 14 * displayScale);

          const hasUnderscore = lineItems.some((it) => /_{2,}|—{2,}|-{3,}/.test(it.str));
          const labelText = lineItems.map((it) => it.str).join("").replace(/[_\-—]+/g, "").trim();

          if (hasUnderscore) {
            let fieldStartX = lineItems[0].x;
            for (const it of lineItems) {
              if (/_{2,}|—{2,}|-{3,}/.test(it.str)) { fieldStartX = it.x; break; }
            }
            const fieldW = Math.max(lineEndX - fieldStartX, 60 * displayScale);
            const placeholder = labelText.replace(/[:\s]+$/, "").split(/\s+/).slice(-3).join(" ");
            addVisualField(fieldStartX, lineY - lineH + 2, Math.min(fieldW, pageW - fieldStartX - 4), lineH, placeholder);
            fieldsPlaced++;
          } else if (lineEndX < pageW - margin * 2 && labelText.length > 0 && labelText.length < 60) {
            const gapW = pageW - lineEndX - margin;
            if (gapW > 80 * displayScale) {
              const placeholder = labelText.replace(/[:\s]+$/, "").split(/\s+/).slice(-3).join(" ");
              addVisualField(lineEndX + 4, lineY - lineH + 2, gapW, lineH, placeholder);
              fieldsPlaced++;
            }
          }
        }

        if (fieldsPlaced === 0) {
          toast("No fields auto-detected \u2014 click on the form to add fields", "info");
        } else {
          toast(`Placed ${fieldsPlaced} field${fieldsPlaced > 1 ? "s" : ""} \u2014 click the form to add more`, "success");
        }
      } catch (e) {
        toast("Detection failed \u2014 click on the form to add fields manually", "info");
      } finally { hideLoading(); }
    }

    /* --- Fallback: OCR for scanned documents --- */
    async function detectFieldsOCR() {
      try {
        const c = canvas();
        const worker = await Tesseract.createWorker("eng");
        const { data } = await worker.recognize(c.toDataURL());
        await worker.terminate();

        const lines = data.lines || [];
        const displayScale = c.clientWidth / c.width;

        for (const line of lines) {
          const text = line.text.trim();
          const bbox = line.bbox;
          if (!text || !bbox) continue;
          if (/_{3,}|—{2,}|-{4,}/.test(text)) {
            const label = text.replace(/[_\-—]+/g, "").replace(/[:\s]+$/, "").trim();
            const fieldX = bbox.x0 * displayScale;
            const fieldY = bbox.y0 * displayScale;
            const fieldW = (bbox.x1 - bbox.x0) * displayScale;
            const fieldH = (bbox.y1 - bbox.y0) * displayScale;
            if (fieldW > 20) {
              addVisualField(fieldX, fieldY, Math.min(fieldW, c.clientWidth - fieldX - 4), fieldH + 2, label.split(/\s+/).slice(-3).join(" "));
            }
          }
        }

        if (visualFields.length === 0) {
          toast("No fields auto-detected \u2014 click on the form to add fields", "info");
        } else {
          toast(`Placed ${visualFields.length} field${visualFields.length > 1 ? "s" : ""} \u2014 click the form to add more`, "success");
        }
      } catch (e) {
        toast("Click on the form where you want to type", "info");
      }
    }

    /* --- Click-to-place on the canvas --- */
    function onCanvasClick(e) {
      const c = canvas();
      if (e.target !== c) return;
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const fontSize = parseInt($("#ffSize", el).value) || 11;
      const vfs = fontSize * c.clientWidth * SCALE / c.width;
      const fieldW = Math.min(c.clientWidth * 0.4, c.clientWidth - x - 8);
      const fieldH = vfs + 8;
      addVisualField(x, y - fieldH / 2, Math.max(fieldW, 80), fieldH, "");
    }

    $("#addFieldBtn", el).addEventListener("click", () => {
      const p = pvw();
      const c = canvas();
      const fontSize = parseInt($("#ffSize", el).value) || 11;
      const vfs = fontSize * c.clientWidth * SCALE / c.width;
      const w = Math.min(c.clientWidth * 0.5, 250);
      const h = vfs + 8;
      const x = (p.clientWidth - w) / 2;
      const y = 60 + visualFields.length * (h + 8);
      addVisualField(x, Math.min(y, p.clientHeight - h - 10), w, h, "");
    });

    function getPtr(e) {
      if (e.touches && e.touches.length) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      return { x: e.clientX, y: e.clientY };
    }

    let activeDrag = null;

    function addVisualField(x, y, w, h, placeholder) {
      const id = nextFieldId++;
      const field = document.createElement("div");
      field.className = "ff-field";
      field.innerHTML = `<div class="ff-grip"></div><input type="text" class="ff-input" spellcheck="false"><button class="ff-del"><i data-lucide="x"></i></button>`;
      Object.assign(field.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });

      const inp = field.querySelector(".ff-input");
      if (placeholder) inp.placeholder = placeholder;
      const fontSize = parseInt($("#ffSize", el).value) || 11;
      const c = canvas();
      const vfs = fontSize * c.clientWidth * SCALE / c.width;
      inp.style.fontSize = vfs + "px";

      pvw().appendChild(field);
      lucide.createIcons();

      const vf = { id, el: field, inp };
      visualFields.push(vf);
      inp.focus();

      field.querySelector(".ff-del").addEventListener("click", (e) => {
        e.stopPropagation();
        field.remove();
        const idx = visualFields.indexOf(vf);
        if (idx >= 0) visualFields.splice(idx, 1);
      });

      const grip = field.querySelector(".ff-grip");
      function gripDown(e) {
        const ptr = getPtr(e);
        const r = field.getBoundingClientRect();
        activeDrag = { vf, el: field, ox: ptr.x - r.left, oy: ptr.y - r.top };
        e.preventDefault();
        e.stopPropagation();
      }
      grip.addEventListener("mousedown", gripDown);
      grip.addEventListener("touchstart", gripDown, { passive: false });
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);

    function onMove(e) {
      if (!activeDrag) return;
      e.preventDefault();
      const ptr = getPtr(e);
      const p = pvw();
      const cr = p.getBoundingClientRect();
      let nx = ptr.x - cr.left - activeDrag.ox;
      let ny = ptr.y - cr.top - activeDrag.oy;
      nx = Math.max(0, Math.min(nx, p.clientWidth - activeDrag.el.offsetWidth));
      ny = Math.max(0, Math.min(ny, p.clientHeight - activeDrag.el.offsetHeight));
      activeDrag.el.style.left = nx + "px";
      activeDrag.el.style.top = ny + "px";
    }

    function onUp() { activeDrag = null; }

    /* --- Apply visual fields --- */
    $("#visualGo", el).addEventListener("click", async () => {
      const filled = visualFields.filter((vf) => vf.inp.value.trim());
      if (!filled.length) { toast("Fill in at least one field", "error"); return; }
      showLoading("Applying text\u2026");
      try {
        const doc = await PDFDocument.load(pdfBytes);
        const page = doc.getPage(currentPage);
        const { width: pgW, height: pgH } = page.getSize();
        const c = canvas();
        const sx = pgW / c.clientWidth;
        const sy = pgH / c.clientHeight;
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pdfFontSize = parseInt($("#ffSize", el).value) || 11;
        const pvwRect = pvw().getBoundingClientRect();

        for (const vf of filled) {
          const text = vf.inp.value.trim();
          const inpRect = vf.inp.getBoundingClientRect();
          const textX = (inpRect.left - pvwRect.left) * sx;
          const textY = (inpRect.top - pvwRect.top) * sy;
          const pdfY = pgH - textY - pdfFontSize * 0.85;
          page.drawText(sanitizeForPdf(text), { x: textX, y: pdfY, size: pdfFontSize, font, color: rgb(0.05, 0.05, 0.05) });
        }

        const defName = pdfFile.name.replace(/\.pdf$/i, "_filled.pdf");
        const outName = getOutputName(el, defName);
        await savePdf(await doc.save(), outName.endsWith(".pdf") ? outName : outName + ".pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
  }

  /* ================================================
     Workbench — unified PDF editor flow
  ================================================ */
  async function thumbFromPdfPage(pdfJsDoc, pageNum, scale) {
    const pg = await pdfJsDoc.getPage(pageNum);
    const vp = pg.getViewport({ scale: scale || 0.35 });
    const c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    return c.toDataURL("image/jpeg", 0.75);
  }

  async function pagesFromPdfFile(file, docIdx, nextId) {
    const bytes = await readFile(file);
    const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const entries = [];
    let id = nextId;
    for (let i = 0; i < pdfJsDoc.numPages; i++) {
      const thumb = await thumbFromPdfPage(pdfJsDoc, i + 1);
      entries.push({ id: id++, docIdx, pageIdx: i, thumb });
    }
    return { bytes, entries, nextId: id };
  }

  function renderWorkbench(el, initialFiles, startMode) {
    let docs = [];
    let pages = [];
    let nextPageId = 1;
    let mode = startMode || "browse";
    const keepSelected = new Set();
    const annotations = { signatures: [], textboxes: [] };
    let panelPageId = null;
    let panelPdfJs = null;
    let panelPageIdx = 0;
    const PANEL_SCALE = 1.5;

    el.innerHTML = `
      <div class="workbench">
        <div class="workbench-top hidden" id="wbTop">
          <button class="btn btn-outline btn-lg" id="wbPreview"><i data-lucide="eye"></i>Preview</button>
          <button class="btn btn-primary btn-lg" id="wbDone"><i data-lucide="download"></i>Done, download my PDF</button>
        </div>
        <div id="wbEmpty">
          <div id="wbDz"></div>
        </div>
        <div id="wbLoaded" class="hidden">
          <div class="wb-actions" id="wbActions">
            <button class="wb-action" data-mode="keep"><i data-lucide="file-output"></i>Keep pages</button>
            <button class="wb-action" data-mode="sign"><i data-lucide="pen-tool"></i>Sign</button>
            <button class="wb-action" data-mode="text"><i data-lucide="type"></i>Add text</button>
            <button class="wb-action" data-mode="append"><i data-lucide="file-plus-2"></i>Add another PDF</button>
          </div>
          <p class="wb-hint" id="wbHint"></p>
          <div id="wbGrid" class="page-grid"></div>
          <div id="wbOnameWrap" class="wb-oname-wrap"></div>
          <input type="file" id="wbAppendIn" accept=".pdf" multiple class="hidden">
        </div>
        <div id="wbPanelOv" class="overlay hidden">
          <div id="wbPanel" class="wb-modal">
            <div class="wb-panel-head">
              <span id="wbPanelTitle"></span>
              <button class="btn-icon" id="wbPanelBack" aria-label="Close"><i data-lucide="x"></i></button>
            </div>
            <div class="wb-panel-body" id="wbPanelBody"></div>
          </div>
        </div>
      </div>
      <div id="wbPreviewOv" class="overlay hidden">
        <div class="preview-modal">
          <div class="preview-head">
            <span>Preview</span>
            <div class="preview-head-actions">
              <button class="btn btn-ghost btn-sm" id="wbPreviewOpen"><i data-lucide="external-link"></i>Open in new tab</button>
              <button class="btn-icon" id="wbPreviewClose" aria-label="Close preview"><i data-lucide="x"></i></button>
            </div>
          </div>
          <iframe id="wbPreviewFrame" title="PDF preview"></iframe>
          <div class="preview-foot">
            <button class="btn btn-ghost" id="wbPreviewBack"><i data-lucide="arrow-left"></i>Back to editor</button>
            <button class="btn btn-primary" id="wbPreviewDownload"><i data-lucide="download"></i>Download my PDF</button>
          </div>
        </div>
      </div>`;

    const wbEmpty = $("#wbEmpty", el);
    const wbLoaded = $("#wbLoaded", el);
    const wbGrid = $("#wbGrid", el);
    const wbHint = $("#wbHint", el);
    const wbPanelOv = $("#wbPanelOv", el);
    const wbPanel = $("#wbPanel", el);
    const wbPanelBody = $("#wbPanelBody", el);
    const wbAppendIn = $("#wbAppendIn", el);

    wbPanelOv.addEventListener("click", (e) => { if (e.target === wbPanelOv) closePanel(); });

    $("#wbDz", el).appendChild(makeDropZone({
      accept: ".pdf",
      label: "Drop your PDF here, or click to choose a file",
      onFiles: (f) => loadPdfs(f.filter((x) => x.name.toLowerCase().endsWith(".pdf"))),
    }));

    $("#wbDone", el).addEventListener("click", downloadPdf);
    $("#wbPreview", el).addEventListener("click", openPreview);
    $("#wbPanelBack", el).addEventListener("click", closePanel);

    const previewOv = $("#wbPreviewOv", el);
    const previewFrame = $("#wbPreviewFrame", el);
    let previewUrl = null;
    function closePreview() {
      previewOv.classList.add("hidden");
      previewFrame.src = "about:blank";
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
    }
    $("#wbPreviewClose", el).addEventListener("click", closePreview);
    $("#wbPreviewBack", el).addEventListener("click", closePreview);
    $("#wbPreviewDownload", el).addEventListener("click", () => { closePreview(); downloadPdf(); });
    $("#wbPreviewOpen", el).addEventListener("click", () => {
      if (previewUrl) window.open(previewUrl, "_blank", "noopener");
    });
    previewOv.addEventListener("click", (e) => { if (e.target === previewOv) closePreview(); });

    $("#wbActions", el).querySelectorAll(".wb-action").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.dataset.mode;
        if (m === "append") { wbAppendIn.click(); return; }
        if (mode === m) setMode("browse");
        else setMode(m);
      });
    });

    wbAppendIn.addEventListener("change", () => {
      if (wbAppendIn.files.length) loadPdfs([...wbAppendIn.files], true);
      wbAppendIn.value = "";
    });

    if (initialFiles?.length) loadPdfs(initialFiles);

    async function loadPdfs(fileList, append) {
      if (!fileList.length) { toast("Choose a PDF file", "error"); return; }
      showLoading("Loading PDF\u2026");
      try {
        if (!append) { docs = []; pages = []; nextPageId = 1; keepSelected.clear(); }
        let totalNew = 0;
        for (const f of fileList) {
          const docIdx = docs.length;
          const { bytes, entries, nextId } = await pagesFromPdfFile(f, docIdx, nextPageId);
          docs.push({ name: f.name, bytes });
          for (let i = 0; i < entries.length; i++) {
            $("#loading-text").textContent = `Loading ${f.name} \u2014 page ${i + 1} / ${entries.length}\u2026`;
            pages.push(entries[i]);
          }
          nextPageId = nextId;
          totalNew += entries.length;
        }
        wbEmpty.classList.add("hidden");
        wbLoaded.classList.remove("hidden");
        $("#wbTop", el).classList.remove("hidden");
        closePanel();
        if (!append) {
          const wrap = $("#wbOnameWrap", el);
          wrap.innerHTML = "";
          const baseName = (docs[0]?.name || "document").replace(/\.pdf$/i, "");
          wrap.appendChild(makeOutputName(baseName + "_edited.pdf"));
          setMode(startMode || "browse");
        }
        else { toast(`Added ${totalNew} page${totalNew === 1 ? "" : "s"}`, "success"); renderGrid(); }
        lucide.createIcons();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    function setMode(m) {
      mode = m;
      keepSelected.clear();
      closePanel();
      $("#wbActions", el).querySelectorAll(".wb-action").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === m);
      });
      updateHint();
      renderGrid();
    }

    function updateHint() {
      const count = `${pages.length} page${pages.length === 1 ? "" : "s"}`;
      const hints = {
        browse: `${count} \u2022 drag to reorder \u2022 hover a page and click \u2715 to delete`,
        keep: "Tap pages to keep, then confirm",
        sign: "Tap the page you want to sign",
        text: "Tap the page where you want text",
      };
      let html = hints[mode] || hints.browse;
      if (mode === "keep") {
        html += `<span class="wb-hint-action"><button class="btn btn-secondary btn-sm" id="wbKeepBtn" ${keepSelected.size ? "" : "disabled"}>Keep only selected</button></span>`;
      }
      wbHint.innerHTML = html;
      const keepBtn = $("#wbKeepBtn", wbHint);
      if (keepBtn) keepBtn.addEventListener("click", applyKeep);
    }

    function applyKeep() {
      if (!keepSelected.size) return;
      pages = pages.filter((p) => keepSelected.has(p.id));
      keepSelected.clear();
      setMode("browse");
      toast("Pages updated", "success");
    }

    function closePanel() {
      panelPageId = null;
      panelPdfJs = null;
      wbPanelOv.classList.add("hidden");
      document.body.classList.remove("wb-modal-open");
      wbPanelBody.innerHTML = "";
    }

    function pageLabel(p) {
      const slot = pages.indexOf(p) + 1;
      return `Page ${slot}`;
    }

    function renderGrid() {
      if (!pages.length) {
        wbLoaded.classList.add("hidden");
        wbEmpty.classList.remove("hidden");
        $("#wbTop", el).classList.add("hidden");
        return;
      }
      updateHint();

      wbGrid.innerHTML = pages.map((p, i) => {
        const selected = keepSelected.has(p.id);
        const hasSig = annotations.signatures.some((s) => s.pageId === p.id);
        const hasTxt = annotations.textboxes.some((t) => t.pageId === p.id);
        const badges = (hasSig ? '<span class="page-tile-badge" title="Signed">\u270E</span>' : "")
          + (hasTxt ? '<span class="page-tile-badge" title="Has text">T</span>' : "");
        return `
        <div class="page-tile${mode === "keep" ? " mode-keep" : ""}${mode === "sign" ? " mode-sign" : ""}${mode === "text" ? " mode-text" : ""}${selected ? " page-tile-selected" : ""}"
          draggable="true" data-i="${i}" data-id="${p.id}">
          <div class="page-tile-grip" aria-label="Drag"><i data-lucide="grip-horizontal"></i></div>
          <button class="page-tile-del" data-i="${i}" aria-label="Delete page" title="Delete page"><i data-lucide="x"></i></button>
          ${badges ? `<div class="page-tile-badges">${badges}</div>` : ""}
          <div class="page-tile-img"><img src="${p.thumb}" alt="Page ${i + 1}" draggable="false"></div>
          <div class="page-tile-foot">
            <span class="page-tile-num">${i + 1}</span>
          </div>
        </div>`;
      }).join("");

      wbGrid.querySelectorAll(".page-tile-del").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = +b.dataset.i;
          const p = pages[idx];
          keepSelected.delete(p.id);
          annotations.signatures = annotations.signatures.filter((s) => s.pageId !== p.id);
          annotations.textboxes = annotations.textboxes.filter((t) => t.pageId !== p.id);
          pages.splice(idx, 1);
          renderGrid();
        });
        b.addEventListener("dragstart", (e) => e.preventDefault());
      });

      if (mode === "keep" || mode === "sign" || mode === "text") {
        wbGrid.querySelectorAll(".page-tile").forEach((tile) => {
          tile.addEventListener("click", (e) => {
            if (e.target.closest(".page-tile-del") || e.target.closest(".page-tile-grip")) return;
            const p = pages[+tile.dataset.i];
            if (mode === "keep") {
              if (keepSelected.has(p.id)) keepSelected.delete(p.id);
              else keepSelected.add(p.id);
              renderGrid();
            } else {
              openPagePanel(p, mode);
            }
          });
        });
      }

      bindGridDrag(wbGrid);
      lucide.createIcons();
    }

    function bindGridDrag(grid) {
      let dragI = null;
      grid.querySelectorAll(".page-tile").forEach((tile) => {
        tile.addEventListener("dragstart", (e) => {
          dragI = +tile.dataset.i;
          tile.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
        });
        tile.addEventListener("dragend", () => tile.classList.remove("dragging"));
        tile.addEventListener("dragover", (e) => { e.preventDefault(); tile.classList.add("drag-target"); });
        tile.addEventListener("dragleave", () => tile.classList.remove("drag-target"));
        tile.addEventListener("drop", (e) => {
          e.preventDefault();
          tile.classList.remove("drag-target");
          const j = +tile.dataset.i;
          if (dragI !== null && dragI !== j) {
            const [m] = pages.splice(dragI, 1);
            pages.splice(j, 0, m);
            renderGrid();
          }
          dragI = null;
        });
      });

      let touchDragI = null, touchClone = null, touchTargetI = null;
      grid.querySelectorAll(".page-tile-grip").forEach((grip) => {
        grip.addEventListener("touchstart", (e) => {
          e.preventDefault();
          const tile = grip.closest(".page-tile");
          touchDragI = +tile.dataset.i;
          touchTargetI = null;
          tile.classList.add("dragging");
          touchClone = tile.cloneNode(true);
          touchClone.classList.add("page-tile-ghost");
          const rect = tile.getBoundingClientRect();
          touchClone.style.width = rect.width + "px";
          touchClone.style.left = rect.left + "px";
          touchClone.style.top = rect.top + "px";
          document.body.appendChild(touchClone);
        }, { passive: false });
      });
      grid.addEventListener("touchmove", (e) => {
        if (touchDragI === null) return;
        e.preventDefault();
        const touch = e.touches[0];
        if (touchClone) {
          touchClone.style.left = (touch.clientX - touchClone.offsetWidth / 2) + "px";
          touchClone.style.top = (touch.clientY - 30) + "px";
        }
        grid.querySelectorAll(".page-tile").forEach((t) => t.classList.remove("drag-target"));
        touchTargetI = null;
        if (touchClone) touchClone.style.pointerEvents = "none";
        const hit = document.elementFromPoint(touch.clientX, touch.clientY);
        if (touchClone) touchClone.style.pointerEvents = "";
        if (hit) {
          const ti = hit.closest(".page-tile");
          if (ti && +ti.dataset.i !== touchDragI) {
            ti.classList.add("drag-target");
            touchTargetI = +ti.dataset.i;
          }
        }
      }, { passive: false });
      const touchEnd = () => {
        if (touchDragI === null) return;
        if (touchClone) { touchClone.remove(); touchClone = null; }
        grid.querySelectorAll(".page-tile").forEach((t) => t.classList.remove("dragging", "drag-target"));
        if (touchTargetI !== null && touchTargetI !== touchDragI) {
          const [m] = pages.splice(touchDragI, 1);
          pages.splice(touchTargetI, 0, m);
        }
        touchDragI = null;
        touchTargetI = null;
        renderGrid();
      };
      grid.addEventListener("touchend", touchEnd, { passive: false });
      grid.addEventListener("touchcancel", touchEnd, { passive: false });
    }

    async function openPagePanel(pageEntry, panelMode) {
      panelPageId = pageEntry.id;
      panelPageIdx = pageEntry.pageIdx;
      $("#wbPanelTitle", el).textContent = pageLabel(pageEntry) + (panelMode === "sign" ? " \u2014 Sign" : " \u2014 Add text");
      wbPanelBody.innerHTML = `<div class="spinner" style="margin:2rem auto"></div>`;
      wbPanelOv.classList.remove("hidden");
      document.body.classList.add("wb-modal-open");
      wbPanelBody.scrollTop = 0;
      showLoading("Loading page\u2026");
      try {
        const docBytes = docs[pageEntry.docIdx].bytes;
        panelPdfJs = await pdfjsLib.getDocument({ data: docBytes.slice() }).promise;
        hideLoading();
        if (panelMode === "sign") renderSignPanel(pageEntry);
        else renderTextPanel(pageEntry);
        lucide.createIcons();
      } catch (e) {
        hideLoading();
        toast("Error: " + e.message, "error");
        closePanel();
      }
    }

    function renderSignPanel(pageEntry) {
      let sigDataUrl = null;
      let sigPos = { x: 60, y: 60, w: 180, h: 65 };

      wbPanelBody.innerHTML = `
        <div class="wb-panel-tools">
          <button class="btn btn-secondary btn-sm" id="wbSigDraw"><i data-lucide="pen-tool"></i>Draw</button>
          <button class="btn btn-secondary btn-sm" id="wbSigType"><i data-lucide="type"></i>Type</button>
        </div>
        <div id="wbTypeSig" class="sig-type-panel hidden">
          <input type="text" id="wbSigText" class="input" placeholder="Type your name\u2026" autocomplete="off">
          <div class="sig-font-options">
            <button class="sig-font-btn active" data-font="'Great Vibes', cursive">Elegant</button>
            <button class="sig-font-btn" data-font="'Dancing Script', cursive">Flowing</button>
            <button class="sig-font-btn" data-font="'Caveat', cursive">Casual</button>
          </div>
          <button class="btn btn-primary btn-sm" id="wbSigTypeUse" disabled>Use signature</button>
        </div>
        <div class="pdf-preview-wrap" id="wbSigPvw">
          <canvas id="wbSigCanvas"></canvas>
          <div id="wbSigOv" class="sig-overlay hidden"><img id="wbSigImg" src="" alt=""><div class="resize-h" id="wbSigRz"></div></div>
        </div>
        <div class="wb-panel-foot">
          <button class="btn btn-primary" id="wbSigSave" disabled>Save on this page</button>
        </div>`;

      const pvw = $("#wbSigPvw", wbPanelBody);
      const canvas = $("#wbSigCanvas", wbPanelBody);
      const sigOv = $("#wbSigOv", wbPanelBody);
      const sigImg = $("#wbSigImg", wbPanelBody);

      (async () => {
        const pg = await panelPdfJs.getPage(panelPageIdx + 1);
        const vp = pg.getViewport({ scale: PANEL_SCALE });
        canvas.width = vp.width;
        canvas.height = vp.height;
        await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      })();

      $("#wbSigDraw", wbPanelBody).addEventListener("click", () => {
        const modal = $("#sig-modal");
        const cv = $("#sig-canvas");
        const ctx = cv.getContext("2d");
        ctx.clearRect(0, 0, cv.width, cv.height);
        let drawing = false;
        const pos = (e) => {
          const r = cv.getBoundingClientRect();
          const t = e.touches ? e.touches[0] : e;
          return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
        };
        const down = (e) => { drawing = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
        const move = (e) => {
          if (!drawing) return;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = "#1E293B";
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.stroke();
        };
        const up = () => { drawing = false; };
        cv.onmousedown = down; cv.onmousemove = move; cv.onmouseup = up; cv.onmouseleave = up;
        cv.ontouchstart = (e) => { e.preventDefault(); down(e); };
        cv.ontouchmove = (e) => { e.preventDefault(); move(e); };
        cv.ontouchend = (e) => { e.preventDefault(); up(); };
        modal.classList.remove("hidden");
        $("#sig-clear").onclick = () => ctx.clearRect(0, 0, cv.width, cv.height);
        $("#sig-save").onclick = () => {
          sigDataUrl = cv.toDataURL("image/png");
          modal.classList.add("hidden");
          sigImg.src = sigDataUrl;
          sigOv.classList.remove("hidden");
          Object.assign(sigOv.style, { left: sigPos.x + "px", top: sigPos.y + "px", width: sigPos.w + "px", height: sigPos.h + "px" });
          $("#wbSigSave", wbPanelBody).disabled = false;
        };
        $("#sig-modal-close").onclick = () => modal.classList.add("hidden");
      });

      let typedFont = "'Great Vibes', cursive";
      const typePanel = $("#wbTypeSig", wbPanelBody);
      $("#wbSigType", wbPanelBody).addEventListener("click", () => typePanel.classList.toggle("hidden"));

      $("#wbSigText", wbPanelBody).addEventListener("input", () => {
        $("#wbSigTypeUse", wbPanelBody).disabled = !$("#wbSigText", wbPanelBody).value.trim();
      });

      typePanel.querySelectorAll(".sig-font-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          typePanel.querySelectorAll(".sig-font-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          typedFont = btn.dataset.font;
        });
      });

      $("#wbSigTypeUse", wbPanelBody).addEventListener("click", () => {
        const text = $("#wbSigText", wbPanelBody).value.trim();
        if (!text) return;
        const fontSize = 64;
        const c = document.createElement("canvas");
        const ctx2 = c.getContext("2d");
        ctx2.font = `${fontSize}px ${typedFont}`;
        const w = Math.ceil(ctx2.measureText(text).width) + 24;
        const h = Math.ceil(fontSize * 1.6);
        c.width = w; c.height = h;
        ctx2.font = `${fontSize}px ${typedFont}`;
        ctx2.fillStyle = "#1E293B";
        ctx2.textBaseline = "middle";
        ctx2.fillText(text, 12, h / 2);
        sigDataUrl = c.toDataURL("image/png");
        typePanel.classList.add("hidden");
        sigImg.src = sigDataUrl;
        sigOv.classList.remove("hidden");
        sigPos.w = Math.min(w * 0.55, pvw.clientWidth * 0.45);
        sigPos.h = sigPos.w * (h / w);
        Object.assign(sigOv.style, { left: sigPos.x + "px", top: sigPos.y + "px", width: sigPos.w + "px", height: sigPos.h + "px" });
        $("#wbSigSave", wbPanelBody).disabled = false;
      });

      let dragging = false, resizing = false, dOff = {}, rStart = {};
      const getPtr = (e) => e.touches?.length ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
      sigOv.addEventListener("mousedown", (e) => {
        if (e.target.id === "wbSigRz") return;
        dragging = true;
        const ptr = getPtr(e);
        const r = sigOv.getBoundingClientRect();
        dOff = { x: ptr.x - r.left, y: ptr.y - r.top };
        e.preventDefault();
      });
      $("#wbSigRz", wbPanelBody).addEventListener("mousedown", (e) => {
        resizing = true;
        const ptr = getPtr(e);
        rStart = { x: ptr.x, w: sigOv.offsetWidth, h: sigOv.offsetHeight };
        e.stopPropagation(); e.preventDefault();
      });
      const onMove = (e) => {
        if (!dragging && !resizing) return;
        e.preventDefault();
        const ptr = getPtr(e);
        if (dragging) {
          const cr = pvw.getBoundingClientRect();
          let x = Math.max(0, Math.min(ptr.x - cr.left - dOff.x, pvw.clientWidth - sigOv.offsetWidth));
          let y = Math.max(0, Math.min(ptr.y - cr.top - dOff.y, pvw.clientHeight - sigOv.offsetHeight));
          sigOv.style.left = x + "px"; sigOv.style.top = y + "px";
          sigPos.x = x; sigPos.y = y;
        }
        if (resizing) {
          const nw = Math.max(50, rStart.w + (ptr.x - rStart.x));
          sigOv.style.width = nw + "px";
          sigOv.style.height = (nw * (rStart.h / rStart.w)) + "px";
          sigPos.w = nw; sigPos.h = nw * (rStart.h / rStart.w);
        }
      };
      const onUp = () => { dragging = false; resizing = false; };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);

      $("#wbSigSave", wbPanelBody).addEventListener("click", async () => {
        if (!sigDataUrl) return;
        await canvasReady(canvas);
        const pg = await panelPdfJs.getPage(panelPageIdx + 1);
        const vp = pg.getViewport({ scale: 1 });
        const sx = vp.width / canvas.clientWidth;
        const sy = vp.height / canvas.clientHeight;
        annotations.signatures = annotations.signatures.filter((s) => s.pageId !== pageEntry.id);
        annotations.signatures.push({
          pageId: pageEntry.id,
          dataUrl: sigDataUrl,
          x: sigPos.x * sx,
          y: vp.height - (sigPos.y + sigPos.h) * sy,
          w: sigPos.w * sx,
          h: sigPos.h * sy,
        });
        toast("Signature saved", "success");
        closePanel();
        setMode("browse");
        renderGrid();
      });
    }

    async function canvasReady(canvas) {
      if (canvas.width) return;
      await new Promise((r) => setTimeout(r, 200));
    }

    function renderTextPanel(pageEntry) {
      const textboxes = [];
      wbPanelBody.innerHTML = `
        <div class="wb-panel-tools">
          <button class="btn btn-secondary btn-sm" id="wbAddTb"><i data-lucide="plus"></i>Add text box</button>
          <div class="form-group-inline"><label>Size</label><input type="number" id="wbTbSize" class="input input-sm" value="14" min="6" max="120"></div>
          <div class="form-group-inline"><label>Color</label><input type="color" id="wbTbColor" class="input-color" value="#000000"></div>
        </div>
        <div class="pdf-preview-wrap" id="wbTextPvw"><canvas id="wbTextCanvas"></canvas></div>
        <div class="wb-panel-foot">
          <button class="btn btn-primary" id="wbTextSave" disabled>Save on this page</button>
        </div>`;

      const pvw = $("#wbTextPvw", wbPanelBody);
      const canvas = $("#wbTextCanvas", wbPanelBody);

      (async () => {
        const pg = await panelPdfJs.getPage(panelPageIdx + 1);
        const vp = pg.getViewport({ scale: PANEL_SCALE });
        canvas.width = vp.width;
        canvas.height = vp.height;
        await pg.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      })();

      const visFontSize = (pdfPt) => pdfPt * canvas.clientWidth * PANEL_SCALE / canvas.width;

      function createTb(x, y, w, h) {
        const fontSize = parseInt($("#wbTbSize", wbPanelBody).value) || 14;
        const color = $("#wbTbColor", wbPanelBody).value;
        const box = document.createElement("div");
        box.className = "text-overlay";
        box.innerHTML = `<div class="text-ov-grip"><i data-lucide="grip-horizontal"></i></div><textarea class="text-ov-input" spellcheck="false" placeholder="Type\u2026"></textarea><button class="text-ov-del"><i data-lucide="x"></i></button><div class="resize-h"></div>`;
        Object.assign(box.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });
        const ta = box.querySelector(".text-ov-input");
        const vfs = visFontSize(fontSize);
        ta.style.fontSize = vfs + "px";
        ta.style.lineHeight = (vfs * 1.35) + "px";
        ta.style.color = color;
        pvw.appendChild(box);
        lucide.createIcons();
        const tb = { el: box, ta, fontSize, color };
        textboxes.push(tb);
        ta.focus();
        $("#wbTextSave", wbPanelBody).disabled = false;
        box.querySelector(".text-ov-del").addEventListener("click", (e) => {
          e.stopPropagation();
          box.remove();
          const idx = textboxes.indexOf(tb);
          if (idx >= 0) textboxes.splice(idx, 1);
          if (!textboxes.length) $("#wbTextSave", wbPanelBody).disabled = true;
        });
        let activeDrag = null, activeResize = null;
        const getPtr = (e) => e.touches?.length ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        box.querySelector(".text-ov-grip").addEventListener("mousedown", (e) => {
          const ptr = getPtr(e);
          const r = box.getBoundingClientRect();
          activeDrag = { tb, ox: ptr.x - r.left, oy: ptr.y - r.top };
          e.preventDefault();
        });
        box.querySelector(".resize-h").addEventListener("mousedown", (e) => {
          const ptr = getPtr(e);
          activeResize = { tb, sx: ptr.x, sy: ptr.y, sw: box.offsetWidth, sh: box.offsetHeight };
          e.preventDefault();
        });
        const onMove = (e) => {
          if (activeDrag) {
            const ptr = getPtr(e);
            const cr = pvw.getBoundingClientRect();
            let nx = Math.max(0, Math.min(ptr.x - cr.left - activeDrag.ox, pvw.clientWidth - activeDrag.tb.el.offsetWidth));
            let ny = Math.max(0, Math.min(ptr.y - cr.top - activeDrag.oy, pvw.clientHeight - activeDrag.tb.el.offsetHeight));
            activeDrag.tb.el.style.left = nx + "px";
            activeDrag.tb.el.style.top = ny + "px";
          }
          if (activeResize) {
            const ptr = getPtr(e);
            activeResize.tb.el.style.width = Math.max(40, activeResize.sw + (ptr.x - activeResize.sx)) + "px";
            activeResize.tb.el.style.height = Math.max(20, activeResize.sh + (ptr.y - activeResize.sy)) + "px";
          }
        };
        const onUp = () => { activeDrag = null; activeResize = null; };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      }

      $("#wbAddTb", wbPanelBody).addEventListener("click", () => {
        const w = Math.min(200, pvw.clientWidth * 0.55);
        const h = Math.max(40, Math.min(80, pvw.clientHeight * 0.12));
        createTb((pvw.clientWidth - w) / 2, pvw.clientHeight / 3, w, h);
      });

      $("#wbTextSave", wbPanelBody).addEventListener("click", async () => {
        const filled = textboxes.filter((tb) => tb.ta.value.trim());
        if (!filled.length) { toast("Enter some text first", "error"); return; }
        await canvasReady(canvas);
        const pg = await panelPdfJs.getPage(panelPageIdx + 1);
        const vp = pg.getViewport({ scale: 1 });
        const sx = vp.width / canvas.clientWidth;
        const sy = vp.height / canvas.clientHeight;
        const pvwRect = pvw.getBoundingClientRect();
        annotations.textboxes = annotations.textboxes.filter((t) => t.pageId !== pageEntry.id);
        for (const tb of filled) {
          const taRect = tb.ta.getBoundingClientRect();
          annotations.textboxes.push({
            pageId: pageEntry.id,
            text: tb.ta.value.trim(),
            x: (taRect.left - pvwRect.left) * sx,
            y: vp.height - (taRect.top - pvwRect.top) * sy - tb.fontSize,
            maxWidth: tb.ta.clientWidth * sx,
            fontSize: tb.fontSize,
            color: tb.color,
          });
        }
        toast("Text saved", "success");
        closePanel();
        setMode("browse");
        renderGrid();
      });
    }

    async function buildPdfBytes() {
      const loaded = [];
      for (const d of docs) loaded.push(await PDFDocument.load(d.bytes));

      const out = await PDFDocument.create();
      for (const p of pages) {
        const [copied] = await out.copyPages(loaded[p.docIdx], [p.pageIdx]);
        out.addPage(copied);
      }

      const font = await out.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < pages.length; i++) {
        const pageId = pages[i].id;
        const page = out.getPage(i);

        for (const sig of annotations.signatures.filter((s) => s.pageId === pageId)) {
          const img = await out.embedPng(dataUrlToBytes(sig.dataUrl));
          page.drawImage(img, { x: sig.x, y: sig.y, width: sig.w, height: sig.h });
        }

        for (const tb of annotations.textboxes.filter((t) => t.pageId === pageId)) {
          const hex = tb.color;
          const color = rgb(
            parseInt(hex.slice(1, 3), 16) / 255,
            parseInt(hex.slice(3, 5), 16) / 255,
            parseInt(hex.slice(5, 7), 16) / 255
          );
          const lineHeight = tb.fontSize * 1.35;
          const words = sanitizeForPdf(tb.text).split(/\s+/);
          let line = "";
          let y = tb.y;
          for (const word of words) {
            const test = line ? line + " " + word : word;
            if (font.widthOfTextAtSize(test, tb.fontSize) > tb.maxWidth && line) {
              page.drawText(line, { x: tb.x, y, size: tb.fontSize, font, color });
              y -= lineHeight;
              line = word;
            } else line = test;
          }
          if (line) page.drawText(line, { x: tb.x, y, size: tb.fontSize, font, color });
        }
      }

      return out.save();
    }

    function outputName() {
      const baseName = (docs[0]?.name || "document").replace(/\.pdf$/i, "");
      const fallback = baseName + "_edited.pdf";
      const chosen = getOutputName(el, fallback);
      return chosen.toLowerCase().endsWith(".pdf") ? chosen : chosen + ".pdf";
    }

    async function openPreview() {
      if (!pages.length) { toast("Add at least one page", "error"); return; }
      showLoading("Building preview\u2026");
      try {
        const bytes = await buildPdfBytes();
        const blob = new Blob([bytes], { type: "application/pdf" });
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(blob);
        previewFrame.src = previewUrl;
        previewOv.classList.remove("hidden");
        lucide.createIcons();
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    async function downloadPdf() {
      if (!pages.length) { toast("Add at least one page", "error"); return; }
      showLoading("Building your PDF\u2026");
      try {
        const bytes = await buildPdfBytes();
        await savePdf(bytes, outputName());
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }
  }

  /* ================================================
     Init
  ================================================ */
  showHome();

  $("#logo").addEventListener("click", (e) => { e.preventDefault(); showHome(); });
})();
