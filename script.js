const STORAGE_KEY = "giloa-v7";
const FOG_ENABLED_KEY = "giloa-fog-enabled";
const FOG_ALPHA = 0.8;
const FOG_RADIUS_M = 18;
const MIN_MOVE_M = 15;
const MAX_ACCURACY_M = 30;
const STAY_ACCURACY_FACTOR = 0.6;
const MAX_STAY_RADIUS_M = 18;
const SAVE_DELAY_MS = 800;
const MERGE_DISTANCE_M = 6;
const MERGE_TIME_GAP_MS = 2 * 60 * 1000;
const MAX_PATH_POINTS = 5000;

const FULL_VISIBILITY_HOURS = 0;
const MIN_VISIBILITY_HOURS = 24;
const MIN_PATH_VISIBILITY = 0.4;

const THREE_DAYS_IN_DAYS = 3;
const ONE_MONTH_DAYS = 30;
const THREE_MONTHS_DAYS = 90;
const SIX_MONTHS_DAYS = 180;
const ONE_YEAR_DAYS = 365;
const SEDIMENT_LAYER_COLOR = "rgba(126, 112, 96, 0.24)";

let isRecording = false;
let photos = [];
const photoMarkers = new Map();
let isFogEnabled = true;
let isHudExpanded = false;
let currentPos = null;
let pathCoordinates = [];
let memories = [];
let totalDistance = 0;
let todayDistance = 0;
let playerMarker = null;
let watchId = null;
let saveTimer = null;
let rafId = null;
const memoryMarkers = new Map();

const recBtn = document.getElementById("rec-btn");
const recStatusBox = document.getElementById("rec-status-box");

const map = L.map("map", { zoomControl: false, attributionControl: false })
    .setView([37.5665, 126.978], 16);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png").addTo(map);

map.createPane("memoryPane");
map.getPane("memoryPane").style.zIndex = 1500;

const fogCanvas = document.getElementById("fog-canvas");
const ageCanvas = document.getElementById("age-canvas");
const stayCanvas = document.getElementById("stay-canvas");
const fogCtx = fogCanvas.getContext("2d");
const ageCtx = ageCanvas.getContext("2d");
const stayCtx = stayCanvas.getContext("2d");

function resizeCanvas() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    [fogCanvas, ageCanvas, stayCanvas].forEach((canvas) => {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = width + "px";
        canvas.style.height = height + "px";
        canvas.style.top = "0";
        canvas.style.left = "0";
    });
    scheduleRender();
}

window.addEventListener("resize", resizeCanvas);
map.on("move zoom", scheduleRender);

function scheduleRender() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        render();
    });
}

function render() {
    renderFog();
    renderAgeTint();
    renderStayTint();
}

// --- 안개 레이어 ---
function renderFog() {
    const width = fogCanvas.width;
    const height = fogCanvas.height;

    fogCtx.clearRect(0, 0, width, height);
    if (!isFogEnabled) return;

    fogCtx.fillStyle = `rgba(8, 10, 18, ${FOG_ALPHA})`;
    fogCtx.fillRect(0, 0, width, height);

    if (pathCoordinates.length === 0) return;

    const now = Date.now();
    fogCtx.save();
    fogCtx.globalCompositeOperation = "destination-out";

    pathCoordinates.forEach((point, index) => {
        const ageHours = (now - point.startTime) / 3600000;
        fogCtx.globalAlpha = getPathVisibility(ageHours);

        const pos = map.latLngToContainerPoint([point.lat, point.lng]);
        const radius = getMetersToPixels(FOG_RADIUS_M);

        fogCtx.beginPath();
        fogCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        fogCtx.fill();

        if (index > 0) {
            const prev = map.latLngToContainerPoint([
                pathCoordinates[index - 1].lat,
                pathCoordinates[index - 1].lng
            ]);
            fogCtx.beginPath();
            fogCtx.lineWidth = radius * 1.7;
            fogCtx.lineCap = "round";
            fogCtx.lineJoin = "round";
            fogCtx.moveTo(prev.x, prev.y);
            fogCtx.lineTo(pos.x, pos.y);
            fogCtx.stroke();
        }
    });

    fogCtx.restore();
}

function getPathVisibility(ageHours) {
    if (ageHours <= FULL_VISIBILITY_HOURS) return 1;
    if (ageHours >= MIN_VISIBILITY_HOURS) return MIN_PATH_VISIBILITY;
    const progress = ageHours / MIN_VISIBILITY_HOURS;
    return 1 - (1 - MIN_PATH_VISIBILITY) * progress;
}

// --- age 경과 일수 레이어 ---
function renderAgeTint() {
    const width = ageCanvas.width;
    const height = ageCanvas.height;

    ageCtx.clearRect(0, 0, width, height);
    if (pathCoordinates.length === 0) return;

    const now = Date.now();

    ageCtx.save();
    ageCtx.beginPath();

    pathCoordinates.forEach((point, index) => {
        const pos = map.latLngToContainerPoint([point.lat, point.lng]);
        const radius = getMetersToPixels(FOG_RADIUS_M);

        ageCtx.moveTo(pos.x + radius, pos.y);
        ageCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);

        if (index > 0) {
            const prev = map.latLngToContainerPoint([
                pathCoordinates[index - 1].lat,
                pathCoordinates[index - 1].lng
            ]);
            const dx = pos.x - prev.x;
            const dy = pos.y - prev.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / len * radius * 0.85;
            const ny = dx / len * radius * 0.85;

            ageCtx.moveTo(prev.x + nx, prev.y + ny);
            ageCtx.lineTo(pos.x + nx, pos.y + ny);
            ageCtx.lineTo(pos.x - nx, pos.y - ny);
            ageCtx.lineTo(prev.x - nx, prev.y - ny);
            ageCtx.closePath();
        }
    });

    ageCtx.clip();

    pathCoordinates.forEach((point, index) => {
        const ageDays = (now - point.startTime) / 86400000;
        const color = getAgeColor(ageDays);
        if (!color) return;

        const pos = map.latLngToContainerPoint([point.lat, point.lng]);
        const radius = getMetersToPixels(FOG_RADIUS_M);

        ageCtx.fillStyle = color;
        ageCtx.strokeStyle = color;

        ageCtx.beginPath();
        ageCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ageCtx.fill();

        if (index > 0) {
            const prev = map.latLngToContainerPoint([
                pathCoordinates[index - 1].lat,
                pathCoordinates[index - 1].lng
            ]);
            ageCtx.beginPath();
            ageCtx.lineWidth = radius * 1.15;
            ageCtx.lineCap = "round";
            ageCtx.lineJoin = "round";
            ageCtx.moveTo(prev.x, prev.y);
            ageCtx.lineTo(pos.x, pos.y);
            ageCtx.stroke();
        }
    });

    ageCtx.restore();
}

function getAgeColor(ageDays) {
    if (ageDays < THREE_DAYS_IN_DAYS) return null;
    if (ageDays < ONE_MONTH_DAYS)     return "rgba(173, 255, 120, 0.16)";
    if (ageDays < THREE_MONTHS_DAYS)  return "rgba(60, 170, 80, 0.18)";
    if (ageDays < SIX_MONTHS_DAYS)    return "rgba(214, 176, 55, 0.18)";
    if (ageDays < ONE_YEAR_DAYS)      return "rgba(130, 92, 55, 0.20)";
    return SEDIMENT_LAYER_COLOR;
}

// --- stay 머문 시간 레이어 ---
function renderStayTint() {
    const width = stayCanvas.width;
    const height = stayCanvas.height;

    stayCtx.clearRect(0, 0, width, height);
    if (pathCoordinates.length === 0) return;

    stayCtx.save();
    stayCtx.globalCompositeOperation = "destination-out";

    pathCoordinates.forEach((point) => {
        const stayMin = (point.endTime - point.startTime) / 60000;
        if (stayMin < 10) return;

        const pos = map.latLngToContainerPoint([point.lat, point.lng]);
        const radius = getMetersToPixels(getStayRadiusMeters(stayMin));

        const grad = stayCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
        grad.addColorStop(0,   "rgba(0, 0, 0, 0.6)");
        grad.addColorStop(0.6, "rgba(0, 0, 0, 0.3)");
        grad.addColorStop(1,   "rgba(0, 0, 0, 0)");

        stayCtx.beginPath();
        stayCtx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        stayCtx.fillStyle = grad;
        stayCtx.fill();
    });

    stayCtx.restore();
}

function getStayRadiusMeters(stayMin) {
    if (stayMin < 10) return FOG_RADIUS_M;
    if (stayMin >= 180) return FOG_RADIUS_M * 2.0;
    const progress = (stayMin - 10) / (180 - 10);
    const scale = 1.0 + (2.0 - 1.0) * progress;
    return FOG_RADIUS_M * scale;
}

function getMetersToPixels(meters) {
    const center = map.getCenter();
    const pt = map.latLngToContainerPoint(center);
    const ll2 = map.containerPointToLatLng(L.point(pt.x + 10, pt.y));
    const mpp = center.distanceTo(ll2);
    return mpp ? (meters / mpp) * 10 : 1;
}

// --- HUD 펼침/닫힘 ---
function toggleHud() {
    isHudExpanded = !isHudExpanded;
    const hud = document.getElementById("hud");
    const controls = document.getElementById("controls");
    const helpBtn = document.getElementById("help-btn");

    hud.classList.toggle("expanded", isHudExpanded);
    controls.classList.toggle("hud-open", isHudExpanded);
    helpBtn.classList.toggle("hud-open", isHudExpanded);
}

// --- UI 제어 ---
function syncRecordingUI() {
    recBtn.classList.toggle("recording", isRecording);
    recStatusBox.textContent = isRecording ? "기록 중" : "대기 중";
    recStatusBox.classList.toggle("recording", isRecording);
}

function syncFogButton() {
    const toggleBtn = document.getElementById("fog-toggle-btn");
    const toggleState = document.getElementById("fog-toggle-state");
    if (!toggleBtn) return;

    if (isFogEnabled) {
        toggleBtn.classList.add("on");
        toggleBtn.classList.remove("off");
        if (toggleState) {
            toggleState.textContent = "켜짐";
            toggleState.classList.add("on");
            toggleState.classList.remove("off");
        }
    } else {
        toggleBtn.classList.add("off");
        toggleBtn.classList.remove("on");
        if (toggleState) {
            toggleState.textContent = "꺼짐";
            toggleState.classList.add("off");
            toggleState.classList.remove("on");
        }
    }
}

function toggleHelp() {
    document.getElementById("help-popup").classList.toggle("show");
}

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

function startTracking() {
    if (!navigator.geolocation) {
        alert("이 브라우저는 위치 추적을 지원하지 않습니다.");
        resetRecordingState();
        return;
    }
    if (!window.isSecureContext &&
        location.hostname !== "localhost" &&
        location.hostname !== "127.0.0.1") {
        alert("위치 추적은 HTTPS 또는 localhost에서만 동작합니다.");
        resetRecordingState();
        return;
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

// --- GPS 처리 ---
function handlePosition(position) {
    const accuracy = Number(position.coords.accuracy) || Infinity;
    const latlng = L.latLng(position.coords.latitude, position.coords.longitude);
    currentPos = latlng;

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

    const last = pathCoordinates[pathCoordinates.length - 1];
    const dist = distanceToPoint(latlng, last);
    const stayThreshold = getDynamicStayThreshold(accuracy);

    if (dist <= stayThreshold) {
        last.endTime = now;
        last.visits = (last.visits || 1) + 1;
        const smoothFactor = 0.12;
        last.lat = last.lat + (latlng.lat - last.lat) * smoothFactor;
        last.lng = last.lng + (latlng.lng - last.lng) * smoothFactor;
    } else {
        totalDistance += dist;
        todayDistance += dist;
        pathCoordinates.push(createPathPoint(latlng, now));
        if (pathCoordinates.length > MAX_PATH_POINTS) compactPathData();
    }

    updateStats();
    scheduleSave();
    scheduleRender();
}

function handleLocationError(err) {
    let message = "위치 정보를 가져오지 못했습니다.";
    if (err.code === 1) message = "위치 권한이 거부되었습니다.";
    if (err.code === 2) message = "현재 위치를 확인할 수 없습니다.";
    if (err.code === 3) message = "위치 요청 시간이 초과되었습니다.";
    alert(message);
    resetRecordingState();
}

function createPathPoint(latlng, timestamp) {
    return { lat: latlng.lat, lng: latlng.lng, startTime: timestamp, endTime: timestamp, visits: 1 };
}

function distanceToPoint(latlng, point) {
    return latlng.distanceTo([point.lat, point.lng]);
}

function getDynamicStayThreshold(accuracy) {
    return Math.max(MIN_MOVE_M, Math.min(MAX_STAY_RADIUS_M, accuracy * STAY_ACCURACY_FACTOR));
}

// 오늘 이동 거리 계산 (자정 기준)
function calcTodayDistance() {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    let dist = 0;
    for (let i = 1; i < pathCoordinates.length; i++) {
        const p = pathCoordinates[i];
        if (p.startTime >= todayStartMs) {
            const prev = pathCoordinates[i - 1];
            dist += L.latLng(p.lat, p.lng).distanceTo([prev.lat, prev.lng]);
        }
    }
    return dist;
}

// --- 통계 업데이트 ---
function updateStats() {
    document.getElementById("dist-val").innerHTML =
        `${(totalDistance / 1000).toFixed(2)}<span>km</span>`;
    document.getElementById("memo-val").innerText = memories.length;

    // 확장 HUD
    const today = calcTodayDistance();
    document.getElementById("today-dist-val").innerHTML =
        `${(today / 1000).toFixed(2)}<span>km</span>`;
    document.getElementById("memory-count-val").innerHTML =
        `${memories.length}<span>개</span>`;
}

// --- 경로 압축 ---
function compactPathData() {
    if (pathCoordinates.length <= 1) return;
    const merged = [];
    for (const point of pathCoordinates) {
        const last = merged[merged.length - 1];
        if (!last) { merged.push({ ...point }); continue; }
        const timeGap = point.startTime - last.endTime;
        const dist = L.latLng(point.lat, point.lng).distanceTo([last.lat, last.lng]);
        if (dist <= MERGE_DISTANCE_M && timeGap <= MERGE_TIME_GAP_MS) {
            const tv = (last.visits || 1) + (point.visits || 1);
            last.lat = ((last.lat * (last.visits || 1)) + (point.lat * (point.visits || 1))) / tv;
            last.lng = ((last.lng * (last.visits || 1)) + (point.lng * (point.visits || 1))) / tv;
            last.endTime = Math.max(last.endTime, point.endTime);
            last.visits = tv;
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

// --- 기억 마킹 ---
function addMemory() {
    if (!currentPos) { alert("위치 정보를 수신 중입니다."); return; }
    const input = prompt("이 장소의 이름을 입력하세요:", "새로운 발견");
    if (input === null) return;

    const now = new Date();
    const data = {
        id: String(now.getTime()),
        lat: currentPos.lat,
        lng: currentPos.lng,
        name: escapeHtml(input.trim() || "기억의 지점"),
        time: now.getTime(),
        dateString: now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }),
        timeString: now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    };

    memories.push(data);
    createMemoryMarker(data, true);
    updateMemoryList();
    updateStats();
    scheduleSave();
}

function createMemoryMarker(data, openPopup = false) {
    const marker = L.marker([data.lat, data.lng], {
        pane: "memoryPane",
        icon: L.divIcon({ className: "memory-marker", html: "★", iconSize: [28, 28] })
    }).addTo(map);

    marker.bindPopup(
        "<b>" + data.name + "</b><br>" +
        "<small>" + data.dateString + " " + (data.timeString || "") + "</small><br>" +
        '<button onclick="deleteMemory(\'' + data.id + '\')" class="popup-delete-btn">삭제</button>'
    );

    memoryMarkers.set(data.id, marker);
    if (openPopup) marker.openPopup();
}

function deleteMemory(id) {
    memories = memories.filter((m) => m.id !== id);
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
    [...memories].reverse().forEach((memo) => {
        const item = document.createElement("div");
        item.className = "memory-item";
        item.innerHTML =
            '<span class="item-name">★ ' + memo.name + '</span>' +
            '<span class="item-date">' + memo.dateString + " " + (memo.timeString || "") + '</span>' +
            '<div class="memory-actions">' +
            '<button onclick="event.stopPropagation(); map.flyTo([' + memo.lat + ',' + memo.lng + '], 17);" class="memory-action-btn move">이동</button>' +
            '<button onclick="event.stopPropagation(); deleteMemory(\'' + memo.id + '\')" class="memory-action-btn delete">삭제</button>' +
            '</div>';
        item.onclick = () => { map.flyTo([memo.lat, memo.lng], 17); toggleSidebar(false); };
        container.appendChild(item);
    });
}

function toggleSidebar(forceOpen) {
    const sidebar = document.getElementById("sidebar");
    const overlay = document.getElementById("sidebar-overlay");
    if (!sidebar || !overlay) return;
    const willOpen = typeof forceOpen === "boolean" ? forceOpen : !sidebar.classList.contains("open");
    sidebar.classList.toggle("open", willOpen);
    overlay.classList.toggle("show", willOpen);
}

function centerMap() {
    if (currentPos) map.panTo(currentPos);
}

// --- localStorage 저장/복원 ---
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
            pathCoordinates: pathCoordinates.map((p) => ({
                lat: p.lat, lng: p.lng,
                startTime: p.startTime, endTime: p.endTime,
                visits: p.visits || 1
            })),
            memories: memories.map((m) => ({
                id: m.id, lat: m.lat, lng: m.lng,
                name: m.name, time: m.time,
                dateString: m.dateString, timeString: m.timeString
            })),
            photos: photos.map((p) => ({
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
                .filter((p) => isFinite(p.lat) && isFinite(p.lng) && isFinite(p.startTime) && isFinite(p.endTime))
                .map((p) => ({
                    lat: p.lat, lng: p.lng,
                    startTime: p.startTime, endTime: p.endTime,
                    visits: isFinite(p.visits) ? p.visits : 1
                }));
        }

        if (Array.isArray(saved.memories)) {
            memories = saved.memories
                .filter((m) => isFinite(m.lat) && isFinite(m.lng) && typeof m.name === "string")
                .map((m) => ({
                    id: typeof m.id === "string" ? m.id : String(m.time),
                    lat: m.lat, lng: m.lng, name: m.name, time: m.time,
                    dateString: m.dateString,
                    timeString: typeof m.timeString === "string"
                        ? m.timeString
                        : new Date(m.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
                }));
        }

        if (isFinite(saved.totalDistance)) totalDistance = saved.totalDistance;

        if (Array.isArray(saved.photos)) {
            photos = saved.photos.filter((p) =>
                isFinite(p.lat) && isFinite(p.lng) && typeof p.photo === "string"
            );
        }

        const savedFog = localStorage.getItem(FOG_ENABLED_KEY);
        if (savedFog !== null) isFogEnabled = savedFog === "true";

        compactPathData();
    } catch (e) { console.error("복원 실패", e); }
}

function renderStoredMarkers() {
    memories.forEach((m) => createMemoryMarker(m, false));
}

function openCamera() {
    if (!currentPos) {
        alert("위치 정보를 수신 중입니다.");
        return;
    }
    document.getElementById("camera-input").click();
}

// EXIF에서 GPS 좌표 추출
function parseExifGps(buffer) {
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xFFD8) return null;

    let offset = 2;
    while (offset < view.byteLength) {
        const marker = view.getUint16(offset);
        offset += 2;
        if (marker === 0xFFE1) {
            const exifLen = view.getUint16(offset);
            const exifHeader = String.fromCharCode(
                view.getUint8(offset + 2), view.getUint8(offset + 3),
                view.getUint8(offset + 4), view.getUint8(offset + 5)
            );
            if (exifHeader !== "Exif") break;

            const tiffOffset = offset + 8;
            const littleEndian = view.getUint16(tiffOffset) === 0x4949;
            const getUint16 = (o) => view.getUint16(tiffOffset + o, littleEndian);
            const getUint32 = (o) => view.getUint32(tiffOffset + o, littleEndian);

            const ifdOffset = getUint32(4);
            const ifdCount = getUint16(ifdOffset);

            let gpsIfdOffset = null;
            for (let i = 0; i < ifdCount; i++) {
                const entryOffset = ifdOffset + 2 + i * 12;
                if (getUint16(entryOffset) === 0x8825) {
                    gpsIfdOffset = getUint32(entryOffset + 8);
                }
            }

            if (gpsIfdOffset === null) return null;

            const gpsCount = getUint16(gpsIfdOffset);
            let latRef, lat, lngRef, lng;

            for (let i = 0; i < gpsCount; i++) {
                const e = gpsIfdOffset + 2 + i * 12;
                const tag = getUint16(e);
                const valOffset = getUint32(e + 8);

                if (tag === 1) latRef = String.fromCharCode(view.getUint8(tiffOffset + valOffset));
                if (tag === 3) lngRef = String.fromCharCode(view.getUint8(tiffOffset + valOffset));

                if (tag === 2 || tag === 4) {
                    const d = view.getUint32(tiffOffset + valOffset, littleEndian) /
                              view.getUint32(tiffOffset + valOffset + 4, littleEndian);
                    const m = view.getUint32(tiffOffset + valOffset + 8, littleEndian) /
                              view.getUint32(tiffOffset + valOffset + 12, littleEndian);
                    const s = view.getUint32(tiffOffset + valOffset + 16, littleEndian) /
                              view.getUint32(tiffOffset + valOffset + 20, littleEndian);
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

function handlePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;

    const arrayReader = new FileReader();
    arrayReader.onload = function(ae) {
        const buffer = ae.target.result;
        const gps = parseExifGps(buffer);

        const reader = new FileReader();
        reader.onload = function(e) {
            const base64 = e.target.result;
            const now = new Date();

            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement("canvas");
                const maxSize = 400;
                let w = img.width, h = img.height;
                if (w > h && w > maxSize) { h = h * maxSize / w; w = maxSize; }
                else if (h > maxSize) { w = w * maxSize / h; h = maxSize; }
                canvas.width = w;
                canvas.height = h;
                canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                const compressed = canvas.toDataURL("image/jpeg", 0.6);

                // EXIF GPS 있으면 사용, 없으면 현재 위치
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
                    id: String(now.getTime()),
                    lat: lat,
                    lng: lng,
                    photo: compressed,
                    time: now.getTime(),
                    dateString: now.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" }),
                    timeString: now.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
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

function createPhotoMarker(data, openPopup = false) {
    const icon = L.divIcon({
        className: "photo-marker",
        html: "<img src='" + data.photo + "' />",
        iconSize: [44, 44],
        iconAnchor: [22, 44]
    });

    const marker = L.marker([data.lat, data.lng], {
        pane: "memoryPane",
        icon: icon
    }).addTo(map);

    marker.bindPopup(
        "<div class='photo-popup'>" +
        "<img src='" + data.photo + "' />" +
        "<small>" + data.dateString + " " + data.timeString + "</small><br>" +
        "<button onclick='deletePhoto(\"" + data.id + "\")' class='popup-delete-btn'>삭제</button>" +
        "</div>"
    );

    photoMarkers.set(data.id, marker);
    if (openPopup) marker.openPopup();
}

function deletePhoto(id) {
    photos = photos.filter((p) => p.id !== id);
    const marker = photoMarkers.get(id);
    if (marker) { map.removeLayer(marker); photoMarkers.delete(id); }
    scheduleSave();
}

function renderStoredPhotoMarkers() {
    photos.forEach((p) => createPhotoMarker(p, false));
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// --- 초기화 ---
loadState();
renderStoredMarkers();
renderStoredPhotoMarkers();
updateStats();
updateMemoryList();
syncRecordingUI();
syncFogButton();

function init() {
    resizeCanvas();
    scheduleRender();
}

if (document.readyState === "complete") {
    init();
} else {
    window.addEventListener("load", init);
}
