const STORAGE_KEY        = "giloa-v7";
const FOG_ENABLED_KEY    = "giloa-fog-enabled";
const FOG_ALPHA          = 0.8;
const FOG_RADIUS_M       = 18;
const MIN_MOVE_M         = 15;
const MAX_ACCURACY_M     = 20;
const STAY_ACCURACY_FACTOR = 0.6;
const MAX_STAY_RADIUS_M  = 36;
const SAVE_DELAY_MS      = 800;
const MERGE_DISTANCE_M   = 6;
const MERGE_TIME_GAP_MS  = 2 * 60 * 1000;
const MAX_PATH_POINTS    = 5000;

const FULL_VISIBILITY_HOURS = 0;
const MIN_VISIBILITY_HOURS  = 24;
const MIN_PATH_VISIBILITY   = 0.4;

const THREE_DAYS_IN_DAYS   = 3;
const ONE_MONTH_DAYS       = 30;
const THREE_MONTHS_DAYS    = 90;
const SIX_MONTHS_DAYS      = 180;
const ONE_YEAR_DAYS        = 365;
const SEDIMENT_LAYER_COLOR = "rgba(126, 112, 96, 0.24)";

// ── 상태 ──────────────────────────────────────────
let isRecording   = false;
let photos        = [];
const photoMarkers  = new Map();
let isFogEnabled  = true;
let isHudExpanded = false;
let currentPos    = null;
let pathCoordinates = [];
let memories      = [];
let totalDistance = 0;
let playerMarker  = null;
let watchId       = null;
let saveTimer     = null;
let rafId         = null;
const memoryMarkers = new Map();

// ── DOM ───────────────────────────────────────────
const recBtn       = document.getElementById("rec-btn");
const recStatusBox = document.getElementById("rec-status-box");

// ── 지도 ──────────────────────────────────────────
const map = L.map("map", { zoomControl: false, attributionControl: false })
    .setView([37.5665, 126.978], 16);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png").addTo(map);

map.createPane("memoryPane");
map.getPane("memoryPane").style.zIndex = 1500;

// ── 캔버스 ────────────────────────────────────────
const fogCanvas  = document.getElementById("fog-canvas");
const ageCanvas  = document.getElementById("age-canvas");
const stayCanvas = document.getElementById("stay-canvas");
const fogCtx     = fogCanvas.getContext("2d");
const ageCtx     = ageCanvas.getContext("2d");
const stayCtx    = stayCanvas.getContext("2d");

function resizeCanvas() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    [fogCanvas, ageCanvas, stayCanvas].forEach(c => {
        c.width  = w; c.height = h;
        c.style.width  = w + "px";
        c.style.height = h + "px";
        c.style.top  = "0";
        c.style.left = "0";
    });
    scheduleRender();
}

window.addEventListener("resize", resizeCanvas);
map.on("move zoom", scheduleRender);

function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => { rafId = null; render(); });
}

function render() {
    renderFog();
    renderAgeTint();
    renderStayTint();
}

// ── 픽셀 변환 (렌더마다 한 번만 계산) ─────────────
function calcMpp() {
    const center = map.getCenter();
    const pt  = map.latLngToContainerPoint(center);
    const ll2 = map.containerPointToLatLng(L.point(pt.x + 10, pt.y));
    const mpp = center.distanceTo(ll2);
    return mpp || 1;
}

function metersToPixels(meters, mpp) {
    return (meters / mpp) * 10;
}

// ── 안개 레이어 ───────────────────────────────────
function renderFog() {
    const w = fogCanvas.width, h = fogCanvas.height;
    fogCtx.clearRect(0, 0, w, h);
    if (!isFogEnabled) return;

    fogCtx.fillStyle = `rgba(8, 10, 18, ${FOG_ALPHA})`;
    fogCtx.fillRect(0, 0, w, h);
    if (pathCoordinates.length === 0) return;

    const now = Date.now();
    // ✅ mpp 한 번만 계산
    const mpp    = calcMpp();
    const radius = metersToPixels(FOG_RADIUS_M, mpp);

    fogCtx.save();
    fogCtx.globalCompositeOperation = "destination-out";

    pathCoordinates.forEach((point, i) => {
        const ageHours = (now - point.startTime) / 3600000;
        fogCtx.globalAlpha = getPathVisibility(ageHours);

        const pos = map.latLngToContainerPoint([point.lat, point.lng]);

        fogCtx.beginPath();
        fogCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        fogCtx.fill();

        if (i > 0) {
            const prev = map.latLngToContainerPoint([
                pathCoordinates[i - 1].lat,
                pathCoordinates[i - 1].lng
            ]);
            fogCtx.beginPath();
            fogCtx.lineWidth  = radius * 1.7;
            fogCtx.lineCap    = "round";
            fogCtx.lineJoin   = "round";
            fogCtx.moveTo(prev.x, prev.y);
            fogCtx.lineTo(pos.x, pos.y);
            fogCtx.stroke();
        }
    });

    fogCtx.restore();
}

function getPathVisibility(ageHours) {
    if (ageHours <= FULL_VISIBILITY_HOURS) return 1;
    if (ageHours >= MIN_VISIBILITY_HOURS)  return MIN_PATH_VISIBILITY;
    const progress = ageHours / MIN_VISIBILITY_HOURS;
    return 1 - (1 - MIN_PATH_VISIBILITY) * progress;
}

// ── 경과 일수 색상 레이어 ─────────────────────────
// ✅ clip 방식 제거 → 점마다 독립적으로 색상 적용
function renderAgeTint() {
    const w = ageCanvas.width, h = ageCanvas.height;
    ageCtx.clearRect(0, 0, w, h);
    if (pathCoordinates.length === 0) return;

    const now = Date.now();
    const mpp    = calcMpp();
    const radius = metersToPixels(FOG_RADIUS_M, mpp);

    pathCoordinates.forEach((point, i) => {
        const ageDays = (now - point.startTime) / 86400000;
        const color   = getAgeColor(ageDays);
        if (!color) return;

        const pos = map.latLngToContainerPoint([point.lat, point.lng]);

        ageCtx.fillStyle   = color;
        ageCtx.strokeStyle = color;

        ageCtx.beginPath();
        ageCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ageCtx.fill();

        if (i > 0) {
            const prev = map.latLngToContainerPoint([
                pathCoordinates[i - 1].lat,
                pathCoordinates[i - 1].lng
            ]);
            ageCtx.beginPath();
            ageCtx.lineWidth  = radius * 1.15;
            ageCtx.lineCap    = "round";
            ageCtx.lineJoin   = "round";
            ageCtx.moveTo(prev.x, prev.y);
            ageCtx.lineTo(pos.x, pos.y);
            ageCtx.stroke();
        }
    });
}

function getAgeColor(ageDays) {
    if (ageDays < THREE_DAYS_IN_DAYS)  return null;
    if (ageDays < ONE_MONTH_DAYS)      return "rgba(173, 255, 120, 0.16)";
    if (ageDays < THREE_MONTHS_DAYS)   return "rgba(60,  170,  80, 0.18)";
    if (ageDays < SIX_MONTHS_DAYS)     return "rgba(214, 176,  55, 0.18)";
    if (ageDays < ONE_YEAR_DAYS)       return "rgba(130,  92,  55, 0.20)";
    return SEDIMENT_LAYER_COLOR;
}

// ── 머문 시간 레이어 ──────────────────────────────
// ✅ destination-out을 fog-canvas에 간접 적용 → stay-canvas에는 source-over 사용
function renderStayTint() {
    const w = stayCanvas.width, h = stayCanvas.height;
    stayCtx.clearRect(0, 0, w, h);
    if (pathCoordinates.length === 0) return;

    const mpp = calcMpp();

    pathCoordinates.forEach(point => {
        const stayMin = (point.endTime - point.startTime) / 60000;
        if (stayMin < 10) return;

        const pos    = map.latLngToContainerPoint([point.lat, point.lng]);
        const radius = metersToPixels(getStayRadiusMeters(stayMin), mpp);

        const grad = stayCtx.createRadialGradient(
            pos.x, pos.y, 0,
            pos.x, pos.y, radius
        );
        grad.addColorStop(0,   "rgba(255, 220, 100, 0.18)");
        grad.addColorStop(0.6, "rgba(255, 220, 100, 0.08)");
        grad.addColorStop(1,   "rgba(255, 220, 100, 0)");

        stayCtx.fillStyle = grad;
        stayCtx.beginPath();
        stayCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        stayCtx.fill();
    });
}

function getStayRadiusMeters(stayMin) {
    if (stayMin < 10)   return FOG_RADIUS_M;
    if (stayMin >= 180) return FOG_RADIUS_M * 2.0;
    const progress = (stayMin - 10) / (180 - 10);
    return FOG_RADIUS_M * (1.0 + progress);
}

// ── HUD ───────────────────────────────────────────
function toggleHud() {
    isHudExpanded = !isHudExpanded;
    document.getElementById("hud").classList.toggle("expanded", isHudExpanded);
    document.getElementById("controls").classList.toggle("hud-open", isHudExpanded);
    document.getElementById("help-btn").classList.toggle("hud-open", isHudExpanded);
}

// ── UI 동기화 ─────────────────────────────────────
function syncRecordingUI() {
    recBtn.classList.toggle("recording", isRecording);
    recStatusBox.textContent = isRecording ? "기록 중" : "대기 중";
    recStatusBox.classList.toggle("recording", isRecording);
}

function syncFogButton() {
    const toggleBtn   = document.getElementById("fog-toggle-btn");
    const toggleState = document.getElementById("fog-toggle-state");
    if (!toggleBtn) return;

    toggleBtn.classList.toggle("on",  isFogEnabled);
    toggleBtn.classList.toggle("off", !isFogEnabled);
    if (toggleState) {
        toggleState.textContent = isFogEnabled ? "켜짐" : "꺼짐";
        toggleState.classList.toggle("on",  isFogEnabled);
        toggleState.classList.toggle("off", !isFogEnabled);
    }
}

function toggleHelp() {
    document.getElementById("help-popup").classList.toggle("show");
}

// ── 기록 토글 ─────────────────────────────────────
function resetRecordingState() {
    isRecording = false;
    syncRecordingUI();
    stopTracking();
}

function toggleRecording() {
    if (isRecording) {
        isRecording = false;
        syncRecordingUI();
        stopTracking();
        compactPathData();
        scheduleSave();
        return;
    }
    isRecording = true;
    syncRecordingUI();
    startTracking();
}

function toggleFog() {
    isFogEnabled = !isFogEnabled;
    localStorage.setItem(FOG_ENABLED_KEY, String(isFogEnabled));
    syncFogButton();
    scheduleRender();
}

// ── GPS 시작/중단 ──────────────────────────────────
function startTracking() {
    if (!navigator.geolocation) {
        alert("이 브라우저는 위치 추적을 지원하지 않습니다.");
        resetRecordingState(); return;
    }
    if (!window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1") {
        alert("위치 추적은 HTTPS 또는 localhost에서만 동작합니다.");
        resetRecordingState(); return;
    }
    watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleLocationError,
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
}

// ── GPS 처리 ──────────────────────────────────────
function handlePosition(position) {
    const accuracy = Number(position.coords.accuracy) || Infinity;
    const latlng   = L.latLng(position.coords.latitude, position.coords.longitude);
    currentPos     = latlng;

    if (!playerMarker) {
        playerMarker = L.marker(latlng, {
            icon: L.divIcon({ className: "player-marker", iconSize: [18, 18] })
        }).addTo(map);
        map.setView(latlng, 16);
    } else {
        playerMarker.setLatLng(latlng);
    }

    if (!isRecording) return;

    if (accuracy > MAX_ACCURACY_M) {
        recStatusBox.textContent = `GPS 약함 (${Math.round(accuracy)}m)`;
        return;
    }

    recStatusBox.textContent = "기록 중";
    const now = Date.now();

    if (pathCoordinates.length === 0) {
        pathCoordinates.push(createPathPoint(latlng, now));
        updateStats();
        scheduleSave();
        scheduleRender();
        return;
    }

    const last           = pathCoordinates[pathCoordinates.length - 1];
    const dist           = distanceToPoint(latlng, last);
    const stayThreshold  = getDynamicStayThreshold(accuracy);

    if (dist <= stayThreshold) {
        // 머무는 중 — 좌표 스무딩
        last.endTime = now;
        last.visits  = (last.visits || 1) + 1;
        const sf = 0.3;
        last.lat += (latlng.lat - last.lat) * sf;
        last.lng += (latlng.lng - last.lng) * sf;
    } else {
        // 이동 — 새 점 추가
        totalDistance += dist;
        pathCoordinates.push(createPathPoint(latlng, now));
        if (pathCoordinates.length > MAX_PATH_POINTS) compactPathData();
    }

    updateStats();
    scheduleSave();
    scheduleRender();
}

function handleLocationError(err) {
    const messages = {
        1: "위치 권한이 거부되었습니다.",
        2: "현재 위치를 확인할 수 없습니다.",
        3: "위치 요청 시간이 초과되었습니다."
    };
    alert(messages[err.code] || "위치 정보를 가져오지 못했습니다.");
    resetRecordingState();
}

function createPathPoint(latlng, timestamp) {
    return { lat: latlng.lat, lng: latlng.lng,
             startTime: timestamp, endTime: timestamp, visits: 1 };
}

function distanceToPoint(latlng, point) {
    return latlng.distanceTo([point.lat, point.lng]);
}

function getDynamicStayThreshold(accuracy) {
    return Math.max(MIN_MOVE_M, Math.min(MAX_STAY_RADIUS_M, accuracy * STAY_ACCURACY_FACTOR));
}

// ── 오늘 거리 계산 ────────────────────────────────
// ✅ handlePosition 누적 제거 → calcTodayDistance() 하나로 통일
function calcTodayDistance() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    let dist = 0;
    for (let i = 1; i < pathCoordinates.length; i++) {
        if (pathCoordinates[i].startTime >= todayStartMs) {
            const prev = pathCoordinates[i - 1];
            const cur  = pathCoordinates[i];
            dist += L.latLng(cur.lat, cur.lng).distanceTo([prev.lat, prev.lng]);
        }
    }
    return dist;
}

// ── 통계 업데이트 ─────────────────────────────────
// ✅ memo-val → memory-count-val 로 수정
function updateStats() {
    const todayDist = calcTodayDistance();

    document.getElementById("dist-val").innerHTML =
        `${(totalDistance / 1000).toFixed(2)}<span>km</span>`;

    document.getElementById("today-dist-val").innerHTML =
        `${(todayDist / 1000).toFixed(2)}<span>km</span>`;

    document.getElementById("memory-count-val").innerHTML =
        `${memories.length}<span>개</span>`;
}

// ── 경로 압축 ─────────────────────────────────────
function compactPathData() {
    if (pathCoordinates.length <= 1) return;
    const merged = [];
    for (const point of pathCoordinates) {
        const last = merged[merged.length - 1];
        if (!last) { merged.push({ ...point }); continue; }
        const timeGap = point.startTime - last.endTime;
        const dist    = L.latLng(point.lat, point.lng).distanceTo([last.lat, last.lng]);
        if (dist <= MERGE_DISTANCE_M && timeGap <= MERGE_TIME_GAP_MS) {
            const tv = (last.visits || 1) + (point.visits || 1);
            last.lat     = ((last.lat * (last.visits || 1)) + (point.lat * (point.visits || 1))) / tv;
            last.lng     = ((last.lng * (last.visits || 1)) + (point.lng * (point.visits || 1))) / tv;
            last.endTime = Math.max(last.endTime, point.endTime);
            last.visits  = tv;
        } else {
            merged.push({ ...point });
        }
    }
    pathCoordinates = shrinkOldPoints(merged, MAX_PATH_POINTS);
}

function shrinkOldPoints(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    const keepTail = Math.floor(maxPoints * 0.4);
    const tail = points.slice(-keepTail);
    const head = points.slice(0, points.length - keepTail);
    const ratio = Math.ceil(head.length / (maxPoints - keepTail));
    return [...head.filter((_, i) => i % ratio === 0), ...tail].slice(-maxPoints);
}

// ── 기억 마킹 ─────────────────────────────────────
function addMemory() {
    if (!currentPos) { alert("위치 정보를 수신 중입니다."); return; }
    const input = prompt("이 장소의 이름을 입력하세요:", "새로운 발견");
    if (input === null) return;

    const now  = new Date();
    const data = {
        id:         String(now.getTime()),
        lat:        currentPos.lat,
        lng:        currentPos.lng,
        name:       escapeHtml(input.trim() || "기억의 지점"),
        time:       now.getTime(),
        dateString: now.toLocaleDateString("ko-KR",
            { year: "numeric", month: "long", day: "numeric" }),
        timeString: now.toLocaleTimeString("ko-KR",
            { hour: "2-digit", minute: "2-digit" })
    };

    memories.push(data);
    createMemoryMarker(data, true);
    updateMemoryList();
    updateStats();
    scheduleSave();
}

// ✅ id를 data 속성으로 전달해서 onclick 특수문자 문제 방지
function createMemoryMarker(data, openPopup = false) {
    const marker = L.marker([data.lat, data.lng], {
        pane: "memoryPane",
        icon: L.divIcon({ className: "memory-marker", html: "★", iconSize: [28, 28] })
    }).addTo(map);

    const popupEl = document.createElement("div");
    popupEl.innerHTML =
        `<b>${data.name}</b><br>` +
        `<small>${data.dateString} ${data.timeString || ""}</small><br>`;

    const delBtn = document.createElement("button");
    delBtn.className   = "popup-delete-btn";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => deleteMemory(data.id));
    popupEl.appendChild(delBtn);

    marker.bindPopup(popupEl);
    memoryMarkers.set(data.id, marker);
    if (openPopup) marker.openPopup();
}

function deleteMemory(id) {
    memories = memories.filter(m => m.id !== id);
    const marker = memoryMarkers.get(id);
    if (marker) { map.removeLayer(marker); memoryMarkers.delete(id); }
    updateMemoryList();
    updateStats();
    scheduleSave();
}

function updateMemoryList() {
    const container = document.getElementById("memory-list-container");
    if (!container) return;

    if (memories.length === 0) {
        container.innerHTML = '<p class="empty-message">아직 기록이 없습니다.</p>';
        return;
    }

    container.innerHTML = "";
    [...memories].reverse().forEach(memo => {
        const item = document.createElement("div");
        item.className = "memory-item";

        const name = document.createElement("span");
        name.className   = "item-name";
        name.textContent = "★ " + memo.name;

        const date = document.createElement("span");
        date.className   = "item-date";
        date.textContent = memo.dateString + " " + (memo.timeString || "");

        const actions = document.createElement("div");
        actions.className = "memory-actions";

        const moveBtn = document.createElement("button");
        moveBtn.className   = "memory-action-btn move";
        moveBtn.textContent = "이동";
        moveBtn.addEventListener("click", e => {
            e.stopPropagation();
            map.flyTo([memo.lat, memo.lng], 17);
        });

        const delBtn = document.createElement("button");
        delBtn.className   = "memory-action-btn delete";
        delBtn.textContent = "삭제";
        delBtn.addEventListener("click", e => {
            e.stopPropagation();
            deleteMemory(memo.id);
        });

        actions.appendChild(moveBtn);
        actions.appendChild(delBtn);
        item.appendChild(name);
        item.appendChild(date);
        item.appendChild(actions);

        item.addEventListener("click", () => {
            map.flyTo([memo.lat, memo.lng], 17);
            toggleSidebar(false);
        });

        container.appendChild(item);
    });
}

function toggleSidebar(forceOpen) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!sidebar || !overlay) return;
    const willOpen = typeof forceOpen === "boolean"
        ? forceOpen
        : !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", willOpen);
    overlay.classList.toggle("show", willOpen);
}

function centerMap() {
    if (currentPos) map.panTo(currentPos);
}

// ── localStorage ──────────────────────────────────
function scheduleSave() {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        compactPathData();
        persistState();
    }, SAVE_DELAY_MS);
}

function persistState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            pathCoordinates: pathCoordinates.map(p => ({
                lat: p.lat, lng: p.lng,
                startTime: p.startTime, endTime: p.endTime,
                visits: p.visits || 1
            })),
            memories: memories.map(m => ({
                id: m.id, lat: m.lat, lng: m.lng,
                name: m.name, time: m.time,
                dateString: m.dateString, timeString: m.timeString
            })),
            photos: photos.map(p => ({
                id: p.id, lat: p.lat, lng: p.lng,
                photo: p.photo, time: p.time,
                dateString: p.dateString, timeString: p.timeString
            })),
            totalDistance
        }));
    } catch (e) { console.error("저장 실패", e); }
}

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);

        if (Array.isArray(saved.pathCoordinates)) {
            pathCoordinates = saved.pathCoordinates
                .filter(p => isFinite(p.lat) && isFinite(p.lng) &&
                             isFinite(p.startTime) && isFinite(p.endTime))
                .map(p => ({
                    lat: p.lat, lng: p.lng,
                    startTime: p.startTime, endTime: p.endTime,
                    visits: isFinite(p.visits) ? p.visits : 1
                }));
        }

        if (Array.isArray(saved.memories)) {
            memories = saved.memories
                .filter(m => isFinite(m.lat) && isFinite(m.lng) &&
                             typeof m.name === "string")
                .map(m => ({
                    id: typeof m.id === "string" ? m.id : String(m.time),
                    lat: m.lat, lng: m.lng,
                    name: m.name, time: m.time,
                    dateString: m.dateString,
                    timeString: typeof m.timeString === "string"
                        ? m.timeString
                        : new Date(m.time).toLocaleTimeString("ko-KR",
                            { hour: "2-digit", minute: "2-digit" })
                }));
        }

        if (isFinite(saved.totalDistance)) totalDistance = saved.totalDistance;

        if (Array.isArray(saved.photos)) {
            photos = saved.photos.filter(p =>
                isFinite(p.lat) && isFinite(p.lng) && typeof p.photo === "string"
            );
        }

        const savedFog = localStorage.getItem(FOG_ENABLED_KEY);
        if (savedFog !== null) isFogEnabled = savedFog === "true";

        compactPathData();
    } catch (e) { console.error("복원 실패", e); }
}

// ── 사진 처리 ─────────────────────────────────────
function handlePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;

    const arrayReader = new FileReader();
    arrayReader.onload = function(ae) {
        const buffer = ae.target.result;
        const gps    = parseExifGps(buffer);

        const reader = new FileReader();
        reader.onload = function(e) {
            const base64 = e.target.result;
            const now    = new Date();
            const img    = new Image();

            img.onload = function() {
                const canvas  = document.createElement("canvas");
                const maxSize = 400;
                let w = img.width, h = img.height;
                if (w > h && w > maxSize) { h = h * maxSize / w; w = maxSize; }
                else if (h > maxSize)     { w = w * maxSize / h; h = maxSize; }
                canvas.width = w; canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                const compressed = canvas.toDataURL("image/jpeg", 0.6);

                const lat = gps ? gps.lat : (currentPos ? currentPos.lat : null);
                const lng = gps ? gps.lng : (currentPos ? currentPos.lng : null);

                if (!lat || !lng) {
                    alert("사진에 위치 정보가 없고 현재 위치도 수신 중입니다.");
                    return;
                }
                if (!gps && currentPos) {
                    alert("사진에 위치 정보가 없어 현재 위치에 저장합니다.");
                }

                const data = {
                    id:         String(now.getTime()),
                    lat, lng,
                    photo:      compressed,
                    time:       now.getTime(),
                    dateString: now.toLocaleDateString("ko-KR",
                        { year: "numeric", month: "long", day: "numeric" }),
                    timeString: now.toLocaleTimeString("ko-KR",
                        { hour: "2-digit", minute: "2-digit" })
                };

                photos.push(data);
                createPhotoMarker(data, true);
                map.flyTo([lat, lng], 17);
                scheduleSave();
            };
            img.src = base64;
        };
        reader.readAsDataURL(file);
    };
    arrayReader.readAsArrayBuffer(file);
    event.target.value = "";
}

function parseExifGps(buffer) {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    while (offset < view.byteLength) {
        const marker = view.getUint16(offset);
        offset += 2;
        if (marker === 0xFFE1) {
            const exifHeader = String.fromCharCode(
                view.getUint8(offset + 2), view.getUint8(offset + 3),
                view.getUint8(offset + 4), view.getUint8(offset + 5)
            );
            if (exifHeader !== "Exif") break;

            const tiffOffset  = offset + 8;
            const littleEndian = view.getUint16(tiffOffset) === 0x4949;
            const getU16 = o => view.getUint16(tiffOffset + o, littleEndian);
            const getU32 = o => view.getUint32(tiffOffset + o, littleEndian);

            const ifdOffset = getU32(4);
            const ifdCount  = getU16(ifdOffset);

            let gpsIfdOffset = null;
            for (let i = 0; i < ifdCount; i++) {
                const e = ifdOffset + 2 + i * 12;
                if (getU16(e) === 0x8825) gpsIfdOffset = getU32(e + 8);
            }
            if (gpsIfdOffset === null) return null;

            const gpsCount = getU16(gpsIfdOffset);
            let latRef, lat, lngRef, lng;

            for (let i = 0; i < gpsCount; i++) {
                const e   = gpsIfdOffset + 2 + i * 12;
                const tag = getU16(e);
                const vo  = getU32(e + 8);

                if (tag === 1) latRef = String.fromCharCode(view.getUint8(tiffOffset + vo));
                if (tag === 3) lngRef = String.fromCharCode(view.getUint8(tiffOffset + vo));

                if (tag === 2 || tag === 4) {
                    const d = getU32(vo)    / getU32(vo + 4);
                    const m = getU32(vo + 8) / getU32(vo + 12);
                    const s = getU32(vo + 16) / getU32(vo + 20);
                    const val = d + m / 60 + s / 3600;
                    if (tag === 2) lat = val;
                    if (tag === 4) lng = val;
                }
            }

            if (lat == null || lng == null) return null;
            return {
                lat: latRef === "S" ? -lat : lat,
                lng: lngRef === "W" ? -lng : lng
            };
        }
        offset += view.getUint16(offset);
    }
    return null;
}

function createPhotoMarker(data, openPopup = false) {
    const icon = L.divIcon({
        className: "photo-marker",
        html:      `<img src="${data.photo}" />`,
        iconSize:  [44, 44],
        iconAnchor:[22, 44]
    });

    const marker = L.marker([data.lat, data.lng], {
        pane: "memoryPane", icon
    }).addTo(map);

    const popupEl = document.createElement("div");
    popupEl.className = "photo-popup";

    const img = document.createElement("img");
    img.src = data.photo;

    const info = document.createElement("div");
    info.style.cssText = "margin-top:6px;font-size:12px;color:rgba(255,255,255,0.7);text-align:center;";
    info.textContent   = `${data.dateString}\n${data.timeString}`;

    popupEl.appendChild(img);
    popupEl.appendChild(info);
    marker.bindPopup(popupEl);

    photoMarkers.set(data.id, marker);
    if (openPopup) marker.openPopup();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ── 초기화 ────────────────────────────────────────
// ✅ map.whenReady() 후 복원 — 좌표 변환 오류 방지
function init() {
    resizeCanvas();
    loadState();
    renderStoredMarkers();
    renderStoredPhotoMarkers();
    updateStats();
    updateMemoryList();
    syncRecordingUI();
    syncFogButton();
    scheduleRender();
}

function renderStoredMarkers()      { memories.forEach(m => createMemoryMarker(m, false)); }
function renderStoredPhotoMarkers() { photos.forEach(p   => createPhotoMarker(p,  false)); }

map.whenReady(() => init());
