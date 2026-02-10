/* Daily Journal (LocalStorage) */
(() => {
  "use strict";

  const STORAGE_KEY = "dailyJournal.v1";
  const MAX_PHOTOS_PER_ENTRY = 5;
  const IMAGE_MAX_DIM = 1280;
  const IMAGE_JPEG_QUALITY = 0.75;

  /** @type {{ entries: any[] }} */
  let state = { entries: [] };
  /** @type {string|null} */
  let selectedEntryId = null;
  /** @type {{ mode: "new" | "edit", editId: string|null, pendingPhotos: Array<{name:string,type:string,dataUrl:string}> }} */
  let formState = { mode: "new", editId: null, pendingPhotos: [] };

  // Elements
  const el = {
    newEntryBtn: document.getElementById("newEntryBtn"),
    emptyStateNewBtn: document.getElementById("emptyStateNewBtn"),
    searchInput: document.getElementById("searchInput"),
    dateFilterInput: document.getElementById("dateFilterInput"),
    clearFiltersBtn: document.getElementById("clearFiltersBtn"),
    entriesContainer: document.getElementById("entriesContainer"),
    listEmptyState: document.getElementById("listEmptyState"),
    detailEmptyState: document.getElementById("detailEmptyState"),
    detailCard: document.getElementById("detailCard"),
    entryDialog: document.getElementById("entryDialog"),
    entryForm: document.getElementById("entryForm"),
    dialogTitle: document.getElementById("dialogTitle"),
    closeDialogBtn: document.getElementById("closeDialogBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
    saveBtn: document.getElementById("saveBtn"),
    formError: document.getElementById("formError"),
    dateInput: document.getElementById("dateInput"),
    titleInput: document.getElementById("titleInput"),
    bodyInput: document.getElementById("bodyInput"),
    tagsInput: document.getElementById("tagsInput"),
    photosInput: document.getElementById("photosInput"),
    photoPreview: document.getElementById("photoPreview"),
    exportBtn: document.getElementById("exportBtn"),
    importInput: document.getElementById("importInput"),
    storageValue: document.getElementById("storageValue"),
    storageFill: document.getElementById("storageFill"),
    storageHint: document.getElementById("storageHint"),
  };

  init();

  function init() {
    loadState();
    wireEvents();
    // Default date = today
    el.dateInput.value = isoDateToday();
    renderAll();
  }

  function wireEvents() {
    el.newEntryBtn.addEventListener("click", () => openNewEntry());
    el.emptyStateNewBtn.addEventListener("click", () => openNewEntry());
    el.closeDialogBtn.addEventListener("click", () => closeDialog());
    el.cancelBtn.addEventListener("click", () => closeDialog());

    el.searchInput.addEventListener("input", () => renderList());
    el.dateFilterInput.addEventListener("input", () => renderList());
    el.clearFiltersBtn.addEventListener("click", () => {
      el.searchInput.value = "";
      el.dateFilterInput.value = "";
      renderList();
    });

    el.entryForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveFromForm();
    });

    el.photosInput.addEventListener("change", async () => {
      try {
        await handlePhotoSelection(el.photosInput.files);
      } catch (err) {
        showFormError(String(err?.message || err));
      } finally {
        el.photosInput.value = "";
      }
    });

    el.entryDialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeDialog();
    });

    el.exportBtn.addEventListener("click", () => exportJson());
    el.importInput.addEventListener("change", async () => {
      const file = el.importInput.files?.[0];
      el.importInput.value = "";
      if (!file) return;
      await importJsonFile(file);
    });
  }

  // -------------------------
  // Storage
  // -------------------------
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = { entries: [] };
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
        state = { entries: [] };
        return;
      }
      state = {
        entries: parsed.entries
          .filter(Boolean)
          .map((x) => normalizeEntry(x))
          .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.updatedAt.localeCompare(a.updatedAt)),
      };
    } catch {
      state = { entries: [] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: state.entries }));
  }

  function normalizeEntry(x) {
    const id = typeof x.id === "string" ? x.id : cryptoRandomId();
    const dateISO = typeof x.dateISO === "string" ? x.dateISO : isoDateToday();
    const title = typeof x.title === "string" ? x.title : "";
    const body = typeof x.body === "string" ? x.body : "";
    const tags = Array.isArray(x.tags) ? x.tags.filter((t) => typeof t === "string") : [];
    const photos = Array.isArray(x.photos)
      ? x.photos
          .filter(Boolean)
          .map((p) => ({
            name: typeof p.name === "string" ? p.name : "photo.jpg",
            type: typeof p.type === "string" ? p.type : "image/jpeg",
            dataUrl: typeof p.dataUrl === "string" ? p.dataUrl : "",
          }))
          .filter((p) => p.dataUrl.startsWith("data:image/"))
      : [];
    const createdAt = typeof x.createdAt === "string" ? x.createdAt : new Date().toISOString();
    const updatedAt = typeof x.updatedAt === "string" ? x.updatedAt : createdAt;
    return { id, dateISO, title, body, tags, photos, createdAt, updatedAt };
  }

  // -------------------------
  // CRUD
  // -------------------------
  function openNewEntry() {
    formState = { mode: "new", editId: null, pendingPhotos: [] };
    el.dialogTitle.textContent = "New entry";
    el.formError.hidden = true;
    el.dateInput.value = isoDateToday();
    el.titleInput.value = "";
    el.bodyInput.value = "";
    el.tagsInput.value = "";
    renderPhotoPreview();
    openDialog();
    setTimeout(() => el.titleInput.focus(), 0);
  }

  function openEditEntry(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    formState = { mode: "edit", editId: entryId, pendingPhotos: [...entry.photos] };
    el.dialogTitle.textContent = "Edit entry";
    el.formError.hidden = true;
    el.dateInput.value = entry.dateISO;
    el.titleInput.value = entry.title;
    el.bodyInput.value = entry.body;
    el.tagsInput.value = entry.tags.join(", ");
    renderPhotoPreview();
    openDialog();
    setTimeout(() => el.titleInput.focus(), 0);
  }

  function deleteEntry(entryId) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry) return;
    const ok = confirm(`Delete "${entry.title || "Untitled"}" (${entry.dateISO})? This cannot be undone.`);
    if (!ok) return;
    state.entries = state.entries.filter((e) => e.id !== entryId);
    if (selectedEntryId === entryId) selectedEntryId = null;
    safePersist();
    renderAll();
  }

  function saveFromForm() {
    hideFormError();
    const dateISO = (el.dateInput.value || "").trim();
    const title = (el.titleInput.value || "").trim();
    const body = (el.bodyInput.value || "").trim();
    const tags = parseTags(el.tagsInput.value || "");
    const photos = formState.pendingPhotos.slice(0, MAX_PHOTOS_PER_ENTRY);

    if (!dateISO) return showFormError("Please choose a date.");
    if (!title) return showFormError("Please enter a title.");
    if (!body) return showFormError("Please write something in the journal text.");

    const now = new Date().toISOString();

    if (formState.mode === "new") {
      const entry = normalizeEntry({
        id: cryptoRandomId(),
        dateISO,
        title,
        body,
        tags,
        photos,
        createdAt: now,
        updatedAt: now,
      });
      state.entries.unshift(entry);
      selectedEntryId = entry.id;
    } else {
      const id = formState.editId;
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1) return showFormError("Could not find entry to edit.");
      const prev = state.entries[idx];
      state.entries[idx] = normalizeEntry({
        ...prev,
        dateISO,
        title,
        body,
        tags,
        photos,
        updatedAt: now,
      });
      selectedEntryId = id;
    }

    state.entries.sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.updatedAt.localeCompare(a.updatedAt));
    if (!safePersist()) return; // keep dialog open if quota exceeded
    closeDialog();
    renderAll();
  }

  function safePersist() {
    try {
      saveState();
      updateStorageUi();
      return true;
    } catch (err) {
      // Usually QuotaExceededError
      updateStorageUi();
      showFormError(
        "Storage is full. Try removing some photos or deleting old entries, then save again."
      );
      return false;
    }
  }

  // -------------------------
  // Photos (compress + preview)
  // -------------------------
  async function handlePhotoSelection(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const remaining = MAX_PHOTOS_PER_ENTRY - formState.pendingPhotos.length;
    if (remaining <= 0) {
      showFormError(`You can attach up to ${MAX_PHOTOS_PER_ENTRY} photos.`);
      return;
    }

    const toProcess = files.slice(0, remaining);
    for (const f of toProcess) {
      if (!f.type.startsWith("image/")) continue;
      const compressedDataUrl = await compressImageFileToDataUrl(f, IMAGE_MAX_DIM, IMAGE_JPEG_QUALITY);
      formState.pendingPhotos.push({
        name: f.name || "photo.jpg",
        type: "image/jpeg",
        dataUrl: compressedDataUrl,
      });
    }
    renderPhotoPreview();
  }

  function renderPhotoPreview() {
    el.photoPreview.innerHTML = "";
    const photos = formState.pendingPhotos;
    if (!photos.length) return;

    photos.forEach((p, idx) => {
      const card = document.createElement("div");
      card.className = "photoThumb";

      const img = document.createElement("img");
      img.className = "photoThumb__img";
      img.alt = p.name || `Photo ${idx + 1}`;
      img.src = p.dataUrl;

      const actions = document.createElement("div");
      actions.className = "photoThumb__actions";

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "btn btn--tiny btn--danger";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => {
        formState.pendingPhotos = formState.pendingPhotos.filter((_, i) => i !== idx);
        renderPhotoPreview();
      });

      actions.appendChild(rm);
      card.appendChild(img);
      card.appendChild(actions);
      el.photoPreview.appendChild(card);
    });
  }

  async function compressImageFileToDataUrl(file, maxDim, quality) {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitBox(bitmap.width, bitmap.height, maxDim);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    // Always store as JPEG for smaller size
    return canvas.toDataURL("image/jpeg", quality);
  }

  function fitBox(w, h, maxDim) {
    if (w <= maxDim && h <= maxDim) return { width: w, height: h };
    const scale = Math.min(maxDim / w, maxDim / h);
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
  }

  // -------------------------
  // Render
  // -------------------------
  function renderAll() {
    renderList();
    renderDetail();
    updateStorageUi();
  }

  function getFilteredEntries() {
    const q = (el.searchInput.value || "").trim().toLowerCase();
    const date = (el.dateFilterInput.value || "").trim();
    return state.entries.filter((e) => {
      if (date && e.dateISO !== date) return false;
      if (!q) return true;
      return (e.title || "").toLowerCase().includes(q) || (e.body || "").toLowerCase().includes(q);
    });
  }

  function groupByDate(entries) {
    /** @type {Map<string, any[]>} */
    const map = new Map();
    for (const e of entries) {
      if (!map.has(e.dateISO)) map.set(e.dateISO, []);
      map.get(e.dateISO).push(e);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }

  function renderList() {
    const filtered = getFilteredEntries();
    const groups = groupByDate(filtered);

    el.entriesContainer.innerHTML = "";
    const hasAny = state.entries.length > 0;
    const hasFiltered = filtered.length > 0;
    el.listEmptyState.hidden = hasAny;

    if (hasAny && !hasFiltered) {
      const empty = document.createElement("div");
      empty.className = "emptyInline";
      empty.textContent = "No entries match your search/filter.";
      el.entriesContainer.appendChild(empty);
      return;
    }

    for (const [dateISO, entries] of groups) {
      const section = document.createElement("div");
      section.className = "dateGroup";

      const header = document.createElement("div");
      header.className = "dateGroup__header";
      header.textContent = formatNiceDate(dateISO);
      section.appendChild(header);

      for (const entry of entries) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "entryItem";
        if (entry.id === selectedEntryId) item.classList.add("isSelected");

        const title = document.createElement("div");
        title.className = "entryItem__title";
        title.textContent = entry.title || "Untitled";

        const meta = document.createElement("div");
        meta.className = "entryItem__meta";
        meta.textContent = buildMeta(entry);

        item.appendChild(title);
        item.appendChild(meta);
        item.addEventListener("click", () => {
          selectedEntryId = entry.id;
          renderList();
          renderDetail();
        });

        section.appendChild(item);
      }

      el.entriesContainer.appendChild(section);
    }
  }

  function renderDetail() {
    const entry = selectedEntryId ? state.entries.find((e) => e.id === selectedEntryId) : null;
    if (!entry) {
      el.detailEmptyState.hidden = false;
      el.detailCard.hidden = true;
      el.detailCard.innerHTML = "";
      return;
    }

    el.detailEmptyState.hidden = true;
    el.detailCard.hidden = false;

    el.detailCard.innerHTML = "";

    const header = document.createElement("div");
    header.className = "detailCard__header";

    const hgroup = document.createElement("div");
    hgroup.className = "detailCard__hgroup";

    const title = document.createElement("div");
    title.className = "detailCard__title";
    title.textContent = entry.title || "Untitled";

    const sub = document.createElement("div");
    sub.className = "detailCard__sub";
    sub.textContent = `${formatNiceDate(entry.dateISO)} • Updated ${formatNiceTime(entry.updatedAt)}`;

    hgroup.appendChild(title);
    hgroup.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "detailCard__actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn--ghost";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openEditEntry(entry.id));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn--danger";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => deleteEntry(entry.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    header.appendChild(hgroup);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "detailCard__body";
    body.textContent = entry.body || "";

    const tags = renderTags(entry.tags);
    const photos = renderPhotos(entry.photos);

    el.detailCard.appendChild(header);
    if (tags) el.detailCard.appendChild(tags);
    el.detailCard.appendChild(body);
    if (photos) el.detailCard.appendChild(photos);
  }

  function renderTags(tags) {
    const clean = (tags || []).map((t) => t.trim()).filter(Boolean);
    if (!clean.length) return null;
    const wrap = document.createElement("div");
    wrap.className = "tagRow";
    clean.forEach((t) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = t;
      wrap.appendChild(chip);
    });
    return wrap;
  }

  function renderPhotos(photos) {
    const list = (photos || []).filter((p) => p?.dataUrl);
    if (!list.length) return null;
    const grid = document.createElement("div");
    grid.className = "photoGrid";
    list.forEach((p) => {
      const a = document.createElement("a");
      a.href = p.dataUrl;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.className = "photoGrid__item";

      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = p.name || "Photo";
      img.src = p.dataUrl;

      a.appendChild(img);
      grid.appendChild(a);
    });
    return grid;
  }

  // -------------------------
  // Export / Import
  // -------------------------
  function exportJson() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: state.entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `daily-journal-backup-${isoDateToday()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importJsonFile(file) {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      alert("That file is not valid JSON.");
      return;
    }
    const incoming = Array.isArray(parsed?.entries) ? parsed.entries : Array.isArray(parsed) ? parsed : null;
    if (!incoming) {
      alert("JSON must be an object with an 'entries' array (or just an entries array).");
      return;
    }

    const normalized = incoming.map((x) => normalizeEntry(x));

    const merged = mergeEntries(state.entries, normalized);
    const ok = confirm(
      `Import ${normalized.length} entries.\n\nThis will merge with your current ${state.entries.length} entries (same IDs overwrite). Continue?`
    );
    if (!ok) return;

    state.entries = merged.sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.updatedAt.localeCompare(a.updatedAt));
    selectedEntryId = state.entries[0]?.id || null;

    try {
      saveState();
    } catch {
      alert("Import failed: storage is full. Try importing fewer entries or remove photos/entries.");
      return;
    }
    renderAll();
  }

  function mergeEntries(existing, incoming) {
    const map = new Map(existing.map((e) => [e.id, e]));
    for (const e of incoming) map.set(e.id, e);
    return Array.from(map.values());
  }

  // -------------------------
  // Storage UI (approx)
  // -------------------------
  function updateStorageUi() {
    // Approximate bytes: UTF-16 JS strings ~2 bytes/char, but LocalStorage implementations vary.
    const raw = localStorage.getItem(STORAGE_KEY) || "";
    const bytes = raw.length * 2;
    const mb = bytes / (1024 * 1024);
    el.storageValue.textContent = `${mb.toFixed(2)} MB`;

    // Assume a conservative 5MB quota for the progress bar; warn >80%
    const quotaMb = 5;
    const pct = Math.max(0, Math.min(100, (mb / quotaMb) * 100));
    el.storageFill.style.width = `${pct.toFixed(0)}%`;
    el.storageFill.classList.toggle("isWarn", pct >= 80);
    el.storageHint.textContent =
      pct >= 95
        ? "Very full — saving may fail. Delete photos/entries."
        : pct >= 80
          ? "Getting full — photos may fail to save."
          : " ";
  }

  // -------------------------
  // Dialog helpers
  // -------------------------
  function openDialog() {
    if (!el.entryDialog.open) el.entryDialog.showModal();
  }

  function closeDialog() {
    hideFormError();
    if (el.entryDialog.open) el.entryDialog.close();
  }

  function showFormError(msg) {
    el.formError.textContent = msg;
    el.formError.hidden = false;
  }

  function hideFormError() {
    el.formError.hidden = true;
    el.formError.textContent = "";
  }

  // -------------------------
  // Utils
  // -------------------------
  function isoDateToday() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatNiceDate(iso) {
    // iso: YYYY-MM-DD
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    return dt.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  }

  function formatNiceTime(isoTs) {
    const dt = new Date(isoTs);
    return dt.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function parseTags(raw) {
    return String(raw)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  function buildMeta(entry) {
    const parts = [];
    const words = (entry.body || "").trim().split(/\s+/).filter(Boolean).length;
    if (words) parts.push(`${words} words`);
    if (entry.photos?.length) parts.push(`${entry.photos.length} photo${entry.photos.length === 1 ? "" : "s"}`);
    if (entry.tags?.length) parts.push(`${entry.tags.length} tag${entry.tags.length === 1 ? "" : "s"}`);
    return parts.join(" • ") || "—";
  }

  function cryptoRandomId() {
    // Prefer crypto.randomUUID if available
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const buf = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
})();


