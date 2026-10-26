// ---------- Labels & settings ----------
const STYLE_LABELS = {
  none: "No style", realistic: "Realistic", anime: "Anime", "3d": "3D",
  watercolor: "Watercolor", cyberpunk: "Cyberpunk", sketch: "Sketch",
};
const SIZE_LABELS = { square: "Square", landscape: "Landscape", portrait: "Portrait" };

const LOADING_MESSAGES = [
  "Mixing the colors…",
  "Sketching your idea…",
  "Adding the details…",
  "Painting the light…",
  "Almost there…",
];

const HISTORY_KEY = "dreamcanvas_history";
const MAX_HISTORY = 12;

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>`;

// ---------- Elements ----------
const promptEl = document.getElementById("prompt");
const promptBox = document.querySelector(".prompt-box");
const charCount = document.getElementById("charCount");
const generateBtn = document.getElementById("generateBtn");
const generateLabel = generateBtn.querySelector("span");

const preview = document.getElementById("preview");
const emptyState = document.getElementById("emptyState");
const loadingState = document.getElementById("loadingState");
const loadingText = document.getElementById("loadingText");
const loadingTimer = document.getElementById("loadingTimer");
const resultImage = document.getElementById("resultImage");
const errorState = document.getElementById("errorState");
const errorText = document.getElementById("errorText");

const resultInfo = document.getElementById("resultInfo");
const resultPrompt = document.getElementById("resultPrompt");
const resultStyle = document.getElementById("resultStyle");
const resultSize = document.getElementById("resultSize");
const downloadBtn = document.getElementById("downloadBtn");
const regenerateBtn = document.getElementById("regenerateBtn");
const copyPromptBtn = document.getElementById("copyPromptBtn");

const gallery = document.getElementById("gallery");
const galleryEmpty = document.getElementById("galleryEmpty");
const clearGalleryBtn = document.getElementById("clearGallery");
const themeToggle = document.getElementById("themeToggle");

// ---------- State ----------
let selectedStyle = "none";
let selectedSize = "square";
let current = null;          // the image shown in the preview
let previewState = "empty";  // empty / loading / result / error
let isLoading = false;
let messageTimer = null;
let clockTimer = null;
let history = loadHistory();

// ---------- Saving the gallery in the browser ----------
function loadHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

function saveHistory() {
  // If the browser storage is full, drop the oldest image and try again
  while (true) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return;
    } catch (e) {
      if (history.length <= 1) return;
      history.pop();
    }
  }
}

// ---------- Style & size pickers ----------
function setupPicker(selector, onSelect) {
  const buttons = document.querySelectorAll(selector);
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onSelect(btn);
    });
  });
}

// Highlight a picker button from code (used by "Use again")
function selectOption(selector, key, value) {
  document.querySelectorAll(selector).forEach((b) => {
    b.classList.toggle("active", b.dataset[key] === value);
  });
}

setupPicker(".style-option", (btn) => { selectedStyle = btn.dataset.style; });
setupPicker(".size-option", (btn) => {
  selectedSize = btn.dataset.size;
  // Show the new shape right away, unless an image is being shown or created
  if (previewState === "empty" || previewState === "error") setPreviewShape(selectedSize);
});

// ---------- Prompt box ----------
function updateCharCount() {
  charCount.textContent = `${promptEl.value.length} / 500`;
}

promptEl.addEventListener("input", updateCharCount);

// Ctrl + Enter = generate
promptEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    generate(promptEl.value, selectedStyle, selectedSize);
  }
});

document.querySelectorAll(".example-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    promptEl.value = chip.dataset.prompt;
    updateCharCount();
    promptEl.focus();
  });
});

// ---------- Preview states ----------
// The preview box takes the shape of the image size (square / landscape / portrait)
function setPreviewShape(size) {
  preview.classList.toggle("is-landscape", size === "landscape");
  preview.classList.toggle("is-portrait", size === "portrait");
}

function showState(state) {
  previewState = state;
  emptyState.classList.toggle("hidden", state !== "empty");
  loadingState.classList.toggle("hidden", state !== "loading");
  resultImage.classList.toggle("hidden", state !== "result");
  errorState.classList.toggle("hidden", state !== "error");
  resultInfo.classList.toggle("hidden", state !== "result");
  preview.classList.toggle("loading", state === "loading");
  if (state === "empty") setPreviewShape(selectedSize);
}

function startLoading() {
  showState("loading");
  let index = 0;
  let seconds = 0;
  loadingText.textContent = LOADING_MESSAGES[0];
  loadingTimer.textContent = "0s";

  messageTimer = setInterval(() => {
    index = (index + 1) % LOADING_MESSAGES.length;
    loadingText.textContent = LOADING_MESSAGES[index];
  }, 2500);

  clockTimer = setInterval(() => {
    seconds++;
    loadingTimer.textContent = `${seconds}s`;
  }, 1000);
}

function stopLoading() {
  clearInterval(messageTimer);
  clearInterval(clockTimer);
}

function setBusy(busy) {
  isLoading = busy;
  generateBtn.disabled = busy;
  regenerateBtn.disabled = busy;
  generateLabel.textContent = busy ? "Creating your image…" : "Generate image";
}

// ---------- Generate ----------
async function generate(prompt, style, size) {
  prompt = prompt.trim();

  if (!prompt) {
    // Shake the prompt box if it's empty
    promptBox.classList.remove("shake");
    void promptBox.offsetWidth;
    promptBox.classList.add("shake");
    promptEl.focus();
    return;
  }
  if (isLoading) return;

  setBusy(true);
  setPreviewShape(size);
  startLoading();
  if (window.innerWidth <= 960) {
    preview.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  try {
    const res = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, style, size }),
    });

    let data = {};
    try { data = await res.json(); } catch (e) {}

    if (!res.ok || data.error) {
      throw new Error(data.error || "Something went wrong. Please try again.");
    }

    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      image: data.image,
      prompt: data.prompt,
      style: data.style,
      size: data.size,
      seed: data.seed,
      createdAt: Date.now(),
    };

    stopLoading();
    showResult(item);
    addToHistory(item);
  } catch (err) {
    stopLoading();
    errorText.textContent = err instanceof TypeError
      ? "Can't reach the server. Check your connection and try again."
      : err.message;
    showState("error");
  } finally {
    setBusy(false);
  }
}

generateBtn.addEventListener("click", () => {
  generate(promptEl.value, selectedStyle, selectedSize);
});

// ---------- Show a result ----------
function makeFilename(item) {
  const slug = item.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "image";
  const ext = item.image.startsWith("data:image/png") ? "png"
    : item.image.startsWith("data:image/webp") ? "webp"
    : "jpg";
  return `dreamcanvas-${slug}-${item.seed}.${ext}`;
}

function showResult(item) {
  current = item;
  setPreviewShape(item.size);
  resultImage.src = item.image;
  resultImage.alt = item.prompt;

  resultPrompt.textContent = item.prompt;
  resultPrompt.dir = "auto";
  resultStyle.textContent = STYLE_LABELS[item.style] || "No style";
  resultSize.textContent = SIZE_LABELS[item.size] || "Square";

  downloadBtn.href = item.image;
  downloadBtn.download = makeFilename(item);

  showState("result");
}

regenerateBtn.addEventListener("click", () => {
  if (current) generate(current.prompt, current.style, current.size);
});

copyPromptBtn.addEventListener("click", async () => {
  if (!current) return;
  const label = copyPromptBtn.querySelector("span");
  try {
    await navigator.clipboard.writeText(current.prompt);
    label.textContent = "Copied!";
  } catch (e) {
    label.textContent = "Failed";
  }
  setTimeout(() => { label.textContent = "Copy prompt"; }, 1500);
});

// ---------- History: reuse an old prompt ----------
function formatDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleString([], {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// Put an old prompt, style and size back into the form
function reuse(item) {
  promptEl.value = item.prompt;
  updateCharCount();

  selectedStyle = STYLE_LABELS[item.style] ? item.style : "none";
  selectedSize = SIZE_LABELS[item.size] ? item.size : "square";
  selectOption(".style-option", "style", selectedStyle);
  selectOption(".size-option", "size", selectedSize);
  if (previewState === "empty" || previewState === "error") setPreviewShape(selectedSize);

  promptEl.scrollIntoView({ behavior: "smooth", block: "center" });
  promptEl.focus({ preventScroll: true });
}

// ---------- Gallery ----------
function addToHistory(item) {
  history.unshift(item);
  history = history.slice(0, MAX_HISTORY);
  saveHistory();
  renderGallery();
}

function renderGallery() {
  gallery.innerHTML = "";
  galleryEmpty.classList.toggle("hidden", history.length > 0);
  clearGalleryBtn.classList.toggle("hidden", history.length === 0);

  history.forEach((item) => {
    const card = document.createElement("div");
    card.className = "gallery-item";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open image: ${item.prompt}`);

    const img = document.createElement("img");
    img.src = item.image;
    img.alt = item.prompt;
    img.loading = "lazy";

    const overlay = document.createElement("div");
    overlay.className = "gallery-overlay";

    const text = document.createElement("p");
    text.dir = "auto";
    text.textContent = item.prompt;

    const tag = document.createElement("span");
    tag.className = "gallery-tag";
    tag.textContent = `${STYLE_LABELS[item.style] || "No style"} · ${SIZE_LABELS[item.size] || "Square"}`;

    const date = document.createElement("span");
    date.className = "gallery-date";
    date.textContent = formatDate(item.createdAt);

    const use = document.createElement("button");
    use.type = "button";
    use.className = "gallery-use";
    use.textContent = "↺ Use again";
    use.setAttribute("aria-label", `Use this prompt again: ${item.prompt}`);
    use.addEventListener("click", (e) => {
      e.stopPropagation();
      reuse(item);
    });

    overlay.append(text, tag, date, use);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "gallery-delete";
    del.title = "Delete image";
    del.setAttribute("aria-label", "Delete image");
    del.innerHTML = TRASH_ICON;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteImage(item.id);
    });

    const open = () => {
      if (isLoading) return;
      showResult(item);
      preview.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.target !== card) return; // let the inner buttons handle their own keys
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    card.append(img, overlay, del);
    gallery.appendChild(card);
  });
}

function deleteImage(id) {
  if (!confirm("Delete this image from your gallery?")) return;
  history = history.filter((i) => i.id !== id);
  saveHistory();
  renderGallery();
  if (current && current.id === id && !isLoading) {
    current = null;
    showState("empty");
  }
}

clearGalleryBtn.addEventListener("click", () => {
  if (!confirm("Delete all images from your gallery?")) return;
  history = [];
  saveHistory();
  renderGallery();
  if (!isLoading) {
    current = null;
    showState("empty");
  }
});

// ---------- Dark mode ----------
function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  try { localStorage.setItem("theme", theme); } catch (e) {}
}

setTheme(document.documentElement.getAttribute("data-theme") || "light");

themeToggle.addEventListener("click", () => {
  const now = document.documentElement.getAttribute("data-theme");
  setTheme(now === "dark" ? "light" : "dark");
});

// ---------- Start ----------
showState("empty");
renderGallery();
updateCharCount();