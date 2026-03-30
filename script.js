// --- 설정 상수 ---
const MIN_ALPHA = 0.3; // 최저 30% 농도(시야) 유지
const MAX_FOG = 0.9;   // 안개의 기본 불투명도
const BASE_RADIUS = 18; // 기본 선 굵기

function getDynamicStyle(startTime, endTime) {
    const now = Date.now();
    const hoursAgo = (now - startTime) / 3600000;
    const stayMin = (endTime - startTime) / 60000;

    // 1. 안개 농도 (시간당 10%씩 어두워짐)
    // 1시간에 10% 감소 -> 7시간이면 최저치 30%에 도달 (1.0 - 0.7)
    let currentOpacity = 1.0 - (hoursAgo * 0.1);
    currentOpacity = Math.max(MIN_ALPHA, currentOpacity);

    // 2. 선의 굵기 (체류 시간에 따라 서서히 확장, 3시간(180분)일 때 2배)
    let radiusMultiplier = 1 + Math.min(1, stayMin / 180); 
    const finalRadius = BASE_RADIUS * radiusMultiplier;

    // 3. 색상 숙성 (농도가 30%로 고정된 이후의 색상 변화)
    let color = 'white'; // 초기엔 흰색으로 안개를 걷어냄
    if (currentOpacity <= MIN_ALPHA) {
        if (hoursAgo >= 24 * 365) color = '#8B4513';      // 1년+: 갈색
        else if (hoursAgo >= 24 * 180) color = '#FFD700'; // 6개월+: 노란색
        else if (hoursAgo >= 24 * 30) color = '#008000';  // 1달+: 초록색
        else color = '#ADFF2F';                           // 하루~1달: 연두색
    }

    return { opacity: currentOpacity, radius: finalRadius, color: color };
}

function render() {
    const width = window.innerWidth, height = window.innerHeight;
    fogCtx.clearRect(0, 0, width, height);

    // 1. 전체를 검은 안개로 먼저 채움
    fogCtx.fillStyle = `rgba(8, 10, 18, ${MAX_FOG})`;
    fogCtx.fillRect(0, 0, width, height);

    // 2. 흔적 위치의 안개를 '특정 농도와 색상'으로 걷어냄
    // 'destination-out' 대신 'lighter'나 직접 투명도 조정을 위해 연산
    pathCoordinates.forEach(p => {
        const pos = map.latLngToContainerPoint([p.lat, p.lng]);
        const style = getDynamicStyle(p.startTime, p.endTime);
        const pixelRadius = getMetersToPixels(style.radius);

        // 안개를 걷어내는 효과 (Radial Gradient 활용)
        const grad = fogCtx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, pixelRadius);
        
        // style.opacity만큼 안개를 투명하게 만듦
        // 방금 지나간 곳은 1.0(완전 투명), 오래된 곳은 0.3(살짝 보임)
        grad.addColorStop(0, `rgba(255, 255, 255, ${style.opacity})`); 
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");

        fogCtx.globalCompositeOperation = "destination-out"; // 안개를 파냄
        fogCtx.fillStyle = grad;
        fogCtx.beginPath();
        fogCtx.arc(pos.x, pos.y, pixelRadius, 0, Math.PI * 2);
        fogCtx.fill();

        // 3. 30% 농도가 되었을 때 색상(연두, 초록 등)을 은은하게 덧입힘
        if (style.opacity <= MIN_ALPHA) {
            fogCtx.globalCompositeOperation = "source-over"; // 안개 위에 색칠
            fogCtx.fillStyle = style.color;
            fogCtx.globalAlpha = 0.2; // 아주 은은하게 색상만 표현
            fogCtx.beginPath();
            fogCtx.arc(pos.x, pos.y, pixelRadius * 0.8, 0, Math.PI * 2);
            fogCtx.fill();
            fogCtx.globalAlpha = 1.0;
        }
    });

    updateOverlayMarkers(); // 마커 위치 갱신 (항상 최상단)
}
