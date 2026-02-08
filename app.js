const CONFIG = {
  folderId: "1fqGy1NvJqnzl0JOU3B6LmChKrrlW_SM3",
  gasEndpoint: "https://script.google.com/macros/s/AKfycbxPFDVWRucQd7jhwBbR_irX1TsndO0HH6X2n_-TZ3pECZdB4tSySEehQz3taeuUf1E/exec", 
  topCount: 8,
  gridPageSize: 48,
  scanForFeatured: 30,     
  measureConcurrency: 6,   
  autoplayMs: 4000
};

const UI = {
  statusText: document.getElementById("statusText"),
  statusBox: document.getElementById("statusBox"),

  featuredStage: document.getElementById("featuredStage"),
  featuredStrip: document.getElementById("featuredStrip"),
  featuredCount: document.getElementById("featuredCount"),
  btnRefreshFeatured: document.getElementById("btnRefreshFeatured"),

  grid: document.getElementById("grid"),
  btnLoadMore: document.getElementById("btnLoadMore"),

  searchInput: document.getElementById("searchInput"),
  totalCount: document.getElementById("totalCount"),
  favCount: document.getElementById("favCount"),

  btnPlay: document.getElementById("btnPlay"),
  btnShuffle: document.getElementById("btnShuffle"),

  year: document.getElementById("year"),

  // Lightbox
  lightbox: document.getElementById("lightbox"),
  lbImg: document.getElementById("lbImg"),
  lbName: document.getElementById("lbName"),
  lbMeta: document.getElementById("lbMeta"),
  lbIndex: document.getElementById("lbIndex"),
  lbPrev: document.getElementById("lbPrev"),
  lbNext: document.getElementById("lbNext"),
  lbFav: document.getElementById("lbFav"),
  lbOpenDrive: document.getElementById("lbOpenDrive"),
  lbDownload: document.getElementById("lbDownload"),
  lbPlay: document.getElementById("lbPlay"),
};

UI.year.textContent = String(new Date().getFullYear());

const LS_FAVS_KEY = `vhdg_vcc_favs_${CONFIG.folderId}`;

let state = {
  all: [],          // toàn bộ ảnh (đã lọc mimeType image/)
  filtered: [],     // sau khi search
  visibleCount: 0,  // số ảnh đang render trong grid
  favorites: new Set(),
  featured: [],     // danh sách ảnh nổi bật
  current: null,    // ảnh đang xem trong lightbox
  currentIndex: -1, // index trong state.filtered
  playing: false,
  timer: null,
};

function setStatus(text, ok = true){
  UI.statusText.textContent = text;
  UI.statusBox.style.opacity = "1";
  const dot = UI.statusBox.querySelector(".dot");
  if(dot){
    dot.style.background = ok ? "#22c55e" : "#ef4444";
    dot.style.boxShadow = ok ? "0 0 0 6px rgba(34,197,94,.12)" : "0 0 0 6px rgba(239,68,68,.12)";
  }
}

function prettyBytes(bytes){
  if(bytes == null || isNaN(bytes)) return "—";
  const units = ["B","KB","MB","GB"];
  let n = Number(bytes);
  let i = 0;
  while(n >= 1024 && i < units.length - 1){
    n /= 1024; i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function driveImgUrl(id, width){
  // Link nhúng ảnh từ Google Drive dạng googleusercontent (ổn định hơn link /view).
  // Có thể thêm tham số resize: =w1200 hoặc =w600-h600
  return `https://lh3.googleusercontent.com/d/${id}=w${width}`;
}

function driveViewUrl(id){
  return `https://drive.google.com/file/d/${id}/view?usp=sharing`;
}

function driveDownloadUrl(id){
  return `https://drive.google.com/uc?export=download&id=${id}`;
}

function getFavs(){
  try{
    const raw = localStorage.getItem(LS_FAVS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  }catch(_){
    return new Set();
  }
}

function saveFavs(){
  localStorage.setItem(LS_FAVS_KEY, JSON.stringify(Array.from(state.favorites)));
  UI.favCount.textContent = String(state.favorites.size);
}

/** JSONP loader (tránh CORS khi gọi Apps Script web app) */
function loadFromGAS(){
  if(!CONFIG.gasEndpoint) return Promise.reject(new Error("Chưa cấu hình gasEndpoint."));
  const endpoint = CONFIG.gasEndpoint.replace(/\/+$/, "");
  return new Promise((resolve, reject) => {
    const cbName = `__drive_cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    window[cbName] = (payload) => {
      cleanup();
      resolve(payload);
    };

    const script = document.createElement("script");
    const url = `${endpoint}?folder=${encodeURIComponent(CONFIG.folderId)}&callback=${encodeURIComponent(cbName)}`;
    script.src = url;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Không tải được dữ liệu từ Apps Script (script load error)."));
    };
    document.head.appendChild(script);

    function cleanup(){
      try{ delete window[cbName]; }catch(_){}
      script.remove();
    }
  });
}

async function loadFromLocalJson(){
  const res = await fetch("./photos.json", { cache: "no-store" });
  if(!res.ok) throw new Error("Không tải được photos.json (hãy xem README.md để cấu hình).");
  return await res.json();
}

async function loadData(){
  setStatus("Đang tải danh sách ảnh…");
  let payload = null;

  if(CONFIG.gasEndpoint){
    try{
      payload = await loadFromGAS();
    }catch(err){
      console.warn(err);
      setStatus("Không tải được từ Apps Script. Thử fallback photos.json…", false);
      payload = await loadFromLocalJson();
    }
  }else{
    payload = await loadFromLocalJson();
  }

  const files = Array.isArray(payload?.files) ? payload.files : [];
  const images = files
    .filter(f => typeof f?.id === "string" && String(f.mimeType || "").startsWith("image/"))
    .map(f => ({
      id: f.id,
      name: f.name || "Ảnh",
      mimeType: f.mimeType || "",
      size: Number(f.size || 0),
      modifiedTime: f.modifiedTime || f.updated || "",
      // score placeholders:
      area: null,
      w: null,
      h: null,
    }));

  // Sort ổn định (mặc định: file lớn hơn trước -> thường chất lượng tốt hơn)
  images.sort((a,b) => (b.size || 0) - (a.size || 0));

  return images;
}

function normalize(s){
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");
}

function applySearch(){
  const q = normalize((UI.searchInput?.value ?? "").trim());

  if(!q){
    state.filtered = state.all.slice();
  }else{
    state.filtered = state.all.filter(item => normalize(item.name).includes(q));
  }

  state.visibleCount = 0;
  UI.grid.innerHTML = "";
  renderMore();
  updateCounts();
}

function updateCounts(){
  UI.totalCount.textContent = String(state.filtered.length);
  UI.favCount.textContent = String(state.favorites.size);
}

function makeStarEl(id){
  const el = document.createElement("div");
  el.className = "star";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.title = "Gắn sao / bỏ sao";
  el.textContent = "★";
  el.dataset.on = state.favorites.has(id) ? "1" : "0";

  const toggle = (ev) => {
    ev?.stopPropagation?.();
    toggleFavorite(id);
  };
  el.addEventListener("click", toggle);
  el.addEventListener("keydown", (e) => {
    if(e.key === "Enter" || e.key === " "){
      e.preventDefault();
      toggle(e);
    }
  });

  return el;
}

function renderCard(item, index){
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = item.id;
  card.dataset.index = String(index);

  const imgBox = document.createElement("div");
  imgBox.className = "card__img";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = item.name || "Ảnh";
  img.src = driveImgUrl(item.id, 800);
  imgBox.appendChild(img);

  const body = document.createElement("div");
  body.className = "card__body";
  const name = document.createElement("p");
  name.className = "card__name";
  name.textContent = item.name || "Ảnh";
  const meta = document.createElement("div");
  meta.className = "card__meta";
  meta.textContent = `${prettyBytes(item.size)} • ${item.mimeType || "image"}`;
  body.appendChild(name);
  body.appendChild(meta);

  const star = makeStarEl(item.id);

  card.appendChild(imgBox);
  card.appendChild(body);
  card.appendChild(star);

  card.addEventListener("click", () => openLightboxById(item.id));
  return card;
}

function renderMore(){
  const start = state.visibleCount;
  const end = Math.min(state.filtered.length, start + CONFIG.gridPageSize);

  for(let i = start; i < end; i++){
    const item = state.filtered[i];
    UI.grid.appendChild(renderCard(item, i));
  }

  state.visibleCount = end;
  UI.btnLoadMore.disabled = state.visibleCount >= state.filtered.length;
  UI.btnLoadMore.style.display = (state.visibleCount >= state.filtered.length) ? "none" : "inline-flex";
}

function shuffleAll(){
  // Fisher-Yates
  const a = state.all;
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  applySearch();
  refreshFeatured();
}

function toggleFavorite(id){
  if(state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);

  // Update UI stars (grid + lightbox)
  document.querySelectorAll(`.card[data-id="${CSS.escape(id)}"] .star`).forEach(st => {
    st.dataset.on = state.favorites.has(id) ? "1" : "0";
  });

  if(state.current?.id === id){
    UI.lbFav.dataset.on = state.favorites.has(id) ? "1" : "0";
  }

  saveFavs();
  refreshFeatured();
}

function withLimit(limit, tasks){
  // tasks: array of functions that return a promise
  const results = new Array(tasks.length);
  let nextIndex = 0;
  let running = 0;

  return new Promise((resolve, reject) => {
    const runNext = () => {
      if(nextIndex >= tasks.length && running === 0){
        resolve(results);
        return;
      }
      while(running < limit && nextIndex < tasks.length){
        const current = nextIndex++;
        running++;
        Promise.resolve()
          .then(() => tasks[current]())
          .then((res) => { results[current] = res; })
          .catch((err) => { results[current] = { ok:false, err }; })
          .finally(() => {
            running--;
            runNext();
          });
      }
    };
    runNext();
  });
}

function measureImageArea(item){
  // Đo w/h bằng cách tải một bản resize vừa phải
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const w = img.naturalWidth || 0;
      const h = img.naturalHeight || 0;
      resolve({ id: item.id, w, h, area: w * h });
    };
    img.onerror = () => resolve({ id: item.id, w: 0, h: 0, area: 0 });
    img.src = driveImgUrl(item.id, 1000);
  });
}

async function computeFeatured(){
  // 1) Ưu tiên ảnh gắn sao
  const favArr = state.all.filter(x => state.favorites.has(x.id));

  // 2) Ứng viên còn lại: lấy top N theo size, rồi đo diện tích (w*h)
  const remaining = state.all.filter(x => !state.favorites.has(x.id));
  const candidates = remaining.slice(0, Math.min(CONFIG.scanForFeatured, remaining.length));

  const tasks = candidates.map(c => () => measureImageArea(c));
  const measured = await withLimit(CONFIG.measureConcurrency, tasks);

  // apply measurement back
  const areaById = new Map(measured.map(m => [m.id, m]));
  for(const c of candidates){
    const m = areaById.get(c.id);
    if(m){
      c.w = m.w; c.h = m.h; c.area = m.area;
    }
  }

  // Sắp theo area giảm dần (fallback size)
  candidates.sort((a,b) => (b.area || 0) - (a.area || 0) || (b.size || 0) - (a.size || 0));

  const featured = favArr
    .concat(candidates)
    .slice(0, CONFIG.topCount);

  return featured;
}

function renderFeatured(){
  const items = state.featured;
  UI.featuredCount.textContent = `${items.length} ảnh`;

  if(items.length === 0){
    UI.featuredStage.innerHTML = `<div class="skeleton">
      <div class="skeleton__img"></div>
      <div class="skeleton__line"></div>
      <div class="skeleton__line"></div>
    </div>`;
    UI.featuredStrip.innerHTML = "";
    return;
  }

  // Stage: show first image
  const first = items[0];
  UI.featuredStage.innerHTML = "";

  const card = document.createElement("div");
  card.className = "stageCard";

  const imgBox = document.createElement("div");
  imgBox.className = "stageCard__img";
  const img = document.createElement("img");
  img.alt = first.name || "Ảnh nổi bật";
  img.src = driveImgUrl(first.id, 1400);
  imgBox.appendChild(img);

  const cap = document.createElement("div");
  cap.className = "stageCard__cap";
  const left = document.createElement("div");
  const nm = document.createElement("div");
  nm.className = "stageCard__name";
  nm.textContent = first.name || "Ảnh";
  const meta = document.createElement("div");
  meta.className = "stageCard__meta";
  const detail = [];
  if(first.w && first.h) detail.push(`${first.w}×${first.h}`);
  detail.push(prettyBytes(first.size));
  meta.textContent = detail.join(" • ");
  left.appendChild(nm);
  left.appendChild(meta);

  const btn = document.createElement("button");
  btn.className = "btn btn--small";
  btn.type = "button";
  btn.textContent = "Xem";
  btn.addEventListener("click", () => openLightboxById(first.id, true));

  cap.appendChild(left);
  cap.appendChild(btn);

  card.appendChild(imgBox);
  card.appendChild(cap);

  imgBox.addEventListener("click", () => openLightboxById(first.id, true));

  UI.featuredStage.appendChild(card);

  // Strip thumbnails
  UI.featuredStrip.innerHTML = "";
  items.forEach((it, idx) => {
    const t = document.createElement("div");
    t.className = "thumb" + (idx === 0 ? " thumb--active" : "");
    const ti = document.createElement("img");
    ti.alt = it.name || "Ảnh";
    ti.loading = "lazy";
    ti.src = driveImgUrl(it.id, 400);
    t.appendChild(ti);
    t.addEventListener("click", () => {
      // make this the stage image
      state.featured = items; // keep
      setFeaturedStage(idx);
    });
    UI.featuredStrip.appendChild(t);
  });
}

function setFeaturedStage(idx){
  const items = state.featured;
  if(idx < 0 || idx >= items.length) return;
  const it = items[idx];

  // update strip active
  UI.featuredStrip.querySelectorAll(".thumb").forEach((el, i) => {
    el.classList.toggle("thumb--active", i === idx);
  });

  // update stage
  const stageImg = UI.featuredStage.querySelector(".stageCard__img img");
  const stageName = UI.featuredStage.querySelector(".stageCard__name");
  const stageMeta = UI.featuredStage.querySelector(".stageCard__meta");
  const viewBtn = UI.featuredStage.querySelector(".stageCard__cap .btn");

  if(stageImg) stageImg.src = driveImgUrl(it.id, 1400);
  if(stageName) stageName.textContent = it.name || "Ảnh";
  if(stageMeta){
    const detail = [];
    if(it.w && it.h) detail.push(`${it.w}×${it.h}`);
    detail.push(prettyBytes(it.size));
    stageMeta.textContent = detail.join(" • ");
  }
  if(viewBtn){
    viewBtn.onclick = () => openLightboxById(it.id, true);
  }

  const imgBox = UI.featuredStage.querySelector(".stageCard__img");
  if(imgBox){
    imgBox.onclick = () => openLightboxById(it.id, true);
  }
}

async function refreshFeatured(){
  try{
    setStatus("Đang chọn ảnh nổi bật (ưu tiên ảnh gắn sao + độ phân giải)…");
    state.featured = await computeFeatured();
    renderFeatured();
    setStatus(`Đã tải ${state.all.length} ảnh. Bạn có thể gắn sao để chọn ảnh nổi bật.`);
  }catch(err){
    console.error(err);
    setStatus("Có lỗi khi chọn ảnh nổi bật.", false);
  }
}

/* ======================
   Lightbox / Slideshow
   ====================== */

function openLightboxById(id, preferFeatured = false){
  const list = preferFeatured && state.featured.length ? state.featured : state.filtered;
  const idx = list.findIndex(x => x.id === id);
  if(idx === -1) return;

  // In lightbox, we navigate within the same list used to open.
  state.lbList = list;
  state.lbIndex = idx;

  openLightboxAt(idx);
}

function openLightboxAt(idx){
  const list = state.lbList || state.filtered;
  if(!list || idx < 0 || idx >= list.length) return;

  const it = list[idx];
  state.current = it;
  state.currentIndex = idx;

  UI.lightbox.setAttribute("aria-hidden", "false");
  UI.lbImg.src = driveImgUrl(it.id, 2400);
  UI.lbImg.alt = it.name || "Ảnh";
  UI.lbName.textContent = it.name || "Ảnh";
  UI.lbMeta.textContent = `${prettyBytes(it.size)} • ${it.mimeType || "image"}`;
  UI.lbIndex.textContent = `${idx + 1}/${list.length}`;

  UI.lbFav.dataset.on = state.favorites.has(it.id) ? "1" : "0";
  UI.lbOpenDrive.href = driveViewUrl(it.id);
  UI.lbDownload.href = driveDownloadUrl(it.id);

  // stop autoplay by default
  stopAutoplay();

  // focus for keyboard
  UI.lbPlay.focus({ preventScroll: true });
}

function closeLightbox(){
  UI.lightbox.setAttribute("aria-hidden", "true");
  UI.lbImg.src = "";
  stopAutoplay();
}

function nextInLightbox(step){
  const list = state.lbList || state.filtered;
  if(!list || !list.length) return;
  let next = (state.lbIndex ?? 0) + step;
  if(next < 0) next = list.length - 1;
  if(next >= list.length) next = 0;
  state.lbIndex = next;
  openLightboxAt(next);
}

function startAutoplay(){
  if(state.playing) return;
  state.playing = true;
  UI.lbPlay.textContent = "❚❚";
  UI.lbPlay.title = "Tạm dừng (Space)";
  state.timer = window.setInterval(() => nextInLightbox(1), CONFIG.autoplayMs);
}

function stopAutoplay(){
  if(state.timer){
    clearInterval(state.timer);
    state.timer = null;
  }
  state.playing = false;
  UI.lbPlay.textContent = "▶";
  UI.lbPlay.title = "Phát (Space)";
}

function toggleAutoplay(){
  if(state.playing) stopAutoplay();
  else startAutoplay();
}

function hookLightboxEvents(){
  UI.lightbox.addEventListener("click", (e) => {
    const t = e.target;
    if(t && t.getAttribute && t.getAttribute("data-close") === "1"){
      closeLightbox();
    }
  });

  UI.lbPrev.addEventListener("click", () => nextInLightbox(-1));
  UI.lbNext.addEventListener("click", () => nextInLightbox(1));
  UI.lbPlay.addEventListener("click", toggleAutoplay);
  UI.lbFav.addEventListener("click", () => {
    if(state.current) toggleFavorite(state.current.id);
  });

  document.addEventListener("keydown", (e) => {
    const open = UI.lightbox.getAttribute("aria-hidden") === "false";

    if(open){
      if(e.key === "Escape") closeLightbox();
      if(e.key === "ArrowLeft") nextInLightbox(-1);
      if(e.key === "ArrowRight") nextInLightbox(1);
      if(e.key === " "){
        e.preventDefault();
        toggleAutoplay();
      }
      return;
    }
  });
}

/* ======================
   Bootstrap
   ====================== */

async function main(){
  state.favorites = getFavs();
  saveFavs(); // update UI count

  UI.btnLoadMore.addEventListener("click", renderMore);
if (UI.searchInput) {
  UI.searchInput.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(applySearch, 120);
  });
}

  UI.btnRefreshFeatured.addEventListener("click", refreshFeatured);
  UI.btnShuffle.addEventListener("click", shuffleAll);

  UI.btnPlay.addEventListener("click", () => {
    // open slideshow with featured if available
    if(state.featured.length){
      openLightboxById(state.featured[0].id, true);
    }else if(state.filtered.length){
      openLightboxAt(0);
    }else{
      alert("Chưa có ảnh để trình chiếu.");
      return;
    }
    startAutoplay();
  });

  hookLightboxEvents();

  try{
    state.all = await loadData();
    state.filtered = state.all.slice();
    updateCounts();

    setStatus(`Đã tải danh sách: ${state.all.length} ảnh. Đang dựng lưới ảnh…`);
    renderMore();

    await refreshFeatured();

  }catch(err){
    console.error(err);
    setStatus("Không tải được dữ liệu. Hãy xem README.md để cấu hình nguồn ảnh.", false);

    UI.featuredStage.innerHTML = `
      <div class="stageCard">
        <div class="stageCard__cap">
          <div>
            <div class="stageCard__name">Chưa cấu hình nguồn dữ liệu</div>
            <div class="stageCard__meta">
              Hãy mở README.md và làm theo hướng dẫn (Apps Script hoặc photos.json).
            </div>
          </div>
          <a class="btn btn--small" href="./README.md" target="_blank" rel="noreferrer">Mở README</a>
        </div>
      </div>
    `;
    UI.btnLoadMore.style.display = "none";
  }
}

main();
