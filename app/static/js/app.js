const API = "";
let currentChapterId = null;
let quillEditors = {};
let chapterNotesQuill = null;

// --- Chapter management ---

async function loadChapters() {
    const res = await fetch(`${API}/api/chapters`);
    const chapters = await res.json();
    const list = document.getElementById("chapter-list");
    list.innerHTML = "";
    chapters.forEach(ch => {
        const li = document.createElement("li");
        li.dataset.id = ch.id;
        if (ch.id === currentChapterId) li.classList.add("active");
        li.innerHTML = `
            <span class="chapter-name">${escapeHtml(ch.name)}</span>
            <span class="chapter-actions">
                <button onclick="renameChapter(${ch.id}, event)" title="Rename">✏</button>
                <button onclick="deleteChapter(${ch.id}, event)" title="Delete">✕</button>
            </span>
        `;
        li.addEventListener("click", (e) => {
            if (e.target.tagName === "BUTTON") return;
            selectChapter(ch.id, ch.name);
        });
        list.appendChild(li);
    });
}

async function addChapter() {
    const input = document.getElementById("new-chapter-name");
    const name = input.value.trim();
    if (!name) return;
    await fetch(`${API}/api/chapters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
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
    currentChapterId = id;
    document.querySelectorAll("#chapter-list li").forEach(li => {
        li.classList.toggle("active", parseInt(li.dataset.id) === id);
    });
    document.getElementById("chapter-title").textContent = name;
    document.getElementById("welcome").style.display = "none";
    document.getElementById("chapter-view").style.display = "flex";
    document.getElementById("search-results").style.display = "none";
    await loadChapterNotes(id);
    await loadEntries(id);
}

// --- Chapter notes ---

async function loadChapterNotes(chapterId) {
    const res = await fetch(`${API}/api/chapters/${chapterId}`);
    const chapter = await res.json();

    // Initialize or re-use Quill for chapter notes
    const editorEl = document.getElementById("chapter-notes-editor");
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

function showWelcome() {
    document.getElementById("welcome").style.display = "block";
    document.getElementById("chapter-view").style.display = "none";
    document.getElementById("search-results").style.display = "none";
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
                <div id="${editorId}">${entry.notes || ""}</div>
                <div class="entry-actions">
                    <button class="btn btn-primary" onclick="saveNotes(${entry.id})">Save Notes</button>
                    <button class="btn btn-danger" onclick="deleteEntry(${entry.id})">Delete</button>
                </div>
            </div>
        </div>
    `;

    // Initialize Quill after DOM insertion
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

async function addEntry() {
    const urlInput = document.getElementById("entry-url");
    const notesInput = document.getElementById("entry-notes");
    const btn = document.getElementById("add-entry-btn");
    const url = urlInput.value.trim();

    if (!url || !currentChapterId) return;

    btn.disabled = true;
    btn.innerHTML = 'Downloading...<span class="loading"></span>';

    try {
        const res = await fetch(`${API}/api/entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chapter_id: currentChapterId,
                url: url,
                notes: notesInput.value,
            }),
        });

        if (!res.ok) {
            const err = await res.json();
            alert("Error: " + (err.detail || "Download failed"));
            return;
        }

        urlInput.value = "";
        notesInput.value = "";
        await loadEntries(currentChapterId);
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = "Download & Save";
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
            document.getElementById("chapter-view").style.display = "block";
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

// --- Helpers ---

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

// --- Init ---

document.addEventListener("DOMContentLoaded", () => {
    loadChapters();

    document.getElementById("new-chapter-name").addEventListener("keydown", (e) => {
        if (e.key === "Enter") addChapter();
    });

    document.getElementById("search-input").addEventListener("input", onSearch);
});
