const API = "";
let currentNotebookId = null;
let currentChapterId = null;
let quillEditors = {};
let chapterNotesQuill = null;

// --- Notebook management ---

async function loadNotebooks() {
    const res = await fetch(`${API}/api/notebooks`);
    const notebooks = await res.json();
    const dropdown = document.getElementById("notebook-dropdown");
    dropdown.innerHTML = "";
    notebooks.forEach(nb => {
        const opt = document.createElement("option");
        opt.value = nb.id;
        opt.textContent = nb.name;
        if (nb.id === currentNotebookId) opt.selected = true;
        dropdown.appendChild(opt);
    });
    if (!currentNotebookId && notebooks.length > 0) {
        currentNotebookId = notebooks[0].id;
        dropdown.value = currentNotebookId;
    }
    if (currentNotebookId) loadChapters();
}

function onNotebookChange(e) {
    currentNotebookId = parseInt(e.target.value);
    currentChapterId = null;
    showWelcome();
    loadChapters();
}

async function addNotebook() {
    const name = prompt("New notebook name:");
    if (!name) return;
    const res = await fetch(`${API}/api/notebooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    const nb = await res.json();
    currentNotebookId = nb.id;
    currentChapterId = null;
    showWelcome();
    await loadNotebooks();
}

async function renameNotebook() {
    if (!currentNotebookId) return;
    const dropdown = document.getElementById("notebook-dropdown");
    const currentName = dropdown.options[dropdown.selectedIndex]?.textContent || "";
    const name = prompt("Rename notebook:", currentName);
    if (!name) return;
    await fetch(`${API}/api/notebooks/${currentNotebookId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    await loadNotebooks();
}

async function deleteNotebook() {
    if (!currentNotebookId) return;
    if (!confirm("Delete this notebook and all its chapters/entries?")) return;
    const res = await fetch(`${API}/api/notebooks/${currentNotebookId}`, { method: "DELETE" });
    if (!res.ok) {
        const err = await res.json();
        showToast(err.detail || "Cannot delete", "error");
        return;
    }
    currentNotebookId = null;
    currentChapterId = null;
    showWelcome();
    await loadNotebooks();
}

// --- Chapter management ---

async function loadChapters() {
    if (!currentNotebookId) return;
    const res = await fetch(`${API}/api/notebooks/${currentNotebookId}/chapters`);
    const chapters = await res.json();
    const list = document.getElementById("chapter-list");
    list.innerHTML = "";
    chapters.forEach((ch, idx) => {
        const li = document.createElement("li");
        li.dataset.id = ch.id;
        li.draggable = true;
        if (ch.id === currentChapterId) li.classList.add("active");
        li.innerHTML = `
            <span class="chapter-order-btns">
                <button onclick="moveChapter(${idx}, -1, event)" title="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
                <button onclick="moveChapter(${idx}, 1, event)" title="Move down" ${idx === chapters.length - 1 ? 'disabled' : ''}>▼</button>
            </span>
            <span class="chapter-name">${escapeHtml(ch.name)}</span>
            <span class="chapter-actions">
                <button onclick="renameChapter(${ch.id}, event)" title="Rename">✏</button>
                <button onclick="deleteChapter(${ch.id}, event)" title="Delete">✕</button>
            </span>
        `;
        // Drag and drop
        li.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("text/plain", idx.toString());
            li.classList.add("dragging");
        });
        li.addEventListener("dragend", () => li.classList.remove("dragging"));
        li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("drag-over"); });
        li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
        li.addEventListener("drop", async (e) => {
            e.preventDefault();
            li.classList.remove("drag-over");
            const fromIdx = parseInt(e.dataTransfer.getData("text/plain"));
            const toIdx = idx;
            if (fromIdx !== toIdx) {
                const ids = chapters.map(c => c.id);
                const [moved] = ids.splice(fromIdx, 1);
                ids.splice(toIdx, 0, moved);
                await saveChapterOrder(ids);
            }
        });
        li.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") return;
            selectChapter(ch.id, ch.name);
        });
        list.appendChild(li);
    });
}

async function moveChapter(fromIdx, direction, event) {
    event.stopPropagation();
    const list = document.getElementById("chapter-list");
    const items = Array.from(list.children);
    const ids = items.map(li => parseInt(li.dataset.id));
    const toIdx = fromIdx + direction;
    if (toIdx < 0 || toIdx >= ids.length) return;
    const [moved] = ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, moved);
    await saveChapterOrder(ids);
}

async function saveChapterOrder(chapterIds) {
    await fetch(`${API}/api/chapters/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapter_ids: chapterIds }),
    });
    await loadChapters();
}

async function addChapter() {
    if (!currentNotebookId) return;
    const input = document.getElementById("new-chapter-name");
    const name = input.value.trim();
    if (!name) return;
    await fetch(`${API}/api/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebook_id: currentNotebookId, name }),
    });
    input.value = "";
    await loadChapters();
}

async function renameChapter(id, event) {
    event.stopPropagation();
    const name = prompt("Rename chapter:");
    if (!name) return;
    await fetch(`${API}/api/chapters/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
    });
    await loadChapters();
    if (id === currentChapterId) {
        document.getElementById("chapter-title").textContent = name;
    }
}

async function deleteChapter(id, event) {
    event.stopPropagation();
    if (!confirm("Delete this chapter and all its entries?")) return;
    await fetch(`${API}/api/chapters/${id}`, { method: "DELETE" });
    if (id === currentChapterId) {
        currentChapterId = null;
        showWelcome();
    }
    await loadChapters();
}

async function selectChapter(id, name) {
    // Save current chapter's RAG state before switching
    if (currentChapterId) saveRagState(`chapter_${currentChapterId}`);

    currentChapterId = id;
    document.querySelectorAll("#chapter-list li").forEach(li => {
        li.classList.toggle("active", parseInt(li.dataset.id) === id);
    });
    document.getElementById("chapter-title").textContent = name;
    document.getElementById("welcome").style.display = "none";
    document.getElementById("chapter-view").style.display = "flex";
    document.getElementById("search-results").style.display = "none";
    document.getElementById("bulk-view").style.display = "none";

    // Clear download progress (not persistent)
    const progressEl = document.getElementById("entry-download-progress");
    if (progressEl) progressEl.innerHTML = "";

    await loadChapterNotes(id);
    await loadEntries(id);
    await loadAllIndexes();

    // Restore cached RAG state or load fresh
    if (!restoreRagState(`chapter_${id}`)) {
        ragIndexData = null;
        document.getElementById("rag-search-section").style.display = "none";
        clearRagSearch();
        await loadChapterRagIndex();
    }
}

function showWelcome() {
    document.getElementById("welcome").style.display = "block";
    document.getElementById("chapter-view").style.display = "none";
    document.getElementById("search-results").style.display = "none";
    document.getElementById("bulk-view").style.display = "none";
}

// --- Chapter notes ---

async function loadChapterNotes(chapterId) {
    const res = await fetch(`${API}/api/chapters/${chapterId}`);
    const chapter = await res.json();

    if (!chapterNotesQuill) {
        chapterNotesQuill = new Quill("#chapter-notes-editor", {
            theme: "snow",
            modules: {
                toolbar: [
                    ["bold", "italic", "underline"],
                    [{ list: "ordered" }, { list: "bullet" }],
                    [{ header: [1, 2, 3, false] }],
                    ["clean"],
                ],
            },
            placeholder: "Write chapter notes here...",
        });
    }
    chapterNotesQuill.root.innerHTML = chapter.notes || "";
    document.getElementById("chapter-notes-status").textContent = "";

    // Show folder path
    let pathEl = document.getElementById("chapter-folder-path");
    if (!pathEl) {
        pathEl = document.createElement("div");
        pathEl.id = "chapter-folder-path";
        pathEl.style.cssText = "font-size:11px;color:#999;margin-bottom:12px;word-break:break-all;font-family:monospace;";
        document.getElementById("chapter-notes-section").prepend(pathEl);
    }
    if (chapter.folder_path) {
        pathEl.textContent = "Files saved to: " + chapter.folder_path;
    } else {
        pathEl.textContent = "";
    }
}

async function saveChapterNotes() {
    if (!chapterNotesQuill || !currentChapterId) return;
    const notes = chapterNotesQuill.root.innerHTML;
    await fetch(`${API}/api/chapters/${currentChapterId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
    });
    document.getElementById("chapter-notes-status").textContent = "Saved!";
    setTimeout(() => {
        document.getElementById("chapter-notes-status").textContent = "";
    }, 2000);
}

// --- Entry management ---

async function loadEntries(chapterId) {
    const res = await fetch(`${API}/api/chapters/${chapterId}/entries`);
    const entries = await res.json();
    const container = document.getElementById("entries-list");
    container.innerHTML = "";
    quillEditors = {};

    entries.forEach(entry => {
        container.appendChild(createEntryCard(entry));
    });

    if (entries.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No entries yet</h3><p>Add a video URL above to get started.</p></div>';
    }
}

function createEntryCard(entry) {
    const card = document.createElement("div");
    card.className = "entry-card";
    card.dataset.id = entry.id;

    const videoSrc = entry.video_path ? `/media/${entry.video_path}` : "";
    const editorId = `editor-${entry.id}`;

    card.innerHTML = `
        <div class="entry-inner">
            <div class="entry-video">
                ${videoSrc ? `<video controls preload="metadata"><source src="${videoSrc}" type="video/mp4"></video>` : '<p style="color:#666">No video</p>'}
            </div>
            <div class="entry-notes">
                <div class="entry-header">
                    <h4>${escapeHtml(entry.video_title || "Untitled")}</h4>
                </div>
                ${entry.source_url ? `<div class="entry-source">${escapeHtml(entry.source_url)}</div>` : ""}
                ${entry.video_path ? `<div style="margin-bottom:8px;">
                    <div class="trim-row" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
                        <label style="font-size:12px;color:#666;">Start:</label>
                        <input type="text" id="entry-trim-start-${entry.id}" placeholder="00:00:00" style="width:100px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px;font-family:monospace;">
                        <label style="font-size:12px;color:#666;">End:</label>
                        <input type="text" id="entry-trim-end-${entry.id}" placeholder="00:01:30" style="width:100px;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:12px;font-family:monospace;">
                        <button class="btn btn-secondary" onclick="trimEntryVideo(${entry.id}, '${entry.video_path}')">Trim</button>
                    </div>
                </div>` : ""}
                <div id="${editorId}">${entry.notes || ""}</div>
                <div class="entry-actions">
                    <button class="btn btn-primary" onclick="saveNotes(${entry.id})">Save Notes</button>
                    <button class="btn btn-secondary" id="transcribe-btn-${entry.id}" onclick="transcribeEntry(${entry.id})">Transcribe</button>
                    ${entry.video_path ? `<button class="btn btn-secondary" onclick="openSceneSplitter(${entry.id}, '${entry.video_path}')">Split Scenes</button>` : ""}
                    <button class="btn btn-danger" onclick="deleteEntry(${entry.id})">Delete</button>
                </div>
                <div class="transcript-section" id="transcript-section-${entry.id}" style="${entry.transcript ? '' : 'display:none;'}">
                    <div class="transcript-header" style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;padding:6px 0;border-top:1px solid #e0e0e0;">
                        <strong style="font-size:13px;color:#555;">Transcription</strong>
                        <button class="btn btn-secondary" style="font-size:11px;padding:2px 8px;" onclick="toggleTranscript(${entry.id})">Show/Hide</button>
                    </div>
                    <div class="transcript-body" id="transcript-body-${entry.id}" style="font-size:13px;color:#444;line-height:1.5;padding:8px;background:#f9f9f9;border-radius:4px;max-height:300px;overflow-y:auto;white-space:pre-wrap;">${escapeHtml(entry.transcript || "")}</div>
                </div>
            </div>
        </div>
    `;

    requestAnimationFrame(() => {
        const editorEl = document.getElementById(editorId);
        if (editorEl) {
            const quill = new Quill(`#${editorId}`, {
                theme: "snow",
                modules: {
                    toolbar: [
                        ["bold", "italic", "underline"],
                        [{ list: "ordered" }, { list: "bullet" }],
                        ["clean"],
                    ],
                },
            });
            quillEditors[entry.id] = quill;
        }
    });

    return card;
}

async function transcribeEntry(entryId) {
    const btn = document.getElementById(`transcribe-btn-${entryId}`);
    btn.disabled = true;
    btn.innerHTML = 'Transcribing...<span class="loading"></span>';

    try {
        const res = await fetch(`${API}/api/entries/${entryId}/transcribe`, { method: "POST" });
        if (!res.ok) {
            const err = await res.json();
            showToast((err.detail || "Failed", "error"));
            return;
        }
        const entry = await res.json();
        // Show the transcript in its dedicated section
        const section = document.getElementById(`transcript-section-${entryId}`);
        const body = document.getElementById(`transcript-body-${entryId}`);
        if (section && body) {
            body.textContent = entry.transcript || "";
            section.style.display = "";
        }
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Transcribe";
    }
}

function toggleTranscript(entryId) {
    const body = document.getElementById(`transcript-body-${entryId}`);
    if (body) {
        body.style.display = body.style.display === "none" ? "" : "none";
    }
}

async function transcribeAll() {
    const btn = document.getElementById("transcribe-all-btn");
    btn.disabled = true;
    btn.innerHTML = 'Transcribing all...<span class="loading"></span>';

    try {
        const res = await fetch(`${API}/api/chapters/${currentChapterId}/entries`);
        const entries = await res.json();

        for (const entry of entries) {
            // Skip if already has transcription
            if (entry.transcript) continue;
            if (!entry.video_path) continue;

            const tbtn = document.getElementById(`transcribe-btn-${entry.id}`);
            if (tbtn) {
                tbtn.disabled = true;
                tbtn.innerHTML = 'Transcribing...<span class="loading"></span>';
            }

            const r = await fetch(`${API}/api/entries/${entry.id}/transcribe`, { method: "POST" });
            if (r.ok) {
                const updated = await r.json();
                const section = document.getElementById(`transcript-section-${entry.id}`);
                const body = document.getElementById(`transcript-body-${entry.id}`);
                if (section && body) {
                    body.textContent = updated.transcript || "";
                    section.style.display = "";
                }
            }

            if (tbtn) {
                tbtn.disabled = false;
                tbtn.textContent = "Transcribe";
            }
        }
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Transcribe All";
    }
}

async function trimEntryVideo(entryId, videoPath) {
    const start = document.getElementById(`entry-trim-start-${entryId}`).value.trim();
    const end = document.getElementById(`entry-trim-end-${entryId}`).value.trim();
    if (!start && !end) {
        showToast("Enter at least a start or end timestamp.", "warning");
        return;
    }
    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Trimming...";
    try {
        const res = await fetch(`${API}/api/trim`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_path: videoPath, start, end, entry_id: entryId }),
        });
        if (!res.ok) {
            const err = await res.json();
            showToast((err.detail || "Error", "error"));
            return;
        }
        const data = await res.json();
        const timeLabel = `${start || "0:00"}\u2013${end || "end"}`;
        showToast(`Trim complete (${timeLabel}). New entry created. Original unchanged.`, "success");
        // Reload entries to show the new trimmed entry
        await loadEntries(currentChapterId);
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Trim";
    }
}

async function addEntry() {
    const urlInput = document.getElementById("entry-url");
    const notesInput = document.getElementById("entry-notes");
    const btn = document.getElementById("add-entry-btn");
    const url = urlInput.value.trim();

    if (!url || !currentChapterId) return;

    btn.disabled = true;
    btn.innerHTML = 'Downloading...<span class="loading"></span>';

    // Show progress bar
    let progressEl = document.getElementById("entry-download-progress");
    if (!progressEl) {
        progressEl = document.createElement("div");
        progressEl.id = "entry-download-progress";
        btn.parentNode.appendChild(progressEl);
    }
    const startTime = Date.now();
    const timerEl = document.createElement("span");
    timerEl.id = "download-timer";
    progressEl.innerHTML = '<div class="download-progress-bar download-progress-pulse"><div class="download-progress-bar-fill"></div></div>';
    const statusLine = document.createElement("div");
    statusLine.style.cssText = "font-size:12px;color:#888;margin-top:4px;";
    statusLine.innerHTML = 'Downloading and processing video... <span id="download-elapsed">0s</span>';
    progressEl.appendChild(statusLine);

    const timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const el = document.getElementById("download-elapsed");
        if (el) {
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            el.textContent = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        }
    }, 1000);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600000); // 10 min timeout
        const res = await fetch(`${API}/api/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chapter_id: currentChapterId,
                url: url,
                notes: notesInput.value,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
            const err = await res.json();
            showToast(err.detail || "Download failed", "error");
            return;
        }

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        showToast(`Download complete (${elapsed}s)`, "success");
        urlInput.value = "";
        notesInput.value = "";
        await loadEntries(currentChapterId);
    } catch (e) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (e.name === "AbortError") {
            showToast(`Download timed out after ${Math.floor(elapsed/60)}m. The video may still be downloading — try refreshing.`, "warning");
        } else {
            showToast("Error: " + e.message, "error");
        }
    } finally {
        clearInterval(timerInterval);
        btn.disabled = false;
        btn.textContent = "Download & Save";
        if (progressEl) progressEl.innerHTML = "";
    }
}

async function saveNotes(entryId) {
    const quill = quillEditors[entryId];
    if (!quill) return;
    const notes = quill.root.innerHTML;
    await fetch(`${API}/api/entries/${entryId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
    });
}

async function deleteEntry(entryId) {
    if (!confirm("Delete this entry?")) return;
    await fetch(`${API}/api/entries/${entryId}`, { method: "DELETE" });
    await loadEntries(currentChapterId);
}

// --- Export ---

function exportChapter() {
    if (!currentChapterId) return;
    window.open(`${API}/api/chapters/${currentChapterId}/export`, "_blank");
}

// --- Search ---

let searchTimeout = null;

function onSearch(e) {
    const q = e.target.value.trim();
    clearTimeout(searchTimeout);
    if (!q) {
        if (currentChapterId) {
            document.getElementById("chapter-view").style.display = "flex";
        } else {
            document.getElementById("welcome").style.display = "block";
        }
        document.getElementById("search-results").style.display = "none";
        return;
    }
    searchTimeout = setTimeout(() => doSearch(q), 300);
}

async function doSearch(q) {
    const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
    const results = await res.json();
    const container = document.getElementById("search-results");
    document.getElementById("welcome").style.display = "none";
    document.getElementById("chapter-view").style.display = "none";
    document.getElementById("bulk-view").style.display = "none";
    container.style.display = "block";

    if (results.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No results</h3></div>';
        return;
    }

    container.innerHTML = `<h3>Search results (${results.length})</h3>`;
    results.forEach(entry => {
        const card = document.createElement("div");
        card.className = "entry-card";
        const videoSrc = entry.video_path ? `/media/${entry.video_path}` : "";
        card.innerHTML = `
            <div class="entry-inner">
                <div class="entry-video">
                    ${videoSrc ? `<video controls preload="metadata"><source src="${videoSrc}" type="video/mp4"></video>` : ""}
                </div>
                <div class="entry-notes" style="padding:20px">
                    <div class="entry-header"><h4>${escapeHtml(entry.video_title || "Untitled")}</h4></div>
                    <div class="entry-source">Chapter: ${escapeHtml(entry.chapter_name)}</div>
                    <div>${entry.notes || "<em>No notes</em>"}</div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// --- Bulk Download ---

let currentBulkFolder = null;

function showBulkDownload() {
    // Save current chapter RAG state
    if (currentChapterId) saveRagState(`chapter_${currentChapterId}`);

    document.getElementById("welcome").style.display = "none";
    document.getElementById("chapter-view").style.display = "none";
    document.getElementById("search-results").style.display = "none";
    document.getElementById("bulk-view").style.display = "flex";
    document.getElementById("bulk-view").style.flexDirection = "column";
    document.getElementById("bulk-view").style.flex = "1";
    document.getElementById("bulk-view").style.overflow = "hidden";
    currentChapterId = null;
    ragIndexData = null;
    document.querySelectorAll("#chapter-list li").forEach(li => li.classList.remove("active"));
    loadBulkFolders();
}

function hideBulkView() {
    document.getElementById("bulk-view").style.display = "none";
}

async function loadBulkFolders() {
    const res = await fetch(`${API}/api/bulk/folders`);
    const folders = await res.json();
    const container = document.getElementById("bulk-folders-list");
    container.innerHTML = "";

    if (folders.length === 0) {
        container.innerHTML = '<p style="color:#888; font-size:13px;">No downloads yet.</p>';
        return;
    }

    folders.forEach(f => {
        const card = document.createElement("div");
        card.className = "bulk-folder-card";
        card.innerHTML = `
            <span class="folder-name">${escapeHtml(f.name.replace(/_/g, " "))}</span>
            <span class="folder-count">${f.video_count} video${f.video_count !== 1 ? "s" : ""}</span>
        `;
        card.addEventListener("click", () => openBulkFolder(f.name));
        container.appendChild(card);
    });
}

async function openBulkFolder(folderName) {
    currentBulkFolder = folderName;
    const res = await fetch(`${API}/api/bulk/folders/${encodeURIComponent(folderName)}`);
    const videos = await res.json();

    document.getElementById("bulk-folder-title").textContent = folderName.replace(/_/g, " ");
    document.getElementById("bulk-folder-contents").style.display = "block";

    // Show folder path
    let bulkPathEl = document.getElementById("bulk-folder-path");
    if (!bulkPathEl) {
        bulkPathEl = document.createElement("div");
        bulkPathEl.id = "bulk-folder-path";
        bulkPathEl.style.cssText = "font-size:11px;color:#999;margin-bottom:12px;word-break:break-all;font-family:monospace;";
        document.getElementById("bulk-folder-title").after(bulkPathEl);
    }
    bulkPathEl.textContent = "Files saved to: media/Downloads/" + folderName;

    const container = document.getElementById("bulk-videos-list");
    container.innerHTML = "";

    videos.forEach((v, idx) => {
        const card = document.createElement("div");
        card.className = "bulk-video-card";
        card.id = `bulk-video-${idx}`;
        card.innerHTML = `
            <div class="bulk-video-inner">
                <div class="bulk-video-player">
                    <video controls preload="metadata">
                        <source src="/media/${v.video_path}" type="video/mp4">
                    </video>
                </div>
                <div class="bulk-video-info">
                    <h4>${escapeHtml(v.title)}</h4>
                    <div class="trim-row">
                        <label>Start:</label>
                        <input type="text" id="trim-start-${idx}" placeholder="00:00:00" data-path="${v.video_path}">
                        <label>End:</label>
                        <input type="text" id="trim-end-${idx}" placeholder="00:01:30">
                        <button class="btn btn-secondary" onclick="trimBulkVideo(${idx}, '${v.video_path}')">Trim</button>
                    </div>
                    ${v.has_transcript
                        ? `<div class="transcript-box">${escapeHtml(v.transcript)}</div>`
                        : `<div class="transcript-box" id="transcript-${idx}" style="display:none;"></div>`
                    }
                    <div class="bulk-video-actions">
                        ${!v.has_transcript ? `<button class="btn btn-secondary" id="bulk-transcribe-${idx}" onclick="transcribeBulkVideo(${idx}, '${v.video_path}')">Transcribe</button>` : '<span style="font-size:12px;color:#888;">Transcribed</span>'}
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    await loadBulkRagIndex();
}

async function startBulkDownload() {
    const folder = document.getElementById("bulk-folder").value.trim();
    const urlsText = document.getElementById("bulk-urls").value.trim();
    const transcribe = document.getElementById("bulk-transcribe").checked;
    const btn = document.getElementById("bulk-download-btn");
    const progress = document.getElementById("bulk-progress");

    if (!folder || !urlsText) {
        showToast("Please enter a folder name and at least one URL.", "warning");
        return;
    }

    const urls = urlsText.split("\n").map(u => u.trim()).filter(u => u);
    btn.disabled = true;
    btn.innerHTML = 'Downloading...<span class="loading"></span>';

    let completed = 0;
    let errors = [];
    let doneList = [];

    for (const url of urls) {
        const shortUrl = url.length > 60 ? url.substring(0, 60) + "..." : url;
        progress.innerHTML = buildBulkProgress(completed + 1, urls.length, doneList, errors, `Downloading: ${escapeHtml(shortUrl)}`);

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 300000); // 5 min timeout

            const res = await fetch(`${API}/api/bulk/download?folder=${encodeURIComponent(folder)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
                signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!res.ok) {
                const err = await res.json();
                errors.push(`${shortUrl}: ${err.detail || "Failed"}`);
            } else {
                const result = await res.json();
                doneList.push(result.title || shortUrl);
                if (transcribe) {
                    progress.innerHTML = buildBulkProgress(completed + 1, urls.length, doneList, errors, `Transcribing: ${escapeHtml(result.title || shortUrl)}`);
                    try {
                        await fetch(`${API}/api/bulk/transcribe?video_path=${encodeURIComponent(result.video_path)}`, {
                            method: "POST",
                        });
                    } catch (te) {
                        errors.push(`Transcribe ${shortUrl}: ${te.message}`);
                    }
                }
            }
        } catch (e) {
            if (e.name === "AbortError") {
                errors.push(`${shortUrl}: Timed out (5 min)`);
            } else {
                errors.push(`${shortUrl}: ${e.message}`);
            }
        }
        completed++;
    }

    btn.disabled = false;
    btn.textContent = "Download All";
    const succeeded = completed - errors.length;

    if (errors.length > 0) {
        progress.innerHTML = `<strong>Done! ${succeeded}/${urls.length} succeeded.</strong><br><br>` +
            `<span style="color:#ef4444;font-size:12px;">${errors.map(e => escapeHtml(e)).join("<br>")}</span>`;
    } else {
        progress.innerHTML = `<strong>Done!</strong> All ${urls.length} videos downloaded.`;
        document.getElementById("bulk-urls").value = "";
    }

    await loadBulkFolders();
    if (currentBulkFolder === folder.replace(/ /g, "_")) {
        await openBulkFolder(currentBulkFolder);
    }
}

async function trimBulkVideo(idx, videoPath) {
    const start = document.getElementById(`trim-start-${idx}`).value.trim();
    const end = document.getElementById(`trim-end-${idx}`).value.trim();

    if (!start && !end) {
        showToast("Enter at least a start or end timestamp.", "warning");
        return;
    }

    const btn = event.target;
    btn.disabled = true;
    btn.textContent = "Trimming...";

    try {
        const res = await fetch(`${API}/api/trim`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_path: videoPath, start, end }),
        });
        if (!res.ok) {
            const err = await res.json();
            showToast((err.detail || "Error", "error"));
            return;
        }
        const timeLabel = `${start || "0:00"}\u2013${end || "end"}`;
        showToast(`Trim complete (${timeLabel}). Clip saved. Original unchanged.`, "success");
        // Reload folder to show the new trimmed file
        if (currentBulkFolder) {
            await openBulkFolder(currentBulkFolder);
        }
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = "Trim";
    }
}

async function transcribeBulkVideo(idx, videoPath) {
    const btn = document.getElementById(`bulk-transcribe-${idx}`);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = 'Transcribing...<span class="loading"></span>';
    }

    try {
        const res = await fetch(`${API}/api/bulk/transcribe?video_path=${encodeURIComponent(videoPath)}`, {
            method: "POST",
        });
        if (!res.ok) {
            const err = await res.json();
            showToast((err.detail || "Error", "error"));
            return;
        }
        const data = await res.json();
        const box = document.getElementById(`transcript-${idx}`);
        if (box) {
            box.textContent = data.transcript;
            box.style.display = "block";
        }
        if (btn) {
            btn.textContent = "Transcribed";
            btn.disabled = true;
        }
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        if (btn && !btn.disabled) {
            btn.disabled = false;
            btn.textContent = "Transcribe";
        }
    }
}

async function transcribeAllBulk() {
    if (!currentBulkFolder) return;
    const res = await fetch(`${API}/api/bulk/folders/${encodeURIComponent(currentBulkFolder)}`);
    const videos = await res.json();

    for (let i = 0; i < videos.length; i++) {
        if (videos[i].has_transcript) continue;
        await transcribeBulkVideo(i, videos[i].video_path);
    }
}

// --- Helpers ---

function buildBulkProgress(current, total, doneList, errors, statusText) {
    const pct = Math.round((current - 1) / total * 100);
    let html = `<div class="download-progress-bar"><div class="download-progress-bar-fill" style="width:${pct}%"></div></div>`;
    html += `<div style="margin-top:6px;"><strong>${statusText}</strong> (${current} of ${total})</div>`;
    if (doneList.length > 0) {
        html += `<div style="margin-top:8px;font-size:12px;color:#16a34a;">`;
        doneList.forEach(t => { html += `&#10003; ${escapeHtml(t)} is done<br>`; });
        html += `</div>`;
    }
    if (errors.length > 0) {
        html += `<div style="margin-top:4px;font-size:12px;color:#ef4444;">${errors.length} failed</div>`;
    }
    return html;
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:420px;";
        document.body.appendChild(container);
    }
    const colors = { info: "#333", success: "#16a34a", error: "#ef4444", warning: "#d97706" };
    const toast = document.createElement("div");
    toast.style.cssText = `background:${colors[type] || colors.info};color:#fff;padding:12px 16px;border-radius:8px;font-size:13px;line-height:1.4;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transition:opacity 0.3s;word-break:break-word;`;
    toast.textContent = message;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = "1");
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// --- Scene Splitting ---

function computeFrameHash(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h).data;
    const gridW = Math.floor(w / 8), gridH = Math.floor(h / 8);
    const hash = [];
    for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 8; gx++) {
            let sum = 0, count = 0;
            const sx = gx * gridW, sy = gy * gridH;
            for (let y = sy; y < sy + gridH; y += 2) {
                for (let x = sx; x < sx + gridW; x += 2) {
                    const i = (y * w + x) * 4;
                    sum += imgData[i] * 0.299 + imgData[i + 1] * 0.587 + imgData[i + 2] * 0.114;
                    count++;
                }
            }
            hash.push(sum / count);
        }
    }
    return hash;
}

function frameDiff(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
}

function seekTo(video, time) {
    return new Promise(resolve => {
        video.currentTime = time;
        video.addEventListener("seeked", resolve, { once: true });
    });
}

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}

async function openSceneSplitter(entryId, videoPath) {
    // Remove existing modal if any
    const existing = document.getElementById("scene-modal");
    if (existing) existing.remove();

    // Fetch entry transcript for scene annotations
    let transcript = "";
    try {
        const res = await fetch(`${API}/api/chapters/${currentChapterId}/entries`);
        const entries = await res.json();
        const entry = entries.find(e => e.id === entryId);
        if (entry && entry.transcript) transcript = entry.transcript;
    } catch (e) { /* ignore */ }

    const modal = document.createElement("div");
    modal.id = "scene-modal";
    modal.innerHTML = `
        <div class="scene-modal-backdrop" onclick="closeSceneModal()"></div>
        <div class="scene-modal-content">
            <div class="scene-modal-header">
                <h3>Scene Splitter</h3>
                <button onclick="closeSceneModal()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;">&times;</button>
            </div>
            <div class="scene-modal-body">
                <video id="scene-video" controls preload="auto" style="width:100%;max-height:300px;background:#000;border-radius:6px;">
                    <source src="/media/${videoPath}" type="video/mp4">
                </video>
                <div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap;">
                    <label style="font-size:13px;color:#555;">Sensitivity:
                        <input type="range" id="scene-sensitivity" min="5" max="60" value="25" style="width:120px;vertical-align:middle;">
                        <span id="scene-sensitivity-val">25</span>
                    </label>
                    <label style="font-size:13px;color:#555;">Sample interval:
                        <select id="scene-interval" style="padding:4px;border-radius:4px;border:1px solid #ddd;">
                            <option value="0.3">0.3s (fast)</option>
                            <option value="0.5" selected>0.5s</option>
                            <option value="1">1s (faster)</option>
                        </select>
                    </label>
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary" id="scene-detect-btn" onclick="runSceneDetection('${videoPath}', ${entryId})">Detect Scenes</button>
                </div>
                <div id="scene-progress" style="display:none;margin-top:12px;">
                    <div style="background:#e0e0e0;border-radius:4px;height:8px;overflow:hidden;">
                        <div id="scene-progress-bar" style="height:100%;background:#7c3aed;width:0%;transition:width 0.2s;"></div>
                    </div>
                    <div id="scene-progress-text" style="font-size:12px;color:#888;margin-top:4px;"></div>
                </div>
                <div id="scene-results" style="margin-top:16px;"></div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    window._sceneTranscript = transcript;

    document.getElementById("scene-sensitivity").addEventListener("input", e => {
        document.getElementById("scene-sensitivity-val").textContent = e.target.value;
    });
}

function closeSceneModal() {
    const modal = document.getElementById("scene-modal");
    if (modal) modal.remove();
}

async function runSceneDetection(videoPath, entryId) {
    const video = document.getElementById("scene-video");
    const btn = document.getElementById("scene-detect-btn");
    const progressWrap = document.getElementById("scene-progress");
    const progressBar = document.getElementById("scene-progress-bar");
    const progressText = document.getElementById("scene-progress-text");
    const resultsDiv = document.getElementById("scene-results");

    btn.disabled = true;
    btn.textContent = "Detecting...";
    progressWrap.style.display = "block";
    resultsDiv.innerHTML = "";

    const threshold = parseInt(document.getElementById("scene-sensitivity").value);
    const interval = parseFloat(document.getElementById("scene-interval").value);

    await new Promise(resolve => {
        if (video.readyState >= 1) return resolve();
        video.addEventListener("loadedmetadata", resolve, { once: true });
    });

    const duration = video.duration;
    const canvas = document.createElement("canvas");
    const cw = 320, ch = Math.round(320 * (video.videoHeight / video.videoWidth) || 180);
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = 160;
    thumbCanvas.height = Math.round(160 * (video.videoHeight / video.videoWidth) || 90);
    const thumbCtx = thumbCanvas.getContext("2d");

    const cuts = [0];
    let prevHash = null;
    const thumbnails = {};

    for (let t = 0; t < duration; t += interval) {
        await seekTo(video, t);
        ctx.drawImage(video, 0, 0, cw, ch);
        const hash = computeFrameHash(ctx, cw, ch);

        if (prevHash !== null) {
            const diff = frameDiff(prevHash, hash);
            if (diff > threshold) {
                cuts.push(t);
            }
        }
        // Capture thumbnail for this cut
        if (cuts[cuts.length - 1] === t || t === 0) {
            thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height);
            thumbnails[t] = thumbCanvas.toDataURL("image/jpeg", 0.7);
        }

        prevHash = hash;
        const pct = Math.round((t / duration) * 100);
        progressBar.style.width = pct + "%";
        progressText.textContent = `Analyzing: ${pct}% (${Math.round(t)}s / ${Math.round(duration)}s)`;
    }

    // Build scenes from cuts
    const scenes = [];
    for (let i = 0; i < cuts.length; i++) {
        const start = cuts[i];
        const end = (i < cuts.length - 1) ? cuts[i + 1] : duration;
        scenes.push({ start, end, thumbnail: thumbnails[start] || thumbnails[0] });
    }

    progressWrap.style.display = "none";
    btn.disabled = false;
    btn.textContent = "Detect Scenes";

    // Render scene results
    if (scenes.length <= 1) {
        resultsDiv.innerHTML = '<p style="color:#888;">No scene changes detected. Try lowering the sensitivity.</p>';
        return;
    }

    // Approximate transcript segments per scene (proportional split by time)
    const transcript = window._sceneTranscript || "";
    const words = transcript ? transcript.split(/\s+/) : [];

    function getSceneTranscript(sceneStart, sceneEnd) {
        if (!words.length || !duration) return "";
        const startPct = sceneStart / duration;
        const endPct = sceneEnd / duration;
        const startWord = Math.floor(startPct * words.length);
        const endWord = Math.min(Math.ceil(endPct * words.length), words.length);
        const excerpt = words.slice(startWord, endWord).join(" ");
        return excerpt.length > 200 ? excerpt.substring(0, 200) + "..." : excerpt;
    }

    let html = `<p style="margin-bottom:12px;font-size:13px;"><strong>${scenes.length} scenes detected.</strong> Select which scenes to save:</p>`;
    html += '<div style="max-height:400px;overflow-y:auto;">';
    scenes.forEach((s, i) => {
        const sceneText = getSceneTranscript(s.start, s.end);
        html += `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:8px;border-bottom:1px solid #f0f0f0;">
                <input type="checkbox" class="scene-check" data-index="${i}" style="margin-top:4px;">
                <img src="${s.thumbnail}" style="width:120px;height:auto;border-radius:4px;flex-shrink:0;cursor:pointer;" onclick="document.getElementById('scene-video').currentTime=${s.start}">
                <div style="flex:1;min-width:0;">
                    <strong style="font-size:13px;">Scene ${i + 1}</strong><br>
                    <span style="font-size:12px;color:#666;">${formatTime(s.start)} \u2013 ${formatTime(s.end)} (${formatTime(s.end - s.start)})</span>
                    ${sceneText ? `<div style="font-size:11px;color:#888;margin-top:4px;line-height:1.4;max-height:40px;overflow:hidden;">${escapeHtml(sceneText)}</div>` : ""}
                </div>
                <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;flex-shrink:0;" onclick="saveSingleScene(${entryId}, '${videoPath}', ${i})">Save</button>
            </div>`;
    });
    html += '</div>';
    html += `<div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn btn-primary" onclick="saveSelectedScenes(${entryId}, '${videoPath}')">Save Selected</button>
        <button class="btn btn-secondary" onclick="saveAllScenes(${entryId}, '${videoPath}')">Save All Scenes</button>
    </div>`;

    resultsDiv.innerHTML = html;

    // Store scenes data for saving
    window._detectedScenes = scenes;
}

async function _splitScenes(entryId, sceneList, btn) {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = 'Splitting...<span class="loading"></span>';
    try {
        const res = await fetch(`${API}/api/split-scenes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entry_id: entryId, scenes: sceneList }),
        });
        if (!res.ok) {
            const err = await res.json();
            showToast((err.detail || "Error", "error"));
            return;
        }
        const data = await res.json();
        showToast(`Done! ${data.entries.length} scene(s) saved as new entries.`, "success");
        closeSceneModal();
        if (currentChapterId) await loadEntries(currentChapterId);
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.disabled = false;
        btn.textContent = origText;
    }
}

async function saveSelectedScenes(entryId, videoPath) {
    const scenes = window._detectedScenes;
    if (!scenes) return;
    const checks = document.querySelectorAll(".scene-check:checked");
    const selected = Array.from(checks).map(cb => {
        const i = parseInt(cb.dataset.index);
        return { start: formatTime(scenes[i].start), end: formatTime(scenes[i].end) };
    });
    if (selected.length === 0) { showToast("Select at least one scene.", "warning"); return; }
    await _splitScenes(entryId, selected, event.target);
}

async function saveAllScenes(entryId, videoPath) {
    const scenes = window._detectedScenes;
    if (!scenes) return;
    const all = scenes.map(s => ({ start: formatTime(s.start), end: formatTime(s.end) }));
    await _splitScenes(entryId, all, event.target);
}

async function saveSingleScene(entryId, videoPath, index) {
    const scenes = window._detectedScenes;
    if (!scenes || !scenes[index]) return;
    const s = scenes[index];
    await _splitScenes(entryId, [{ start: formatTime(s.start), end: formatTime(s.end) }], event.target);
}

// --- RAG Semantic Search ---

let ragTextModel = null;
let ragIndexData = null;
let ragIndexType = null; // "chapter" or "bulk"
let allAvailableIndexes = [];

// Cache RAG state per chapter/folder so switching back restores it
const ragStateCache = {}; // key: "chapter_<id>" or "bulk_<folder>" -> { query, statusHtml, resultsHtml, indexData }

function saveRagState(key) {
    const queryEl = document.getElementById("rag-search-input");
    const statusEl = document.getElementById("rag-search-status");
    const resultsEl = document.getElementById("rag-search-results");
    if (!queryEl) return;
    ragStateCache[key] = {
        query: queryEl.value,
        statusHtml: statusEl ? statusEl.innerHTML : "",
        resultsHtml: resultsEl ? resultsEl.innerHTML : "",
        indexData: ragIndexData,
        visible: document.getElementById("rag-search-section").style.display !== "none",
    };
}

function restoreRagState(key) {
    const cached = ragStateCache[key];
    if (!cached) return false;
    const queryEl = document.getElementById("rag-search-input");
    const statusEl = document.getElementById("rag-search-status");
    const resultsEl = document.getElementById("rag-search-results");
    const section = document.getElementById("rag-search-section");
    if (queryEl) queryEl.value = cached.query;
    if (statusEl) statusEl.innerHTML = cached.statusHtml;
    if (resultsEl) resultsEl.innerHTML = cached.resultsHtml;
    if (section) section.style.display = cached.visible ? "block" : "none";
    ragIndexData = cached.indexData;
    return true;
}

async function loadTransformersModel() {
    if (ragTextModel) return;
    const T = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3");
    ragTextModel = await T.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "fp32", device: "wasm" });
}

async function embedText(text) {
    const output = await ragTextModel(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

function cosineSim(a, b) {
    let dot = 0, nA = 0, nB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) { dot += a[i] * b[i]; nA += a[i] * a[i]; nB += b[i] * b[i]; }
    return dot / (Math.sqrt(nA) * Math.sqrt(nB) + 1e-8);
}

async function buildChapterIndex() {
    if (!currentChapterId) return;
    const btn = document.getElementById("build-index-btn");
    btn.disabled = true;
    btn.innerHTML = 'Building...<span class="loading"></span>';

    // Show progress in the RAG search section area
    const ragSection = document.getElementById("rag-search-section");
    ragSection.style.display = "block";
    const resultsEl = document.getElementById("rag-search-results");
    const statusEl = document.getElementById("rag-search-status");
    resultsEl.innerHTML = `
        <div class="download-progress-bar download-progress-pulse" style="margin-bottom:8px;">
            <div class="download-progress-bar-fill"></div>
        </div>
        <div style="font-size:13px;color:#555;">Building search index from transcripts...<br>
        <span style="font-size:11px;color:#999;">First run downloads the embedding model (~90MB) and may take a few minutes.</span></div>
    `;
    statusEl.textContent = "";

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600000);
        const res = await fetch(`${API}/api/chapters/${currentChapterId}/build-index`, {
            method: "POST",
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
            const err = await res.json();
            resultsEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">${escapeHtml(err.detail || "Index build failed.")}</div>`;
            return;
        }
        const data = await res.json();
        resultsEl.innerHTML = `<div style="color:#16a34a;font-size:13px;">Index built! ${data.videos} videos, ${data.chunks} text chunks indexed. You can now search above.</div>`;
        await loadAllIndexes();
        await loadChapterRagIndex();
    } catch (e) {
        if (e.name === "AbortError") {
            resultsEl.innerHTML = '<div style="color:#d97706;font-size:13px;">Index build timed out. Try again — the model is now cached and should be faster.</div>';
        } else {
            resultsEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">Error: ${escapeHtml(e.message)}</div>`;
        }
    } finally {
        btn.disabled = false;
        btn.textContent = "Build Index for RAG";
    }
}

async function loadAllIndexes() {
    try {
        const res = await fetch(`${API}/api/indexes`);
        if (res.ok) allAvailableIndexes = await res.json();
    } catch (e) { allAvailableIndexes = []; }

    // Populate the dropdown
    const select = document.getElementById("rag-index-select");
    if (!select) return;
    select.innerHTML = '<option value="">Current chapter</option>';
    allAvailableIndexes.forEach((idx, i) => {
        const opt = document.createElement("option");
        opt.value = idx.url;
        opt.textContent = idx.name;
        if (idx.type === "chapter" && idx.chapter_id === currentChapterId) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });

    // Show RAG section if any indexes exist
    if (allAvailableIndexes.length > 0) {
        document.getElementById("rag-search-section").style.display = "block";
    }
}

async function onRagIndexChange() {
    const select = document.getElementById("rag-index-select");
    const url = select.value;
    clearRagSearch();
    if (!url) {
        // Load current chapter index
        await loadChapterRagIndex();
        return;
    }
    try {
        const res = await fetch(url);
        if (res.ok) {
            ragIndexData = await res.json();
            ragIndexType = "selected";
            document.getElementById("rag-search-section").style.display = "block";
        }
    } catch (e) { ragIndexData = null; }
}

async function loadChapterRagIndex() {
    if (!currentChapterId) return;
    try {
        const res = await fetch(`${API}/api/chapters/${currentChapterId}/index`);
        if (res.ok) {
            ragIndexData = await res.json();
            ragIndexType = "chapter";
            document.getElementById("rag-search-section").style.display = "block";
        }
    } catch (e) { /* no index yet */ }
}

async function ragSearch() {
    const query = document.getElementById("rag-search-input").value.trim();
    if (!query || !ragIndexData) return;
    const statusEl = document.getElementById("rag-search-status");
    const resultsEl = document.getElementById("rag-search-results");

    statusEl.textContent = "Loading model...";
    try { await loadTransformersModel(); } catch (e) { statusEl.textContent = "Model failed to load."; return; }

    statusEl.textContent = "Searching...";
    const queryEmb = await embedText(query);

    const chunks = ragIndexData.text_chunks;
    const scored = [];
    for (let i = 0; i < chunks.ids.length; i++) {
        scored.push({
            text: chunks.documents[i],
            metadata: chunks.metadatas[i],
            score: cosineSim(queryEmb, chunks.embeddings[i]),
        });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.filter(r => r.score >= 0.15).slice(0, 10);

    statusEl.innerHTML = results.length
        ? `${results.length} result(s) found. <span style="font-size:11px;color:#999;">Score ranges from 0 to 1. Closer to 1 = more semantically related to your query. Above 0.3 is a strong match, 0.15\u20130.3 is related.</span>`
        : "No relevant results.";
    resultsEl.innerHTML = "";

    results.forEach(r => {
        const vid = ragIndexData.videos[r.metadata.video_id];
        const card = document.createElement("div");
        card.style.cssText = "padding:10px;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:8px;transition:border-color 0.15s;";
        card.onmouseenter = () => card.style.borderColor = "#7c3aed";
        card.onmouseleave = () => card.style.borderColor = "#e0e0e0";

        const score = r.score >= 0.3 ? "strong" : "related";
        const scoreColor = r.score >= 0.3 ? "#16a34a" : "#d97706";
        const hasTime = r.metadata.start || r.metadata.end;
        const timeLabel = hasTime ? `${formatTime(r.metadata.start)} \u2013 ${formatTime(r.metadata.end)}` : "";
        const videoPath = vid ? vid.video_path : "";
        const entryId = r.metadata.video_id;

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <strong style="font-size:13px;">${escapeHtml(vid ? vid.title : "Unknown")}</strong>
                <span style="font-size:11px;font-weight:600;color:${scoreColor};">${score} (${r.score.toFixed(3)})</span>
            </div>
            ${timeLabel ? `<div style="font-size:11px;color:#7c3aed;margin-bottom:4px;">${timeLabel}</div>` : ""}
            <div style="font-size:12px;color:#666;line-height:1.4;max-height:60px;overflow:hidden;">${escapeHtml(r.text.substring(0, 300))}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
                <span style="font-size:11px;color:#999;">${r.metadata.type}</span>
                ${hasTime && videoPath ? `<button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="event.stopPropagation(); ragTrimAndSave(${entryId}, '${videoPath}', '${formatTime(r.metadata.start)}', '${formatTime(r.metadata.end)}', this)">Trim &amp; Save</button>` : ""}
            </div>
        `;
        if (vid && vid.video_path) {
            card.style.cursor = "pointer";
            card.onclick = () => {
                const videoEl = document.querySelector(`[data-id="${r.metadata.video_id}"]`);
                if (videoEl) videoEl.scrollIntoView({ behavior: "smooth", block: "center" });
            };
        }
        resultsEl.appendChild(card);
    });
}

async function buildBulkIndex() {
    if (!currentBulkFolder) return;
    const btn = document.getElementById("bulk-build-index-btn");
    btn.disabled = true;
    btn.innerHTML = 'Building...<span class="loading"></span>';

    const ragSection = document.getElementById("bulk-rag-section");
    ragSection.style.display = "block";
    const resultsEl = document.getElementById("bulk-rag-results");
    const statusEl = document.getElementById("bulk-rag-status");
    resultsEl.innerHTML = `
        <div class="download-progress-bar download-progress-pulse" style="margin-bottom:8px;">
            <div class="download-progress-bar-fill"></div>
        </div>
        <div style="font-size:13px;color:#555;">Building search index from transcripts...<br>
        <span style="font-size:11px;color:#999;">First run downloads the embedding model (~90MB) and may take a few minutes.</span></div>
    `;
    statusEl.textContent = "";

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600000);
        const res = await fetch(`${API}/api/bulk/folders/${encodeURIComponent(currentBulkFolder)}/build-index`, {
            method: "POST",
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) {
            const err = await res.json();
            resultsEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">${escapeHtml(err.detail || "Index build failed.")}</div>`;
            return;
        }
        const data = await res.json();
        resultsEl.innerHTML = `<div style="color:#16a34a;font-size:13px;">Index built! ${data.videos} videos, ${data.chunks} text chunks indexed. You can now search above.</div>`;
        await loadBulkRagIndex();
    } catch (e) {
        if (e.name === "AbortError") {
            resultsEl.innerHTML = '<div style="color:#d97706;font-size:13px;">Index build timed out. Try again — the model is now cached and should be faster.</div>';
        } else {
            resultsEl.innerHTML = `<div style="color:#ef4444;font-size:13px;">Error: ${escapeHtml(e.message)}</div>`;
        }
    } finally {
        btn.disabled = false;
        btn.textContent = "Build Index for RAG";
    }
}

async function loadBulkRagIndex() {
    if (!currentBulkFolder) return;
    try {
        const res = await fetch(`${API}/api/bulk/folders/${encodeURIComponent(currentBulkFolder)}/index`);
        if (res.ok) {
            ragIndexData = await res.json();
            ragIndexType = "bulk";
            document.getElementById("bulk-rag-section").style.display = "block";
        }
    } catch (e) { /* no index yet */ }
}

async function ragSearchBulk() {
    const query = document.getElementById("bulk-rag-input").value.trim();
    if (!query || !ragIndexData) return;
    const statusEl = document.getElementById("bulk-rag-status");
    const resultsEl = document.getElementById("bulk-rag-results");

    statusEl.textContent = "Loading model...";
    try { await loadTransformersModel(); } catch (e) { statusEl.textContent = "Model failed to load."; return; }

    statusEl.textContent = "Searching...";
    const queryEmb = await embedText(query);

    const chunks = ragIndexData.text_chunks;
    const scored = [];
    for (let i = 0; i < chunks.ids.length; i++) {
        scored.push({
            text: chunks.documents[i],
            metadata: chunks.metadatas[i],
            score: cosineSim(queryEmb, chunks.embeddings[i]),
        });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.filter(r => r.score >= 0.15).slice(0, 10);

    statusEl.innerHTML = results.length
        ? `${results.length} result(s) found. <span style="font-size:11px;color:#999;">Score: 0\u20131. Closer to 1 = more related.</span>`
        : "No relevant results.";
    resultsEl.innerHTML = "";

    results.forEach(r => {
        const vid = ragIndexData.videos[r.metadata.video_id];
        const card = document.createElement("div");
        card.style.cssText = "padding:10px;background:#fff;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:8px;";
        const score = r.score >= 0.3 ? "strong" : "related";
        const scoreColor = r.score >= 0.3 ? "#16a34a" : "#d97706";
        const hasTime = r.metadata.start || r.metadata.end;
        const timeLabel = hasTime ? `${formatTime(r.metadata.start)} \u2013 ${formatTime(r.metadata.end)}` : "";
        const videoPath = vid ? vid.video_path : "";

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <strong style="font-size:13px;">${escapeHtml(vid ? vid.title : "Unknown")}</strong>
                <span style="font-size:11px;font-weight:600;color:${scoreColor};">${score} (${r.score.toFixed(3)})</span>
            </div>
            ${timeLabel ? `<div style="font-size:11px;color:#7c3aed;margin-bottom:4px;">${timeLabel}</div>` : ""}
            <div style="font-size:12px;color:#666;line-height:1.4;max-height:60px;overflow:hidden;">${escapeHtml(r.text.substring(0, 300))}</div>
            ${hasTime && videoPath ? `<div style="margin-top:6px;"><button class="btn btn-secondary" style="font-size:11px;padding:3px 8px;" onclick="ragTrimAndSave(0, '${videoPath}', '${formatTime(r.metadata.start)}', '${formatTime(r.metadata.end)}', this)">Trim &amp; Save</button></div>` : ""}
        `;
        resultsEl.appendChild(card);
    });
}

function clearRagSearch() {
    document.getElementById("rag-search-input").value = "";
    document.getElementById("rag-search-status").textContent = "";
    document.getElementById("rag-search-results").innerHTML = "";
}

function clearBulkRagSearch() {
    document.getElementById("bulk-rag-input").value = "";
    document.getElementById("bulk-rag-status").textContent = "";
    document.getElementById("bulk-rag-results").innerHTML = "";
}

async function ragTrimAndSave(entryId, videoPath, start, end, btn) {
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Trimming...<span class="loading"></span>';
    try {
        const res = await fetch(`${API}/api/trim`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_path: videoPath, start, end, entry_id: entryId || null }),
        });
        if (!res.ok) {
            const err = await res.json();
            showToast((err.detail || "Error", "error"));
            return;
        }
        const data = await res.json();
        const fullPath = `app/media/${data.video_path}`;
        showToast(`Trimmed clip saved: ${fullPath}`, "success");
        if (currentChapterId) await loadEntries(currentChapterId);
    } catch (e) {
        showToast(e.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
    loadNotebooks();

    document.getElementById("notebook-dropdown").addEventListener("change", onNotebookChange);

    document.getElementById("new-chapter-name").addEventListener("keydown", (e) => {
        if (e.key === "Enter") addChapter();
    });

    document.getElementById("search-input").addEventListener("input", onSearch);

    document.getElementById("rag-search-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") ragSearch();
    });
    document.getElementById("bulk-rag-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") ragSearchBulk();
    });
});
