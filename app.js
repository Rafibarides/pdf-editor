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
    { id: "split", icon: "scissors", name: "Split PDF", desc: "Divide a PDF into smaller parts", accent: "pink" },
    { id: "convert", icon: "file-up", name: "Convert to PDF", desc: "Turn images and documents into PDF", accent: "blue" },
    { id: "sign", icon: "pen-tool", name: "Sign PDF", desc: "Add your signature to a document", accent: "pink" },
    { id: "rotate", icon: "rotate-cw", name: "Rotate Pages", desc: "Change page orientation", accent: "blue" },
    { id: "extract", icon: "file-output", name: "Extract Pages", desc: "Pull specific pages from a PDF", accent: "pink" },
    { id: "watermark", icon: "droplets", name: "Add Watermark", desc: "Overlay text across every page", accent: "blue" },
    { id: "pagenums", icon: "hash", name: "Page Numbers", desc: "Add numbering to your pages", accent: "pink" },
  ];

  const RENDERERS = {
    merge: renderMerge,
    split: renderSplit,
    convert: renderConvert,
    sign: renderSign,
    rotate: renderRotate,
    extract: renderExtract,
    watermark: renderWatermark,
    pagenums: renderPageNums,
  };

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
      <div class="hero"></div>
      <div class="tool-grid">${TOOLS.map((t) => `
        <button class="tool-card" data-tool="${t.id}" data-accent="${t.accent}">
          <div class="tool-card-icon"><i data-lucide="${t.icon}"></i></div>
          <h3>${t.name}</h3>
          <p>${t.desc}</p>
        </button>`).join("")}
      </div>`;
    main.querySelectorAll(".tool-card").forEach((c) =>
      c.addEventListener("click", () => navigate(c.dataset.tool))
    );
    lucide.createIcons();
  }

  function showTool(id) {
    const tool = TOOLS.find((t) => t.id === id);
    if (!tool) return;
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
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="layers"></i>Merge</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", multiple: true, label: "Drop PDFs here or click to browse", hint: ".pdf files", onFiles: (f) => { files = files.concat(f.filter((x) => x.name.endsWith(".pdf"))); renderList(); } }));
    $("#out", el).appendChild(makeOutputSel());
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
          <button class="file-remove" data-i="${i}"><i data-lucide="x"></i></button>
        </div>`).join("");

      fl.querySelectorAll(".file-remove").forEach((b) =>
        b.addEventListener("click", () => { files.splice(+b.dataset.i, 1); renderList(); })
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
      lucide.createIcons();
    }

    $("#go", el).addEventListener("click", async () => {
      if (files.length < 2) return;
      showLoading("Merging PDFs\u2026");
      try {
        const merged = await PDFDocument.create();
        for (const f of files) {
          const src = await PDFDocument.load(await readFile(f));
          (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
        }
        await savePdf(await merged.save(), "merged.pdf");
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
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
        await saveZip(zip, `${base}_split.zip`);
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
  }

  /* ================================================
     Tool: Convert to PDF
  ================================================ */
  function renderConvert(el) {
    let files = [], srcType = "image";
    el.innerHTML = `
      <div class="tool-head"><h2>Convert to PDF</h2><p>Turn images and text documents into PDF files.</p></div>
      <div class="form-group"><label>Source type</label>
        <div class="select-wrap"><select id="stype" class="input">
          <option value="image">Images (JPG, PNG, GIF, WEBP, BMP)</option>
          <option value="text">Text files (TXT, CSV)</option>
        </select></div>
      </div>
      <div id="dz"></div>
      <div id="finfo" class="info-panel hidden"><span id="fcnt"></span></div>
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="file-up"></i>Convert</button></div>`;
    $("#out", el).appendChild(makeOutputSel());

    function accepts() { return srcType === "image" ? ".jpg,.jpeg,.png,.gif,.webp,.bmp,.svg" : ".txt,.csv"; }

    function buildDZ() {
      const dz = $("#dz", el);
      dz.innerHTML = "";
      files = [];
      $("#finfo", el).classList.add("hidden");
      $("#go", el).disabled = true;
      dz.appendChild(makeDropZone({
        accept: accepts(), multiple: srcType === "image",
        label: srcType === "image" ? "Drop images here" : "Drop a text file here",
        onFiles: (f) => { files = f; $("#finfo", el).classList.remove("hidden"); $("#fcnt", el).textContent = `${f.length} file${f.length > 1 ? "s" : ""} selected`; $("#go", el).disabled = false; },
      }));
      lucide.createIcons();
    }

    $("#stype", el).addEventListener("change", (e) => { srcType = e.target.value; buildDZ(); });
    buildDZ();

    $("#go", el).addEventListener("click", async () => {
      if (!files.length) return;
      showLoading("Converting\u2026");
      try {
        if (srcType === "image") await convertImages(files);
        else await convertText(files[0]);
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
    lucide.createIcons();
  }

  async function convertImages(imgs) {
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
    const name = imgs.length === 1 ? imgs[0].name.replace(/\.[^.]+$/, "") + ".pdf" : "images.pdf";
    await savePdf(await doc.save(), name);
  }

  async function convertText(file) {
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
    await savePdf(await doc.save(), file.name.replace(/\.[^.]+$/, "") + ".pdf");
  }

  /* ================================================
     Tool: Sign PDF
  ================================================ */
  function renderSign(el) {
    let pdfFile = null, pdfJsDoc = null, currentPage = 0, totalPages = 0;
    let sigPos = { x: 60, y: 60, w: 200, h: 70 };
    const SCALE = 1.5;

    el.innerHTML = `
      <div class="tool-head"><h2>Sign PDF</h2><p>Draw your signature, then position it on any page.</p></div>
      <div id="dz"></div>
      <div id="ws" class="hidden">
        <div class="sign-toolbar">
          <button class="btn btn-secondary" id="drawBtn"><i data-lucide="pen-tool"></i>Draw Signature</button>
          <div class="page-nav">
            <button class="btn-icon" id="prevP"><i data-lucide="chevron-left"></i></button>
            <span id="pgInd">1 / 1</span>
            <button class="btn-icon" id="nextP"><i data-lucide="chevron-right"></i></button>
          </div>
        </div>
        <div class="pdf-preview-wrap" id="pvw"><canvas id="pcanvas"></canvas><div id="sigOv" class="sig-overlay hidden"><img id="sigImg" src="" alt=""><div class="resize-h" id="sigRz"></div></div></div>
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

    /* --- Drag & resize signature overlay --- */
    let dragging = false, resizing = false, dOff = {}, rStart = {};

    sigOv.addEventListener("mousedown", (e) => {
      if (e.target.id === "sigRz") return;
      dragging = true;
      const r = sigOv.getBoundingClientRect();
      dOff = { x: e.clientX - r.left, y: e.clientY - r.top };
      e.preventDefault();
    });

    $("#sigRz", el).addEventListener("mousedown", (e) => {
      resizing = true;
      rStart = { x: e.clientX, w: sigOv.offsetWidth, h: sigOv.offsetHeight };
      e.stopPropagation();
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (dragging) {
        const cr = pvw.getBoundingClientRect();
        let x = e.clientX - cr.left - dOff.x, y = e.clientY - cr.top - dOff.y;
        x = Math.max(0, Math.min(x, pvw.clientWidth - sigOv.offsetWidth));
        y = Math.max(0, Math.min(y, pvw.clientHeight - sigOv.offsetHeight));
        sigOv.style.left = x + "px";
        sigOv.style.top = y + "px";
        sigPos.x = x; sigPos.y = y;
      }
      if (resizing) {
        const nw = Math.max(60, rStart.w + (e.clientX - rStart.x));
        const nh = nw * (rStart.h / rStart.w);
        sigOv.style.width = nw + "px";
        sigOv.style.height = nh + "px";
        sigPos.w = nw; sigPos.h = nh;
      }
    });
    document.addEventListener("mouseup", () => { dragging = false; resizing = false; });

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
        await savePdf(await doc.save(), pdfFile.name.replace(/\.pdf$/i, "_signed.pdf"));
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
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
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="rotate-cw"></i>Rotate</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0]; showLoading("Reading\u2026");
      try { const d = await PDFDocument.load(await readFile(file)); total = d.getPageCount(); $("#fn", el).textContent = file.name; $("#pc", el).textContent = total; $("#opts", el).classList.remove("hidden"); $("#go", el).disabled = false; }
      catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    }

    $("#go", el).addEventListener("click", async () => {
      if (!file) return; showLoading("Rotating\u2026");
      try {
        const doc = await PDFDocument.load(await readFile(file));
        const deg = parseInt($("#deg", el).value);
        const rng = $("#rng", el).value.trim();
        const indices = rng ? parsePageRange(rng, total) : doc.getPageIndices();
        indices.forEach((i) => { const p = doc.getPage(i); p.setRotation(degrees(p.getRotation().angle + deg)); });
        await savePdf(await doc.save(), file.name.replace(/\.pdf$/i, "_rotated.pdf"));
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
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
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="file-output"></i>Extract</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0]; showLoading("Reading\u2026");
      try { const d = await PDFDocument.load(await readFile(file)); total = d.getPageCount(); $("#fn", el).textContent = file.name; $("#pc", el).textContent = total; $("#opts", el).classList.remove("hidden"); $("#go", el).disabled = false; }
      catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
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
        await savePdf(await doc.save(), file.name.replace(/\.pdf$/i, "_extracted.pdf"));
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
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
      <div class="tool-actions"><div id="out"></div><button class="btn btn-primary btn-lg" id="go" disabled><i data-lucide="droplets"></i>Apply Watermark</button></div>`;
    $("#dz", el).appendChild(makeDropZone({ accept: ".pdf", label: "Drop a PDF here", onFiles: onFile }));
    $("#out", el).appendChild(makeOutputSel());
    lucide.createIcons();

    async function onFile(files) {
      file = files[0];
      $("#fn", el).textContent = file.name;
      $("#opts", el).classList.remove("hidden");
      $("#go", el).disabled = false;
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
        await savePdf(await doc.save(), file.name.replace(/\.pdf$/i, "_watermarked.pdf"));
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
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
        await savePdf(await doc.save(), file.name.replace(/\.pdf$/i, "_numbered.pdf"));
      } catch (e) { toast("Error: " + e.message, "error"); } finally { hideLoading(); }
    });
  }

  /* ================================================
     Init
  ================================================ */
  showHome();

  $("#logo").addEventListener("click", (e) => { e.preventDefault(); showHome(); });
})();
