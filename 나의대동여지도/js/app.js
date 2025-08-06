// js/app.js - 앱 초기화 및 메인 로직

class DaedongMapApp {
    constructor() {
        // 데이터
        this.routes = [];
        this.currentRoute = null;
        this.stayAreas = [];
        this.totalDistance = 0;
        this.lastPosition = null;
        this.trackingStartTime = null;
        
        // 시뮬레이션
        this.currentTime = new Date();
        this.simulationRunning = false;
        this.simulationSpeed = 1;
        this.simulationInterval = null;
        
        // 캐시
        this.cachedDistance = null;
        this.cacheUpdateTime = 0;
        this.distanceCache = new Map();
        
        // 모듈 인스턴스
        this.storage = new StorageManager();
        this.gps = new GPSTracker();
        this.map = new MapManager('map');
        this.ui = new UIManager();
        
        // 상수
        this.STAY_THRESHOLD = 3600000; // 1시간
        this.STAY_RADIUS = 50; // 50미터
        this.AUTOSAVE_INTERVAL = 30000; // 30초
    }

    // 앱 초기화
    async init() {
        try {
            console.log('나의 대동여지도 v2.1 초기화 시작...');
            
            // UI 초기화
            this.ui.init();
            
            // 지도 초기화
            if (!this.map.init()) {
                throw new Error('지도 초기화 실패');
            }
            
            // GPS 콜백 설정
            this.setupGPSCallbacks();
            
            // 저장된 데이터 로드
            await this.loadSavedData();
            
            // 자동 저장 설정
            this.setupAutoSave();
            
            // 이벤트 리스너 설정
            this.setupEventListeners();
            
            // UI 상태 복원
            this.ui.restoreUIState();
            
            // 로딩 화면 숨기기
            this.ui.hideLoading();
            
            // 초기 통계 업데이트
            this.updateStats();
            
            console.log('앱 초기화 완료');
            
        } catch (error) {
            console.error('앱 초기화 실패:', error);
            this.ui.showFeedback('앱 초기화에 실패했습니다. 페이지를 새로고침해주세요.');
        }
    }

    // GPS 콜백 설정
    setupGPSCallbacks() {
        this.gps.setCallbacks({
            onUpdate: (data) => this.onLocationUpdate(data),
            onError: (error) => this.onLocationError(error),
            onStart: () => this.onTrackingStart(),
            onStop: () => this.onTrackingStop(),
            onPause: (isPaused) => this.onTrackingPause(isPaused)
        });
    }

    // 저장된 데이터 로드
    async loadSavedData() {
        const savedData = this.storage.loadFromStorage();
        
        if (savedData) {
            this.routes = savedData.routes;
            this.stayAreas = savedData.stayAreas;
            this.totalDistance = savedData.totalDistance;
            
            // 경로 그리기
            this.routes.forEach(route => this.map.drawRoute(route));
            
            // 체류 구역 그리기
            this.stayAreas.forEach(area => {
                if (area.duration >= this.STAY_THRESHOLD) {
                    this.map.drawStayArea(area);
                }
            });
            
            this.ui.showFeedback(`저장된 데이터 복원 완료 (${savedData.lastSaved.toLocaleString()})`);
        }
    }

    // 자동 저장 설정
    setupAutoSave() {
        setInterval(() => {
            const hasData = this.routes.length > 0 || 
                          this.stayAreas.length > 0 || 
                          this.gps.isTracking;
                          
            if (hasData) {
                this.saveData();
            }
        }, this.AUTOSAVE_INTERVAL);
    }

    // 이벤트 리스너 설정
    setupEventListeners() {
        // 페이지 이탈 방지
        this.ui.setBeforeUnloadHandler((event) => {
            if (this.gps.isTracking) {
                this.saveData();
                event.preventDefault();
                event.returnValue = '추적 중인 데이터가 있습니다. 정말 나가시겠습니까?';
            }
        });

        // 가시성 변경 처리
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.log('페이지 숨김 - 성능 최적화 모드');
            } else {
                console.log('페이지 표시 - 일반 모드');
                this.updateStats();
            }
        });

        // 온라인/오프라인 상태
        window.addEventListener('online', () => {
            this.ui.updateOnlineStatus(true);
        });

        window.addEventListener('offline', () => {
            this.ui.updateOnlineStatus(false);
        });
    }

    // === GPS 추적 관련 메서드 ===
    
    startTracking() {
        if (this.gps.startTracking()) {
            this.ui.showFeedback('GPS 추적을 시작합니다...');
        }
    }

    pauseTracking() {
        this.gps.pauseTracking();
    }

    stopTracking() {
        this.gps.stopTracking();
    }

    async centerOnLocation() {
        this.ui.showLocatingAnimation();
        
        try {
            const position = await this.gps.getCurrentPosition();
            this.map.centerOnLocation(position.lat, position.lng);
            this.ui.showFeedback('현재 위치로 이동했습니다');
        } catch (error) {
            this.ui.showFeedback('위치를 찾을 수 없습니다');
        } finally {
            this.ui.hideLocatingAnimation();
        }
    }

    smartGPSAction() {
        if (!this.gps.isTracking) {
            this.centerOnLocation();
            setTimeout(() => this.startTracking(), 1000);
        } else {
            this.stopTracking();
        }
    }

    async requestLocation() {
        const granted = await this.gps.requestPermission();
        if (granted) {
            this.ui.hidePermissionBanner();
            this.ui.showFeedback('위치 권한이 허용되었습니다');
        } else {
            this.ui.showFeedback('위치 권한이 거부되었습니다');
        }
    }

    // === GPS 이벤트 핸들러 ===
    
    onLocationUpdate(data) {
        // 현재 위치 마커 업데이트
        this.map.updateCurrentLocationMarker(data.lat, data.lng);
        
        // 추적 중이고 일시정지가 아닐 때
        if (data.isTracking && this.currentRoute) {
            const point = {
                lat: data.lat,
                lng: data.lng,
                timestamp: data.timestamp,
                accuracy: data.accuracy
            };
            
            this.currentRoute.points.push(point);
            
            // 거리 계산
            if (this.lastPosition) {
                const distance = Utils.calculateDistance(
                    this.lastPosition.lat,
                    this.lastPosition.lng,
                    data.lat,
                    data.lng
                );
                
                this.currentRoute.distance += distance;
                this.totalDistance += distance;
            }
            
            this.lastPosition = { lat: data.lat, lng: data.lng };
            
            // 경로 그리기
            this.map.drawRoute(this.currentRoute);
            
            // 체류 구역 확인
            this.checkStayArea(data.lat, data.lng, data.timestamp);
            
            // 데이터 저장
            this.saveData();
        }
        
        // 통계 업데이트
        this.updateStats();
        
        this.ui.showFeedback('GPS 위치 업데이트됨');
    }

    onLocationError(error) {
        this.ui.showFeedback(`GPS 오류: ${error.message}`);
        
        if (error.code === 1) { // PERMISSION_DENIED
            this.ui.showPermissionBanner();
        }
    }

    onTrackingStart() {
        this.trackingStartTime = new Date();
        this.currentRoute = {
            id: Utils.generateId(),
            points: [],
            startTime: new Date(),
            distance: 0
        };
        
        this.ui.updateTrackingStatus(true, false);
        this.ui.showFeedback('GPS 추적이 시작되었습니다');
    }

    onTrackingStop() {
        if (this.currentRoute && this.currentRoute.points.length > 1) {
            this.currentRoute.endTime = new Date();
            this.routes.push(this.currentRoute);
            this.saveData();
            
            console.log('경로 저장 완료', {
                points: this.currentRoute.points.length,
                distance: this.currentRoute.distance
            });
        }
        
        this.currentRoute = null;
        this.lastPosition = null;
        this.trackingStartTime = null;
        
        this.ui.updateTrackingStatus(false, false);
        this.ui.showFeedback('추적이 완전히 정지되었습니다 (자동 저장됨)');
    }

    onTrackingPause(isPaused) {
        this.ui.updateTrackingStatus(true, isPaused);
        this.ui.showFeedback(isPaused ? '추적 일시정지됨' : '추적 재개됨');
    }

    // === 데이터 관리 메서드 ===
    
    saveData() {
        this.storage.saveToStorage({
            routes: this.routes,
            stayAreas: this.stayAreas,
            totalDistance: this.totalDistance
        });
    }

    saveDataManually() {
        this.saveData();
        this.ui.showFeedback('데이터가 수동으로 저장되었습니다');
        this.ui.showSuccessAnimation(document.getElementById('saveStatus'));
    }

    async clearStoredData() {
        const confirmed = await this.ui.confirmDialog(
            '저장된 모든 데이터를 삭제하시겠습니까?\n(이 작업은 되돌릴 수 없습니다)'
        );
        
        if (confirmed) {
            this.storage.clearStoredData();
            location.reload();
        }
    }

    async clearAllRoutes() {
        const confirmed = await this.ui.confirmDialog(
            '모든 경로를 삭제하시겠습니까?\n(저장된 데이터도 함께 삭제됩니다)'
        );
        
        if (confirmed) {
            this.map.clearAllRoutes();
            this.map.clearAllStayAreas();
            
            this.routes = [];
            this.stayAreas = [];
            this.totalDistance = 0;
            this.cachedDistance = null;
            
            this.storage.clearStoredData();
            this.updateStats();
            
            this.ui.showFeedback('모든 경로가 삭제되었습니다');
        }
    }

    exportData() {
        if (this.storage.exportData({
            routes: this.routes,
            stayAreas: this.stayAreas,
            totalDistance: this.totalDistance
        })) {
            this.ui.showFeedback('데이터가 내보내기되었습니다');
        } else {
            this.ui.showFeedback('내보내기 실패: 데이터가 너무 클 수 있습니다');
        }
    }

    // === 시뮬레이션 관련 메서드 ===
    
    toggleSimulation() {
        this.simulationRunning = !this.simulationRunning;
        this.ui.updateSimulationStatus(this.simulationRunning);
        
        if (this.simulationRunning) {
            this.startSimulation();
        } else {
            this.stopSimulation();
        }
    }

    startSimulation() {
        this.simulationInterval = setInterval(() => {
            this.currentTime = new Date(this.currentTime.getTime() + (1000 * this.simulationSpeed));
            this.map.updateAllRoutes(this.routes, this.currentTime);
        }, 100);
        
        this.ui.showFeedback(`시간 가속 ${this.simulationSpeed}x 시작`);
    }

    stopSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }
        
        this.currentTime = new Date();
        this.ui.showFeedback('시간 가속 정지');
    }

    setSpeed(newSpeed) {
        this.simulationSpeed = newSpeed;
        this.ui.setActiveSpeedButton(newSpeed);
        
        if (this.simulationRunning) {
            this.stopSimulation();
            this.startSimulation();
            this.ui.showFeedback(`시간 가속 ${newSpeed}x로 변경`);
        }
    }

    // === 기타 기능 메서드 ===
    
    checkStayArea(lat, lng, timestamp) {
        // 기존 체류 구역 확인
        for (let i = this.stayAreas.length - 1; i >= 0; i--) {
            const area = this.stayAreas[i];
            const distance = Utils.calculateDistance(area.lat, area.lng, lat, lng);
            
            if (distance <= this.STAY_RADIUS) {
                area.endTime = timestamp;
                area.duration = area.endTime - area.startTime;
                
                if (area.duration >= this.STAY_THRESHOLD && !area.drawn) {
                    this.map.drawStayArea(area);
                    area.drawn = true;
                }
                return;
            }
        }
        
        // 새로운 체류 구역 추가
        this.stayAreas.push({
            lat: lat,
            lng: lng,
            startTime: timestamp,
            endTime: timestamp,
            duration: 0,
            drawn: false
        });
    }

    updateStats() {
        const gpsStatus = this.gps.getStatus();
        
        // 거리 계산 (캐시 활용)
        let distance;
        const currentTime = Date.now();
        
        if (this.cachedDistance !== null && (currentTime - this.cacheUpdateTime) < 1000) {
            distance = this.cachedDistance;
        } else {
            distance = this.totalDistance + (this.currentRoute ? this.currentRoute.distance : 0);
            this.cachedDistance = distance;
            this.cacheUpdateTime = currentTime;
        }
        
        // 통계 데이터
        const stats = {
            totalDistance: Utils.formatDistance(distance),
            currentSpeed: gpsStatus.lastLocation ? 
                Math.round(gpsStatus.lastLocation.speed * 3.6) : 0,
            trackingTime: Utils.formatTime(gpsStatus.trackingDuration),
            routeCount: this.routes.length,
            status: gpsStatus.isTracking ? 
                (gpsStatus.isPaused ? '일시정지' : '추적중') : '정지'
        };
        
        this.ui.updateStats(stats);
    }

    // === 도움말 및 정보 표시 ===
    
    showHelp() {
        const message = `🗺️ 나의 대동여지도 사용법 v2.1

✅ GPS 추적 시작하기:
1. "📍 추적 시작" 버튼 클릭
2. 위치 권한 허용
3. 실제로 걸어다니면서 경로 기록
4. "⏹️ 완전정지"로 추적 종료

🎨 6단계 기억 시스템:
• 흰색(10시간) → 초록(14시간) → 주황(7일) → 빨강(30일) → 갈색(영구)
• 시간이 지날수록 기억이 흐려집니다
• 1시간 이상 머문 곳은 황금색 체류 구역

⏱️ 시간 시뮬레이션:
• 시간을 빠르게 진행하여 기억 변화 확인
• 3600x 속도로 30일을 30초에 시뮬레이션

💾 최적화된 자동 저장:
• 실시간 디바운스 저장
• 데이터 압축 및 검증
• 메모리 효율적 관리

📱 스마트 버튼:
• 📍: GPS 추적 시작/정지
• 📊: 실시간 통계 보기 
• ⏱️: 시간 시뮬레이션
• 🎨: 지도 스타일 변경

📊 현재 상태:
• 저장된 경로: ${this.routes.length}개
• 총 이동거리: ${Utils.formatDistance(this.totalDistance)}`;

        this.ui.showDialog({
            title: '사용법',
            message: message,
            type: 'info'
        });
    }

    showSettings() {
        const mapState = this.map.getMapState();
        const storageStatus = this.storage.getStorageStatus();
        
        const message = `⚙️ 설정 v2.1

현재 지도 스타일: ${mapState.style}
시뮬레이션 속도: ${this.simulationSpeed}x
총 저장된 경로: ${this.routes.length}개
총 이동 거리: ${Utils.formatDistance(this.totalDistance)}

💾 저장 상태:
사용 용량: ${(storageStatus.used / 1024).toFixed(1)}KB / ${(storageStatus.total / 1024 / 1024).toFixed(1)}MB
사용률: ${storageStatus.percentage}%

🚀 성능 최적화:
• Canvas 렌더링: 활성화
• 쓰로틀/디바운스: 활성화
• 메모리 캐시: 활성화
• GPS 필터링: 적응형

• 🎨 버튼으로 지도 스타일 변경
• ⏱️ 버튼으로 시간 시뮬레이션 제어
• 📊 버튼으로 실시간 통계 확인`;

        this.ui.showDialog({
            title: '설정',
            message: message,
            type: 'info'
        });
    }

    showDataInfo() {
        const storageStatus = this.storage.getStorageStatus();
        
        const message = `💾 저장 데이터 정보 v2.1

저장된 경로: ${this.routes.length}개
체류 구역: ${this.stayAreas.length}개
총 이동 거리: ${Utils.formatDistance(this.totalDistance)}

저장소 사용량: ${(storageStatus.used / 1024).toFixed(1)}KB
전체 용량: ${(storageStatus.total / 1024 / 1024).toFixed(1)}MB
사용률: ${storageStatus.percentage}%

자동 저장: 디바운스 최적화 (실시간)
저장 위치: 브라우저 로컬 저장소

⚠️ 주의사항:
• 브라우저 데이터 삭제 시 모든 경로 삭제
• 중요 데이터는 "📤 내보내기"로 백업 필수
• 5MB 저장소 한계 근접 시 자동 알림`;

        this.ui.showDialog({
            title: '저장 정보',
            message: message,
            type: 'info'
        });
    }
}

// === 앱 시작 ===
window.addEventListener('load', () => {
    // 브라우저 지원 체크
    const support = Utils.checkBrowserSupport();
    
    if (!support.geolocation) {
        alert('이 브라우저는 GPS 기능을 지원하지 않습니다.');
        return;
    }
    
    if (!support.localStorage) {
        alert('이 브라우저는 로컬 저장소를 지원하지 않습니다.');
        return;
    }
    
    // 앱 인스턴스 생성 및 초기화
    window.app = new DaedongMapApp();
    window.app.init();
    
    // 개발자 도구용 전역 객체
    window.DaedongMap = {
        app: window.app,
        utils: Utils,
        
        // 디버깅 함수들
        getStatus: () => ({
            routes: window.app.routes.length,
            totalDistance: Utils.formatDistance(window.app.totalDistance),
            stayAreas: window.app.stayAreas.length,
            isTracking: window.app.gps.isTracking,
            gpsStatus: window.app.gps.getStatus()
        }),
        
        clearCache: () => {
            window.app.distanceCache.clear();
            window.app.cachedDistance = null;
            window.app.cacheUpdateTime = 0;
            console.log('캐시 클리어 완료');
        },
        
        showStorageInfo: () => {
            const status = window.app.storage.getStorageStatus();
            console.table(status);
        },
        
        exportRoutes: () => {
            return window.app.routes;
        },
        
        // 테스트용 함수들
        testRoute: () => {
            // 테스트 경로 생성
            const testRoute = {
                id: Utils.generateId(),
                points: [
                    { lat: 37.5665, lng: 126.9780, timestamp: new Date(), accuracy: 10 },
                    { lat: 37.5670, lng: 126.9785, timestamp: new Date(), accuracy: 10 },
                    { lat: 37.5675, lng: 126.9790, timestamp: new Date(), accuracy: 10 }
                ],
                startTime: new Date(),
                distance: 100
            };
            
            window.app.routes.push(testRoute);
            window.app.map.drawRoute(testRoute);
            console.log('테스트 경로 추가됨');
        }
    };
});